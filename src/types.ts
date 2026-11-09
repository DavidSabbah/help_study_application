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
  short: string;
}

export interface RoiBox {
  id: string;
  /**
   * Unrotated rectangle, normalized to the displayed image.
   * With rotation, the origin may sit slightly outside 0..1 so the
   * turned region can stay inside the photo.
   */
  normX: number;
  normY: number;
  normW: number;
  normH: number;
  /** Clockwise degrees around the region center. */
  rotation?: number;
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

export type ProblemTypeKey =
  | 'explain_lines'
  | 'solve_problem'
  | 'notebook_lesson'
  | 'summarize'
  | 'argument'
  | 'raw_only';

export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
}

