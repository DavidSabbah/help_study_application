export type OcrLanguageCode =
  | 'heb'
  | 'fra'
  | 'eng'
  | 'deu'
  | 'spa'
  | 'ita'
  | 'lat'
  | 'grc'
  | 'por';

export interface OcrLanguageOption {
  code: OcrLanguageCode;
  label: string;
  flag: string;
}

export interface RoiBox {
  id: string;
  /** Normalized coordinates (0..1) relative to the displayed image */
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  /** Cropped local URI produced by expo-image-manipulator */
  croppedUri?: string;
  /** Base64 PNG/JPEG string used by local Tesseract.js OCR */
  base64?: string;
}

export interface LlmLink {
  id: string;
  icon: string;
  title: string;
  url: string;
  desc: string;
}

export type PromptPresetKey =
  | 'philosophy_explain'
  | 'notebook_lesson'
  | 'argument_breakdown'
  | 'exercise_help'
  | 'raw_only';

export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
}

