# 📖 StudyLens

**StudyLens** is a React Native / Expo study companion app designed for reading philosophy & textbook pages:
1. **Snap or Pick a Book Page**: Capture a photo from your camera or gallery.
2. **Book Image Preprocessing**: Automatically removes shadows and uneven lighting (2-pass integral-image illumination normalization), straightens tilted lines (projection-profile deskewing), flattens curved book lines near the spine (vertical strip cross-correlation de-warping), and applies Sauvola local adaptive contrast enhancement.
3. **Interactive ROI Selection**: Draw one or more Region of Interest (ROI) boxes over passages or exercises.
4. **Local Multi-Language OCR**: Runs local Tesseract.js OCR (French, English, Hebrew, German, Spanish, Italian, Latin, Ancient Greek, Portuguese).
5. **One-Tap Study Prompt & LLM Launcher**: Formats your extracted passage with customizable study modes and copies it directly to your clipboard to open in ChatGPT, Gemini, or NotebookLM.

## 🚀 Getting Started

```bash
npm install
npx expo start
```

- **Android**: `npm run android`
- **Typecheck**: `npm run typecheck`
