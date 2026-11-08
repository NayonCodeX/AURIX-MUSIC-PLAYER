package com.ncx.aurix

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
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

    /**
     * Scan ALL audio files on the device — internal storage + SD card + USB OTG —
     * using Android's MediaStore.Audio provider. MediaStore is the only reliable
     * way to enumerate audio across every storage volume, and it returns
     * `content://` URIs that the WebView can play directly via `Capacitor.convertFileSrc()`.
     *
     * Returns a JSON array of song objects:
     *   {
     *     id, title, artist, album, duration, uri, size, dateAdded,
     *     relativePath, displayName, mimeType
     *   }
     *
     * JS-side, `library.js` consumes this via `Cap.Music.scanAllAudio()`.
     */
    @PluginMethod
    fun scanAllAudio(call: PluginCall) {
        // Reject early if no permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                getContext(), Manifest.permission.READ_MEDIA_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                call.resolve(JSObject().put("songs", JSArray()).put("count", 0).put("error", "permission-denied"))
                return
            }
        }

        val songs = JSArray()
        val ctx: Context = getContext()
        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        }

        // Columns we want. RELATIVE_PATH and DISPLAY_NAME require API 29+.
        val projection = mutableListOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.DISPLAY_NAME
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            projection.add(MediaStore.Audio.Media.RELATIVE_PATH)
            projection.add(MediaStore.Audio.Media.VOLUME_NAME)
        }

        // IS_MUSIC = 1 (filter out ringtones/notifications/alarms by default)
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} = ?"
        val selectionArgs = arrayOf("1")
        val sortOrder = "${MediaStore.Audio.Media.TITLE} ASC"

        var cursor = try {
            ctx.contentResolver.query(
                collection,
                projection.toTypedArray(),
                selection,
                selectionArgs,
                sortOrder
            )
        } catch (e: Exception) {
            // Fallback: try without IS_MUSIC filter (some OEM ROMs omit it)
            try {
                ctx.contentResolver.query(
                    collection,
                    projection.toTypedArray(),
                    null, null, sortOrder
                )
            } catch (e2: Exception) {
                null
            }
        }

        var count = 0
        cursor?.use { c ->
            val idCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val titleCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE)
            val artistCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST)
            val albumCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM)
            val durCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val sizeCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val mimeCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
            val dateCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
            val nameCol = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
            val relPathCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                c.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH) else -1
            val volumeCol = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
                c.getColumnIndex(MediaStore.Audio.Media.VOLUME_NAME) else -1

            while (c.moveToNext()) {
                val id = c.getLong(idCol)
                val title = c.getString(titleCol) ?: "Unknown"
                val artist = c.getString(artistCol) ?: "Unknown Artist"
                val album = c.getString(albumCol) ?: "Unknown Album"
                val duration = c.getLong(durCol)
                val size = c.getLong(sizeCol)
                val mime = c.getString(mimeCol) ?: ""
                val dateAdded = c.getLong(dateCol)
                val displayName = c.getString(nameCol) ?: title
                val relativePath = if (relPathCol >= 0) (c.getString(relPathCol) ?: "") else ""
                val volumeName = if (volumeCol >= 0) (c.getString(volumeCol) ?: "external") else "external"

                // Build a content:// URI the WebView can use directly (after convertFileSrc)
                val contentUri = ContentUris.withAppendedId(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id
                )

                val song = JSObject()
                song.put("id", "ms_$id")
                song.put("title", title)
                song.put("artist", artist)
                song.put("album", album)
                song.put("duration", duration)
                song.put("uri", contentUri.toString())
                song.put("size", size)
                song.put("mimeType", mime)
                song.put("dateAdded", dateAdded)
                song.put("displayName", displayName)
                song.put("relativePath", relativePath)
                song.put("volumeName", volumeName)
                song.put("folderName", folderFromPath(relativePath, displayName))
                songs.put(song)
                count++
            }
        }

        val result = JSObject()
        result.put("songs", songs)
        result.put("count", count)
        call.resolve(result)
    }

    /** Helper: derive a friendly folder name from a relative path + filename. */
    private fun folderFromPath(relativePath: String?, displayName: String?): String {
        if (relativePath.isNullOrEmpty()) return "Unknown Folder"
        // relativePath looks like "Music/Albums/" — strip trailing slash, take last segment
        val clean = relativePath.trimEnd('/')
        val slash = clean.lastIndexOf('/')
        return if (slash >= 0) clean.substring(slash + 1) else clean
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
