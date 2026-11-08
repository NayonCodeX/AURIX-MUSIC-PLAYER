package com.ncx.aurix

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * MusicPlugin — Capacitor plugin that exposes AURIX's native music
 * integration to the WebView:
 *
 *  - Starts / stops a foreground [MusicService] (process keep-alive
 *    while audio is playing through the WebView's <audio> element).
 *  - Acquires / releases AudioFocus.
 *  - Updates the system MediaSession metadata + playback state so
 *    Android shows proper lock-screen + notification controls.
 *  - Forwards notification media button events back to JS.
 *  - Requests READ_MEDIA_AUDIO at runtime (Android 13+).
 *
 * The JS side calls these methods through the global
 * `Capacitor.Plugins.Music` object (registered automatically by
 * Capacitor based on the @CapacitorPlugin annotation).
 */
@CapacitorPlugin(
    name = "Music",
    permissions = [
        Permission(
            alias = "audio",
            strings = [
                Manifest.permission.READ_MEDIA_AUDIO,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_MEDIA_IMAGES
            ]
        ),
        Permission(
            alias = "notifications",
            strings = [Manifest.permission.POST_NOTIFICATIONS]
        )
    ]
)
class MusicPlugin : Plugin() {

    companion object {
        const val ACTION_PLAY = "play"
        const val ACTION_PAUSE = "pause"
        const val ACTION_NEXT = "next"
        const val ACTION_PREV = "previous"
        const val ACTION_STOP = "stop"
    }

    override fun load() {
        super.load()
        // Allow the foreground MusicService to reach back to the JS bridge.
        MusicService.MusicPluginHolder.instance = this
    }

    override fun handleOnDestroy() {
        MusicService.MusicPluginHolder.instance = null
        super.handleOnDestroy()
    }

    /**
     * Called from JS when playback starts. Starts the foreground service
     * so the OS keeps the app process alive while audio is playing.
     */
    @PluginMethod
    fun startService(call: PluginCall) {
        try {
            val ctx: Context = getContext()
            val intent = Intent(ctx, MusicService::class.java).apply {
                action = MusicService.ACTION_START
            }
            ContextCompat.startForegroundService(ctx, intent)
            call.resolve(JSObject().put("started", true))
        } catch (e: Exception) {
            call.reject("Failed to start service: ${e.message}")
        }
    }

    /**
     * Called from JS when playback is paused or the player is closed.
     */
    @PluginMethod
    fun stopService(call: PluginCall) {
        try {
            val ctx: Context = getContext()
            val intent = Intent(ctx, MusicService::class.java)
            ctx.stopService(intent)
            call.resolve(JSObject().put("stopped", true))
        } catch (e: Exception) {
            call.reject("Failed to stop service: ${e.message}")
        }
    }

    /**
     * Update the MediaSession metadata + playback state.
     *
     * JS payload:
     *   {
     *     title:    "Song title",
     *     artist:   "Artist",
     *     album:    "Album",
     *     duration: 0,        // milliseconds
     *     position: 0,        // milliseconds
     *     isPlaying: true,
     *     artwork:  "data:image/png;base64,..." | null
     *   }
     */
    @PluginMethod
    fun updateInfo(call: PluginCall) {
        val title = call.getString("title") ?: "Unknown"
        val artist = call.getString("artist") ?: "Unknown Artist"
        val album = call.getString("album") ?: ""
        val duration = call.getDouble("duration")?.toLong() ?: 0L
        val position = call.getDouble("position")?.toLong() ?: 0L
        val isPlaying = call.getBoolean("isPlaying", false) ?: false
        val artwork = call.getString("artwork")

        val data = JSObject().apply {
            put("action", "updateInfo")
            put("title", title)
            put("artist", artist)
            put("album", album)
            put("duration", duration)
            put("position", position)
            put("isPlaying", isPlaying)
            if (artwork != null) put("artwork", artwork)
        }
        sendToService(data)
        call.resolve()
    }

    /** Update only the playback state (lighter than updateInfo). */
    @PluginMethod
    fun setPlaying(call: PluginCall) {
        val isPlaying = call.getBoolean("isPlaying", false) ?: false
        val position = call.getDouble("position")?.toLong() ?: 0L
        val data = JSObject().apply {
            put("action", "setPlaying")
            put("isPlaying", isPlaying)
            put("position", position)
        }
        sendToService(data)
        call.resolve()
    }

    /**
     * Request the audio-read permission at runtime. On Android 13+
     * this is READ_MEDIA_AUDIO. On older versions it's a no-op
     * (READ_EXTERNAL_STORAGE is granted at install time on API ≤ 28
     * but we declare it via the manifest maxSdk attribute).
     */
    @PluginMethod
    fun requestAudioPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // No runtime permission needed for audio on API < 33
            call.resolve(JSObject().put("granted", true))
            return
        }
        if (getPermissionState("audio") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestAllPermissions(call, "audioPermissionCallback")
    }

    @PermissionCallback
    fun audioPermissionCallback(call: PluginCall) {
        val granted = getPermissionState("audio") == PermissionState.GRANTED
        call.resolve(JSObject().put("granted", granted))
    }

    /** Request POST_NOTIFICATIONS (Android 13+) so the music notification shows. */
    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
            return
        }
        requestAllPermissions(call, "notificationPermissionCallback")
    }

    @PermissionCallback
    fun notificationPermissionCallback(call: PluginCall) {
        val granted = getPermissionState("notifications") == PermissionState.GRANTED
        call.resolve(JSObject().put("granted", granted))
    }

    /** Convenience: check whether audio permission is currently granted. */
    @PluginMethod
    fun hasAudioPermission(call: PluginCall) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                getContext(), Manifest.permission.READ_MEDIA_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        } else true
        call.resolve(JSObject().put("granted", granted))
    }

    // --------- Helper to forward a payload to the foreground service ---------

    private fun sendToService(data: JSObject) {
        try {
            val ctx: Context = getContext()
            val intent = Intent(ctx, MusicService::class.java).apply {
                action = MusicService.ACTION_UPDATE
                putExtra(MusicService.EXTRA_PAYLOAD, data.toString())
            }
            // Use startService for updates (the service is already running if playback is active;
            // if not, the service ignores the update).
            ContextCompat.startForegroundService(ctx, intent)
        } catch (e: Exception) {
            // Swallow — service start can race during shutdown
        }
    }

    // --------- Called by MusicService when a notification button is tapped ---------

    fun notifyJsAction(action: String) {
        notifyListeners("musicAction", JSObject().put("action", action))
    }
}
