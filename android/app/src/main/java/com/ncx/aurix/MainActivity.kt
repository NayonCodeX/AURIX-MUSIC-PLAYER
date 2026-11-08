package com.ncx.aurix

import android.os.Bundle
import com.getcapacitor.BridgeActivity

/**
 * Main entry point for the AURIX Music Player app.
 *
 * The UI is rendered by the Capacitor WebView (HTML/CSS/JS in
 * `assets/public`). Native features such as the foreground music
 * service, notification media controls and audio focus are provided
 * by the [MusicPlugin] Capacitor plugin, registered here.
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register native plugins BEFORE super.onCreate so the bridge
        // picks them up when the WebView loads.
        registerPlugin(MusicPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
