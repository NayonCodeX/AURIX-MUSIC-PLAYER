# 📦 AURIX Releases

Pre-built Android APK files for the AURIX Music Player, packaged by **NCX (NayonCodeX)**.

Each APK in this folder is a fully working build that you can install directly on any Android 10+ device. These are the same artifacts the GitHub Actions workflow produces, committed here for convenience.

## Latest Release

| File | Version | Size | Min Android |
|------|---------|------|-------------|
| [`AURIX-v1.0.1-debug.apk`](./AURIX-v1.0.1-debug.apk) | 1.0.1 | ~9.5 MB | Android 10 (API 29) |

## Installation

1. Download [`AURIX-v1.0.1-debug.apk`](./AURIX-v1.0.1-debug.apk) to your Android phone.
2. Tap the file in your file manager (e.g. Files by Google, Solid Explorer).
3. If prompted, allow "Install unknown apps" for your file manager.
4. Tap **Install** → **Open**.
5. On first launch tap **Grant Music Access** to allow AURIX to read your audio files.

## What's new in v1.0.1

- ✅ **Scrolling fixed** — touch scrolling now works smoothly in all lists and views
- ✅ **SD card + phone storage scanning** — AURIX now scans ALL storage volumes (internal + SD card + USB OTG) using Android's MediaStore API
- ✅ **Better song metadata** — title, artist, album, and duration are read directly from the system MediaStore instead of guessing from filenames
- ✅ **Auto-rescan** — picks up new songs automatically on app start without manual rescan
- ✅ **Layout fixes** — now-playing screen fits properly on smaller phones (no overflow)

## Verification

The committed APK was built locally with the same Gradle command the CI uses:

```bash
cd android && ./gradlew assembleDebug
```

- Package: `com.ncx.aurix`
- Version: `1.0.1` (versionCode 2)
- Compile/Target SDK: 35 (Android 15)
- Min SDK: 29 (Android 10)
- Signed with the debug keystore (safe to install; for production use build a release-signed APK)

## Checksums

You can verify the file integrity after download:

```
SHA-256: 8461e15638438d533b822b6c8547782e823f44b724dbc68ab36136b29915bac3
MD5:     164c894dc4d634da8ca12621aa8f898e
```

> Run `sha256sum AURIX-v1.0.1-debug.apk` on your machine and compare against the value above.

---

NCX • NayonCodeX • *Music Beyond Limits*
