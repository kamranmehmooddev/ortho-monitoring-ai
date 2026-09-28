# Ortho Monitoring AI: patient app (Android)

Kotlin · Jetpack Compose (Material 3) · CameraX · WorkManager · EncryptedSharedPreferences · OkHttp.

## Modules

| Module | Contents | Builds without Android SDK |
|---|---|---|
| `core` | Pure-Kotlin domain logic: on-device image-quality analysis (`quality-v1.2`, same thresholds as the server), guided capture steps and voice scripts, offline upload-queue policy, patient-facing status labels, wear streaks | ✅ `gradle :core:test` |
| `app` | Compose UI, CameraX capture, Keystore-encrypted outbox, upload worker, reminders | needs Android SDK 35 |

`core/src/test` checks **parity with the server** by running the Kotlin quality analyser over the same synthetic seed
images (`server/seed-assets`) that the server's Vitest suite uses.

## Features

- **Activation**: clinic code plus a single-use activation code gives the device a scoped, single-patient token, stored in
  EncryptedSharedPreferences. The app has no AI keys and never calls an AI provider.
- **Home**: today's action (check-in due, retake requested, switch approved, waiting), aligner stage ring, next planned
  change, next check-in, next appointment, wear sparkline, check-in history with clinic feedback, and a local outbox
  with upload progress or a "waiting for connection" state.
- **Guided check-in (about 3 minutes)**:
  1. Quick questions: current aligner, wear hours, fit, symptoms, pain, concerns.
  2. Guided capture per protocol view, with or without aligners. The screen is locked to landscape, shows a framing
     overlay (ellipse for bite views, arch ring for occlusal views, head-turn arrow for side views), speaks
     instructions with TextToSpeech (can be muted), and runs **live light, focus, glare and framing checks** on the
     preview's Y plane. The shutter turns green only after several stable good frames, with optional auto-capture.
     After 8 s the patient may capture anyway and the photo is flagged. Every capture is re-checked at full
     resolution, and a failed check gives a specific retake tip.
  3. Review grid: tap any photo to retake it, then send.
- **Offline-safe uploads**: photos are re-encoded (EXIF and GPS dropped) and AES-GCM encrypted with a non-exportable
  Keystore key into an app-private outbox. `UploadWorker` (WorkManager, network-constrained, exponential backoff) then
  creates the check-in, uploads each photo and submits. Every step is idempotent on the server (client UUID, content
  hash), so it can resume after process death or reboot. Local files are deleted once the server confirms receipt.
- **Report a problem**: cracked or lost aligner, attachment off, poor fit, pain, irritation, loose bracket, poking wire,
  or other, with pain level, details and photos. The server triages it (P1–P4) and alerts staff. The patient sees
  clinic-approved interim guidance, plus emergency guidance for P1. No appointment is booked automatically.
- **Secure chat**, **wear-time log** with streaks, **clinic-approved education**, **progress** (before/now photos shown
  only after clinician review, plus a stage timeline), **appointments**, **settings** (voice, auto-capture, reminders,
  sign out).
- **Reminders**: a daily WorkManager job at 19:00 checks whether a check-in or retake is due, or a message is unread.
- **Privacy**: `FLAG_SECURE` (no screenshots or recents preview), backup and device transfer excluded, cleartext
  allowed only for the local development API.

## Build

```bash
# with Android Studio / an Android SDK (ANDROID_HOME or local.properties sdk.dir)
./gradlew :app:assembleDebug                       # emulator API → http://10.0.2.2:4000/api/v1/
./gradlew :app:assembleRelease -PomaApi=https://api.example.com/api/v1/
```

`settings.gradle.kts` includes `:app` only when an Android SDK is present, so `:core` builds and tests on any JVM
(the CI container used to create this project had no Android SDK, so only `:core` was compiled and tested there).

Run a dev API on your machine (`npm run seed && npm start` at the repo root), invite a patient from the clinic
workspace, then activate the app with clinic code `lumen-ortho`.
