# StudyLens

StudyLens is an Android study companion for any printed page: a textbook, an exercise, an article, a worksheet, or a book. You photograph the page, mark the part you want, read it on the phone, and send a ready-made prompt to ChatGPT, Gemini, NotebookLM, or any other app.

The reading happens on the device. StudyLens has no server of its own. The chosen assistant only receives the prompt when you open it or share it.

## What you can do

1. Take a photo, pick one from the gallery, or open a bundled sample page.
2. Rotate the page, clean shadows and curved lines, and draw one or more regions.
3. Run local OCR in one or more languages: French, English, Hebrew, German, Spanish, Italian, Latin, Ancient Greek, and Portuguese.
4. Choose a study task and the language the answer should be written in. The task sentence is rewritten in that language.
5. Open the prompt in an in-app browser, or share it to WhatsApp and the other apps on the phone.

The header title returns to the photo screen from anywhere. The back control is the chevron in the header.

## How a session runs

```text
Photo  →  regions  →  local OCR  →  prompt  →  browser or share sheet
```

On the prompt screen you can still edit the task and the extracted text before sending them. **Execute** copies the prompt and opens the selected page. The share button sends the same prompt through the Android share sheet.

## Requirements

- Node.js and npm
- The Expo / React Native toolchain used by this project (`expo` 52, React Native 0.76)
- Android Studio, an Android SDK, and a device or emulator for an Android build

## Develop

```bash
npm install
npx expo start --dev-client
```

A development build does not contain the interface. The phone loads it from the computer, so this command has to stay running. With the phone attached by USB:

```bash
adb reverse tcp:8081 tcp:8081
```

Other commands:

```bash
npm run android      # debug build on a device or emulator
npm run typecheck    # tsc --noEmit
```

`ocr-bench` is a separate Node script for trying the page-cleaning and OCR steps on still images. It is not part of the phone app. From that folder, run `npm install` and then `npm run ocr`.

## Install a build that opens by itself

The debug app shows “Unable to load script” when the computer is off. A release APK carries the interface inside it.

```bash
cd android
set NODE_ENV=production
gradlew.bat assembleRelease
```

The file is `android/app/build/outputs/apk/release/app-release.apk`. Install it with:

```bash
adb install -r android\app\build\outputs\apk\release\app-release.apk
```

That APK is signed with the debug key in `android/app`, which is enough for your own phone. A Play Store upload needs a keystore of its own. See the comment in `android/app/build.gradle`.

## Where to read more

The screen flow, the OCR pipeline, and where each file sits are described in [ARCHITECTURE.md](ARCHITECTURE.md).
