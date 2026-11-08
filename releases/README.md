# 📦 AURIX Releases

Pre-built Android APK files for the AURIX Music Player, packaged by **NCX (NayonCodeX)**.

Each APK in this folder is a fully working build that you can install directly on any Android 10+ device. These are the same artifacts the GitHub Actions workflow produces, committed here for convenience.

## Latest Release

| File | Version | Size | Min Android |
|------|---------|------|-------------|
| [`AURIX-v1.0.0-debug.apk`](./AURIX-v1.0.0-debug.apk) | 1.0.0 | ~9.5 MB | Android 10 (API 29) |

## Installation

1. Download [`AURIX-v1.0.0-debug.apk`](./AURIX-v1.0.0-debug.apk) to your Android phone.
2. Tap the file in your file manager (e.g. Files by Google, Solid Explorer).
3. If prompted, allow "Install unknown apps" for your file manager.
4. Tap **Install** → **Open**.
5. On first launch tap **Grant Music Access** to allow AURIX to read your audio files.

## Verification

The committed APK was built locally with the same Gradle command the CI uses:

```bash
cd android && ./gradlew assembleDebug
```

- Package: `com.ncx.aurix`
- Version: `1.0.0` (versionCode 1)
- Compile/Target SDK: 35 (Android 15)
- Min SDK: 29 (Android 10)
- Signed with the debug keystore (safe to install; for production use build a release-signed APK)

## Checksums

You can verify the file integrity after download:

```bash
sha256: <computed on commit>
md5:    <computed on commit>
```

> Run `sha256sum AURIX-v1.0.0-debug.apk` on your machine and compare against the value above.

---

NCX • NayonCodeX • *Music Beyond Limits*
