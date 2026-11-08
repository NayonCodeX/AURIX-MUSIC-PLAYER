package com.ncx.aurix

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.support.v4.media.MediaMetadataCompat
import org.json.JSONObject

/**
 * MusicService — A foreground service that keeps the AURIX app process
 * alive while audio is playing through the WebView's <audio> element,
 * and shows a media notification with lock-screen controls.
 *
 * Responsibilities:
 *  - Foreground service with `mediaPlayback` type (Android 10+).
 *  - Owns the system [MediaSessionCompat] and posts metadata + playback state
 *    so Android surfaces proper lock-screen + notification controls.
 *  - Acquires AudioFocus on start and releases it on stop.
 *  - Holds a partial WakeLock during playback (CPU + audio path).
 *  - Routes notification media button events back to [MusicPlugin],
 *    which forwards them as Capacitor events to the JS layer.
 */
class MusicService : Service() {

    companion object {
        const val ACTION_START = "com.ncx.aurix.action.START"
        const val ACTION_STOP = "com.ncx.aurix.action.STOP"
        const val ACTION_UPDATE = "com.ncx.aurix.action.UPDATE"
        const val ACTION_PLAY_PAUSE = "com.ncx.aurix.action.PLAY_PAUSE"
        const val ACTION_NEXT = "com.ncx.aurix.action.NEXT"
        const val ACTION_PREV = "com.ncx.aurix.action.PREV"
        const val ACTION_STOP_SELF = "com.ncx.aurix.action.STOP_SELF"
        const val EXTRA_PAYLOAD = "payload"

        const val NOTIF_CHANNEL_ID = "aurix_playback"
        const val NOTIF_ID = 1

        private const val MEDIA_SESSION_TAG = "AURIX"
    }

    private var mediaSession: MediaSessionCompat? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var notificationManager: NotificationManager? = null

    // Current playback info (updated from JS via ACTION_UPDATE)
    private var currentTitle: String = "AURIX Music Player"
    private var currentArtist: String = "NCX • NayonCodeX"
    private var currentAlbum: String = ""
    private var currentDuration: Long = 0L
    private var currentPosition: Long = 0L
    private var isPlaying: Boolean = false
    private var artworkBitmap: Bitmap? = null

    // ---------- Lifecycle ----------

    override fun onCreate() {
        super.onCreate()
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        audioManager = getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        createNotificationChannel()
        createMediaSession()
        createWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startPlayback()
            ACTION_STOP -> stopPlayback()
            ACTION_UPDATE -> handleUpdate(intent.getStringExtra(EXTRA_PAYLOAD))
            ACTION_PLAY_PAUSE -> {
                notifyPluginAction(if (isPlaying) MusicPlugin.ACTION_PAUSE else MusicPlugin.ACTION_PLAY)
                togglePlaybackState()
            }
            ACTION_NEXT -> notifyPluginAction(MusicPlugin.ACTION_NEXT)
            ACTION_PREV -> notifyPluginAction(MusicPlugin.ACTION_PREV)
            ACTION_STOP_SELF -> stopPlayback()
            else -> {
                // No-op or unknown action — keep service alive if started
                startPlayback()
            }
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseAudioFocus()
        releaseWakeLock()
        mediaSession?.run {
            isActive = false
            release()
        }
        mediaSession = null
        super.onDestroy()
    }

    // ---------- Notification channel ----------

    private fun createNotificationChannel() {
        val nm = notificationManager ?: return
        if (nm.getNotificationChannel(NOTIF_CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            NOTIF_CHANNEL_ID,
            "AURIX Playback",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Music playback controls for AURIX"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        nm.createNotificationChannel(channel)
    }

    // ---------- MediaSession ----------

    private fun createMediaSession() {
        if (mediaSession != null) return
        val session = MediaSessionCompat(this, MEDIA_SESSION_TAG)
        session.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        )
        session.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() { notifyPluginAction(MusicPlugin.ACTION_PLAY); togglePlaybackState(true) }
            override fun onPause() { notifyPluginAction(MusicPlugin.ACTION_PAUSE); togglePlaybackState(false) }
            override fun onSkipToNext() { notifyPluginAction(MusicPlugin.ACTION_NEXT) }
            override fun onSkipToPrevious() { notifyPluginAction(MusicPlugin.ACTION_PREV) }
            override fun onStop() { notifyPluginAction(MusicPlugin.ACTION_STOP); stopPlayback() }
            override fun onSeekTo(pos: Long) {
                currentPosition = pos
                updatePlaybackState()
                notifyPluginAction("seek:$pos")
            }
        })
        session.isActive = true
        mediaSession = session
    }

    private fun updateMetadata() {
        val md = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, currentAlbum)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration)
        artworkBitmap?.let { md.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, it) }
        mediaSession?.setMetadata(md.build())
        refreshNotification()
    }

    private fun updatePlaybackState() {
        val state = if (isPlaying) PlaybackStateCompat.STATE_PLAYING
                    else PlaybackStateCompat.STATE_PAUSED
        val builder = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_PLAY_PAUSE or
                    PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                    PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                    PlaybackStateCompat.ACTION_STOP or
                    PlaybackStateCompat.ACTION_SEEK_TO
            )
            .setState(state, currentPosition, 1.0f)
        mediaSession?.setPlaybackState(builder.build())
        mediaSession?.isActive = true
        refreshNotification()
    }

    private fun togglePlaybackState(toPlaying: Boolean? = null) {
        isPlaying = toPlaying ?: !isPlaying
        updatePlaybackState()
    }

    // ---------- Foreground start / stop ----------

    private fun startPlayback() {
        requestAudioFocus()
        acquireWakeLock()
        val notif = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIF_ID, notif)
            }
        } catch (e: Exception) {
            // Foreground service start can fail if app is in background and permission
            // wasn't granted. Fall back to non-foreground notification.
            notificationManager?.notify(NOTIF_ID, notif)
        }
        updateMetadata()
        updatePlaybackState()
    }

    private fun stopPlayback() {
        isPlaying = false
        updatePlaybackState()
        releaseAudioFocus()
        releaseWakeLock()
        try { stopForeground(STOP_FOREGROUND_REMOVE) } catch (e: Exception) {}
        mediaSession?.isActive = false
        stopSelf()
    }

    // ---------- Notification ----------

    private fun buildNotification(): Notification {
        val mainIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: Intent(this, MainActivity::class.java)
        val contentPi = PendingIntent.getActivity(
            this, 0, mainIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val playPauseIcon = if (isPlaying) R.drawable.ic_pause else R.drawable.ic_play
        val playPauseLabel = if (isPlaying) "Pause" else "Play"

        val builder = NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_aurix_notif)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setContentInfo(if (currentAlbum.isNotEmpty()) currentAlbum else "AURIX • NCX")
            .setContentIntent(contentPi)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(Color.parseColor("#070713"))
            .setColorized(true)
            .setShowWhen(false)
            .setOngoing(isPlaying)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)

        artworkBitmap?.let { builder.setLargeIcon(it) }

        // Prev
        builder.addAction(
            NotificationCompat.Action.Builder(
                R.drawable.ic_prev,
                "Previous",
                buildActionPi(ACTION_PREV)
            ).build()
        )
        // Play / pause
        builder.addAction(
            NotificationCompat.Action.Builder(
                playPauseIcon,
                playPauseLabel,
                buildActionPi(ACTION_PLAY_PAUSE)
            ).build()
        )
        // Next
        builder.addAction(
            NotificationCompat.Action.Builder(
                R.drawable.ic_next,
                "Next",
                buildActionPi(ACTION_NEXT)
            ).build()
        )
        // Stop
        builder.addAction(
            NotificationCompat.Action.Builder(
                R.drawable.ic_stop,
                "Stop",
                buildActionPi(ACTION_STOP_SELF)
            ).build()
        )

        // Style for media controls on lock screen
        val style = MediaStyle()
            .setMediaSession(mediaSession?.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)
        builder.setStyle(style)

        return builder.build()
    }

    private fun refreshNotification() {
        try {
            notificationManager?.notify(NOTIF_ID, buildNotification())
        } catch (_: Exception) {}
    }

    private fun buildActionPi(action: String): PendingIntent {
        val intent = Intent(this, MusicService::class.java).apply { this.action = action }
        return PendingIntent.getService(
            this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    // ---------- Audio focus ----------

    private fun requestAudioFocus() {
        val am = audioManager ?: return
        // Abandon any previous request
        releaseAudioFocus()

        val attrs = AudioAttributes.Builder()
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener { focus -> onAudioFocusChange(focus) }
                .build()
            audioFocusRequest = request
            am.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            am.requestAudioFocus(
                { focus -> onAudioFocusChange(focus) },
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            )
        }
    }

    private fun releaseAudioFocus() {
        val am = audioManager ?: return
        val req = audioFocusRequest
        if (req != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            am.abandonAudioFocusRequest(req)
            audioFocusRequest = null
        } else {
            @Suppress("DEPRECATION")
            am.abandonAudioFocus { }
        }
    }

    private fun onAudioFocusChange(focus: Int) {
        when (focus) {
            AudioManager.AUDIOFOCUS_LOSS -> {
                isPlaying = false
                updatePlaybackState()
                notifyPluginAction(MusicPlugin.ACTION_PAUSE)
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                isPlaying = false
                updatePlaybackState()
                notifyPluginAction(MusicPlugin.ACTION_PAUSE)
            }
            AudioManager.AUDIOFOCUS_GAIN -> {
                isPlaying = true
                updatePlaybackState()
                notifyPluginAction(MusicPlugin.ACTION_PLAY)
            }
        }
    }

    // ---------- Wake lock ----------

    private fun createWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AURIX:playback").apply {
            setReferenceCounted(false)
        }
    }

    private fun acquireWakeLock() {
        try {
            // PowerManager.WakeLock.acquire(timeout) — kept for 1 hour,
            // will be re-acquired on subsequent updates from JS.
            wakeLock?.acquire(60 * 60 * 1000L)
        } catch (_: Exception) {}
    }

    private fun releaseWakeLock() {
        try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) {}
    }

    // ---------- Updates from JS ----------

    private fun handleUpdate(payloadJson: String?) {
        if (payloadJson.isNullOrEmpty()) return
        try {
            val obj = JSONObject(payloadJson)
            val action = obj.optString("action", "")
            when (action) {
                "updateInfo" -> {
                    val title = obj.optString("title")
                    if (title.isNotEmpty()) currentTitle = title
                    val artist = obj.optString("artist")
                    if (artist.isNotEmpty()) currentArtist = artist
                    val album = obj.optString("album")
                    if (album.isNotEmpty()) currentAlbum = album
                    currentDuration = obj.optLong("duration", 0)
                    currentPosition = obj.optLong("position", 0)
                    isPlaying = obj.optBoolean("isPlaying", false)
                    val artwork = obj.optString("artwork", "")
                    if (artwork.isNotEmpty()) {
                        artworkBitmap = decodeBase64Bitmap(artwork)
                    }
                    updateMetadata()
                    updatePlaybackState()
                    if (isPlaying) acquireWakeLock() else releaseWakeLock()
                }
                "setPlaying" -> {
                    isPlaying = obj.optBoolean("isPlaying", false)
                    currentPosition = obj.optLong("position", 0)
                    updatePlaybackState()
                    if (isPlaying) acquireWakeLock() else releaseWakeLock()
                }
            }
        } catch (e: Exception) {
            // Bad JSON — ignore
        }
    }

    private fun decodeBase64Bitmap(dataUri: String): Bitmap? {
        return try {
            val comma = dataUri.indexOf(",")
            val b64 = if (comma >= 0) dataUri.substring(comma + 1) else dataUri
            val bytes = Base64.decode(b64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        } catch (_: Exception) { null }
    }

    // ---------- Plugin callback ----------

    private fun notifyPluginAction(action: String) {
        // The plugin instance is held by the Capacitor bridge; we look it up
        // through the application context. MusicService → MusicPlugin.
        try {
            val plugin = MusicPluginHolder.instance
            plugin?.notifyJsAction(action)
        } catch (_: Exception) {}
    }

    /**
     * Holder so the service can reach back to the plugin. The plugin registers
     * itself when the WebView first loads.
     */
    object MusicPluginHolder {
        @Volatile var instance: MusicPlugin? = null
    }
}
