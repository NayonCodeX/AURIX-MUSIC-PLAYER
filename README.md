# 🎧 AURIX MUSIC PLAYER

### **MUSIC BEYOND LIMITS**

A premium, offline music player for Android — built under the **NCX (NayonCodeX)** brand. AURIX plays the audio files already on your device. No streaming, no accounts, no ads, no internet required.

---

## ✨ About AURIX

AURIX is a complete, production-quality offline music player. It pairs a hand-built premium web UI (HTML/CSS/JavaScript) with native Android integration (Capacitor + Kotlin) for background playback, lock-screen controls, notification media buttons, and audio focus handling.

- **App Name**: AURIX Music Player
- **Brand**: NCX / NayonCodeX
- **Developer**: Nayon Ahamed
- **Package**: `com.ncx.aurix`
- **Version**: `1.0.0`
- **Tagline**: *Music Beyond Limits*
- **Platform**: Android 10+ (API 29+)
- **License**: MIT

---

## 🚀 Features

| # | Feature | Status |
|---|---------|--------|
| 1 | Scan & import local audio files | ✅ |
| 2 | Music library (songs list) | ✅ |
| 3 | Albums & artists | ✅ |
| 4 | Folder-based browsing | ✅ |
| 5 | Search songs | ✅ |
| 6 | Play, pause, next, previous | ✅ |
| 7 | Shuffle & repeat (off / all / one) | ✅ |
| 8 | Favorites | ✅ |
| 9 | Create & manage playlists | ✅ |
| 10 | Recently played | ✅ |
| 11 | 5-band equalizer with presets | ✅ |
| 12 | Background music playback | ✅ (foreground service) |
| 13 | Android notification controls | ✅ |
| 14 | Lock-screen playback controls | ✅ (MediaSession) |
| 15 | Persistent music library | ✅ |
| 16 | Responsive mobile-first UI | ✅ |
| 17 | Dark premium theme | ✅ |
| 18 | No advertisements | ✅ |
| 19 | Minimal permissions only | ✅ |

**Bonus**: Most-played view, audio focus handling, wake-lock for continuous playback, hardware-accelerated Web Audio API equalizer, animated now-playing visualizer.

---

## 🛠️ Technology Stack

### Web UI (`www/`)
- HTML5 + CSS3 (custom premium theme, no frameworks)
- Vanilla JavaScript (modular: `capacitor.js`, `storage.js`, `library.js`, `player.js`, `equalizer.js`, `ui.js`, `app.js`)
- Web Audio API for the equalizer
- W3C MediaSession API (used as a web fallback)

### Native Android (`android/app/src/main/java/com/ncx/aurix/`)
- Kotlin (`MainActivity.kt`, `MusicService.kt`, `MusicPlugin.kt`)
- Capacitor 7 (web→native bridge)
- Android `MediaSession` for system-level media integration
- Foreground service with `mediaPlayback` type (Android 10+ requirement)
- `NotificationManager` with `MediaStyle` for lock-screen + notification controls
- `AudioManager` for audio focus (pause on calls / duck on notifications)
- `PowerManager.WakeLock` for continuous playback
- Filesystem plugin for scanning audio files
- Preferences plugin for persistent library state

### Build & CI
- Gradle 8.11 + Android Gradle Plugin 8.7.2
- Android SDK 35 (compile & target), API 29 (min)
- Kotlin 1.9.25
- GitHub Actions (workflow: `.github/workflows/android.yml`)

---

## 📁 Project Structure

```
AURIX-MUSIC-PLAYER/
├── .github/workflows/
│   └── android.yml                 # GitHub Actions: builds debug APK, uploads artifact
├── android/                         # Native Android project (Capacitor)
│   ├── app/
│   │   ├── build.gradle             # App module Gradle config (Kotlin, deps)
│   │   └── src/main/
│   │       ├── AndroidManifest.xml  # Permissions, foreground service declaration
│   │       ├── assets/public/       # Web assets (synced from www/ by `cap sync`)
│   │       ├── java/com/ncx/aurix/
│   │       │   ├── MainActivity.kt  # App entry, registers plugins
│   │       │   ├── MusicPlugin.kt   # Capacitor plugin: start/stop service, update info, perms
│   │       │   └── MusicService.kt  # Foreground service: MediaSession + notification + audio focus
│   │       └── res/                 # icons, splash, drawables, themes, strings
│   ├── build.gradle                 # Root Gradle config (Kotlin plugin)
│   ├── variables.gradle             # SDK + dependency versions
│   ├── gradle/wrapper/              # Gradle wrapper (committed, no install needed)
│   ├── gradlew / gradlew.bat        # Gradle bootstrap
│   ├── settings.gradle
│   └── capacitor.settings.gradle    # Auto-generated plugin includes
├── www/                             # Web UI source (committed)
│   ├── index.html                   # App shell with all views
│   ├── style.css                    # Premium dark theme
│   ├── capacitor.js                 # Bridge: Storage, Toast, Haptic, Music plugin
│   ├── storage.js                   # Persistent data layer (Preferences)
│   ├── library.js                   # Music scanner + indexer
│   ├── player.js                    # Audio player + queue + MediaSession integration
│   ├── equalizer.js                 # Web Audio API 5-band equalizer
│   ├── ui.js                        # DOM rendering helpers
│   ├── app.js                       # Main entry, event wiring, view rendering
│   └── assets/img/                  # App icons (used by MediaSession artwork + favicon)
├── capacitor.config.json            # Capacitor config (appId, webDir, etc.)
├── package.json                     # npm scripts + Capacitor plugins
├── .gitignore
├── LICENSE
└── README.md                        # This file
```

---

## 🔧 Build & Installation

### Option A: Download the APK from GitHub Actions

1. Push your changes to the `main` branch of the GitHub repository.
2. Open the repo on GitHub → **Actions** tab.
3. Click the latest **"AURIX Android APK Build"** run.
4. Scroll to **Artifacts** → download **`AURIX-Android-APK`**.
5. Unzip the artifact to get `app-debug.apk`.
6. On your Android 10+ phone, allow "Install unknown apps" for your file manager, then tap the APK to install.

### Option B: Build the APK locally

**Prerequisites**:
- Android Studio (or Android SDK + JDK 17)
- Node.js 18+ and npm
- Git

```bash
# 1. Clone the repository
git clone https://github.com/NayonCodeX/AURIX-MUSIC-PLAYER.git
cd AURIX-MUSIC-PLAYER

# 2. Install JavaScript dependencies (Capacitor + plugins)
npm install

# 3. Sync web assets into the Android project
npx cap sync android

# 4. Build the debug APK
cd android
chmod +x gradlew        # Linux/macOS only
./gradlew assembleDebug

# 5. Find your APK
ls app/build/outputs/apk/debug/app-debug.apk
```

Install on a connected device:

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Option C: Open in Android Studio

```bash
npm install
npx cap sync android
npx cap open android
```

Android Studio opens; press ▶ Run to install on a connected device.

---

## 🎵 Using the App

1. **First launch**: Tap **Grant Music Access** to allow AURIX to read audio files in your Music / Downloads folders.
2. **Scan**: AURIX scans `/sdcard/Music`, `/sdcard/Download/Music`, `/sdcard/Downloads/Music`, `/sdcard/Downloads`, `/sdcard/Audiobooks` recursively and indexes all supported audio files.
3. **Browse** via the chips: Songs, Albums, Artists, Folders, Playlists.
4. **Search** by tapping the magnifier icon.
5. **Play** any song — the mini player appears at the bottom. Tap it to open the full now-playing screen.
6. **Notification & lock-screen controls** appear automatically (provided you granted the notification permission on Android 13+).
7. **For You** tab: Favorites, Recently Played, Most Played.
8. **Equalizer** tab: choose a preset or drag the 5 sliders (60Hz / 230Hz / 910Hz / 3.6kHz / 14kHz). Master volume slider too.
9. **Rescan** via the ⋮ menu → "Rescan Library" to find newly added files.

### Supported audio formats

`.mp3 .m4a .aac .flac .ogg .oga .wav .opus .weba .wma .amr .3ga .m4b`

(depending on the codec support of your device's WebView)

---

## 🔐 Permissions

AURIX requests only the minimum permissions required to play your music.

| Permission | Why | When asked |
|------------|-----|------------|
| `READ_MEDIA_AUDIO` | Read audio files from storage | First launch, on Android 13+ |
| `READ_EXTERNAL_STORAGE` | Same, on Android 12 and below | Install time (maxSdkVersion=32) |
| `POST_NOTIFICATIONS` | Show the playback notification | First launch, on Android 13+ |
| `FOREGROUND_SERVICE` | Keep app alive while music plays | Install time |
| `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Media playback foreground service type | Install time (Android 14+) |
| `WAKE_LOCK` | Keep CPU running during playback | Install time |
| `INTERNET` | Required by Capacitor for its localhost scheme | Install time (not used for actual network access) |

**AURIX does NOT collect, send, or store any personal data.** All your library data, playlists, and favorites are stored locally on your device via Capacitor Preferences. There is no analytics, no telemetry, no third-party SDK beyond Capacitor itself.

---

## 🧪 Local Development (Web Preview)

You can run the web UI in a desktop browser for development (no Android needed). Native-only features (foreground service, MediaSession notifications) will be no-ops or fall back to W3C MediaSession.

```bash
# Start a simple HTTP server in www/
cd www
python3 -m http.server 8000
# Open http://localhost:8000

# Use the file picker to add songs manually
```

---

## 🐛 Troubleshooting

| Problem | Fix |
|---------|-----|
| "No music found" after granting permission | Place audio files in `/sdcard/Music/` and tap ⋮ → **Rescan Library** |
| Notification doesn't appear (Android 13+) | Settings → Apps → AURIX → Notifications → allow |
| Music stops when app is backgrounded | Disable battery optimization for AURIX: Settings → Apps → AURIX → Battery → Unrestricted |
| "Cannot play this track" | The file format may not be supported by your device's WebView; try a different format (MP3 / M4A always work) |
| APK build fails on GitHub Actions | Check the build reports artifact for the Gradle error; re-run with verbose logging if needed |

---

## 🏗️ Architecture Notes

### How playback works

1. The `<audio>` element in `www/index.html` plays the actual audio stream.
2. When playback starts, `player.js` calls `Cap.Music.startService()` → `MusicPlugin.startService()` → starts `MusicService` as a foreground service with `mediaPlayback` type.
3. `MusicService` creates a `MediaSession`, posts a media notification (with Play / Pause / Prev / Next / Stop buttons + metadata), acquires `AudioFocus`, and holds a partial `WakeLock`.
4. When the user taps a notification button, `MusicService` calls `MusicPlugin.notifyJsAction(action)` → Capacitor emits `musicAction` event → `player.js` handles the action (play / pause / next / previous / seek).
5. When playback stops, `player.js` calls `Cap.Music.stopService()` → service stops, AudioFocus released, WakeLock released, notification removed.

### Why this design

- **WebView keeps playing audio in background** (Android WebView's audio element is a foreground-capable audio source). The foreground service just keeps the app *process* alive so Android doesn't kill the WebView.
- **A native MediaSession** (rather than W3C MediaSession) gives reliable notification + lock-screen + Bluetooth headset support across all Android versions.
- **AudioFocus** is properly requested/released so music pauses when a call comes in and resumes after.

---

## 👨‍💻 Developer

### **NAYON AHAMED**

Founder & Developer of NCX

`NCX — NayonCodeX`

---

## 📋 Project Information

| Details | Information |
| --- | --- |
| App Name | AURIX Music Player |
| Developer | Nayon Ahamed |
| Brand | NCX |
| Version | 1.0.0 |
| Platform | Android 10+ |
| Mode | Offline |
| License | MIT |
| Repository | https://github.com/NayonCodeX/AURIX-MUSIC-PLAYER |

---

## 📜 License

Released under the MIT License. See [LICENSE](./LICENSE) for the full text.

AURIX does not bundle any copyrighted music. The app plays only files that you already own and place on your device.

---

### ⚡ POWERED BY NCX

**MUSIC BEYOND LIMITS**

© 2026 NayonCodeX. All Rights Reserved.
