# StudyLens architecture

StudyLens is a single-screen React Native app. One component, `App`, owns the session and swaps three phases. Image cleanup and OCR run inside a hidden WebView. Nothing is uploaded to a StudyLens server.

```text
index.ts
  └── App.tsx                         session, navigation, header
        ├── RoiSelector               draw and edit regions on the photo
        ├── TesseractOcrBridge        hidden WebView: cleanup + Tesseract.js
        ├── ComboBox                  task and destination pickers
        ├── SettingsModal             page cleanup switch and saved links
        ├── ZoomableImageModal        inspect a cleaned crop
        └── WebView                   the chosen assistant, in the browser phase

src/llmPrompts.ts                     task sentences and the final prompt
src/storage/settingsStorage.ts        languages, links, cleanup switch
src/types.ts                          photo, region, language, and link types
```

`LlmPopupModal` is an earlier prompt sheet. `App` does not mount it.

## Session phases

`App` keeps one phase: `capture`, `prompt`, or `browser`.

| Phase | What the person sees | How they leave it |
| --- | --- | --- |
| `capture` | Camera, gallery, samples, the photo tools, regions, OCR languages | OCR finishes, or **Open prompt** if text already exists |
| `prompt` | Task, answer language, destination, extracted text, share | **Execute** opens `browser`. The header chevron returns to `capture` |
| `browser` | The selected page in a WebView, with the prompt already on the clipboard | The header chevron returns to the screen that opened it |

The **StudyLens** title always clears the browser and returns to `capture`. It does not delete the photo. Settings can also open a link, and the chevron then returns to settings.

```text
capture ──OCR or Open prompt──► prompt ──Execute──► browser
   ▲                              │                    │
   └──────── chevron or title ────┴──── chevron ──────┘
```

## Capture and regions

A photo is a local `uri` plus its pixel size (`CapturedPhoto`). It comes from `expo-image-picker`, from `expo-image-manipulator` after a rotation, or from a bundled sample through `expo-asset`.

Regions are `RoiBox` values. The rectangle is stored as fractions of the displayed image, not as pixels, so it survives layout changes. `rotation` is degrees around the region center. `RoiSelector` draws the boxes, pinch-zooms the page, and crops a JPEG with `expo-image-manipulator` when OCR starts. The crop is kept as a file URI and as base64.

**Clean** on the photo runs the same page cleanup as OCR, but on the whole picture, and replaces the working photo. The original is kept so the page can be restored. The cleanup switch in settings only changes whether OCR preprocesses. It is stored on the device.

## OCR

`TesseractOcrBridge` renders a 0×0 WebView. The page loads Tesseract.js 5 from a CDN and talks to React Native with `postMessage`. `App` calls `recognizeRois` with the crops, the selected language codes, and whether cleanup is on.

Tesseract workers are cached in the WebView by language, so a later run does not download the language data again. The first run needs a network connection for that download. After that, recognition itself stays in the WebView.

When cleanup is on, each crop goes through `preprocessBookImage` before recognition:

1. Scale the page so the long side stays near a useful OCR size.
2. Flatten illumination twice: a coarse pass for shadows, then a finer pass.
3. Stretch contrast and whiten the paper.
4. Turn the page if it is sideways, estimate the line spacing, and enlarge small text.
5. Deskew from the projection profile, then flatten curved lines by tracking each text line.
6. Turn the page right-side up when the line profile says it is upside down.
7. Sharpen the letters and whiten the paper again.

The bridge returns the recognized text, a preview of each cleaned crop, and stats (`rot90`, skew angle, curve shift, width, height). `App` shows those previews and moves to the prompt phase. Several languages are passed together, joined the way Tesseract expects (`fra+eng`, and so on).

Hebrew is the right-to-left language. The extracted-text field and the task field follow the direction of the page language and the answer language.

## Prompt and hand-off

`src/llmPrompts.ts` holds five tasks: Explain, Solve, Notebook, Summarize, and Argument. `taskSentence` returns the instruction in the answer language. Editing the sentence by hand marks it as custom, so a later language change does not overwrite it until another task is chosen.

`buildTaskPrompt` joins three parts:

```text
<task sentence>

Answer in <language>.

"""
<extracted text>
"""
```

**Execute** copies that string and opens the selected link in the browser phase. The share button calls the Android share sheet with the same string, so it can go to WhatsApp or any other app. StudyLens does not call an LLM API.

Default destinations are ChatGPT, Gemini, and a NotebookLM notebook. Settings can add, edit, and delete links. Those links, the OCR languages, the answer language, and the cleanup switch are JSON in AsyncStorage (`src/storage/settingsStorage.ts`). Photos and OCR text live only in component state for the current session.

## Android builds

`index.ts` registers `App` with Expo. The native project is the `android` directory, package `com.david.studylens`.

| Build | Command | What the phone needs |
| --- | --- | --- |
| Debug | `npx expo start --dev-client`, then `npm run android` | The computer, serving the JavaScript bundle |
| Release | `gradlew.bat assembleRelease` in `android` | Nothing. The bundle is inside the APK |

The release type in `android/app/build.gradle` is still signed with the debug keystore. That installs on a personal phone. It is not a Play Store signing setup.

`ocr-bench` repeats the cleaning and Tesseract steps in Node, on fixture images, so the pipeline can be judged without a phone.
