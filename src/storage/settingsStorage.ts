import AsyncStorage from '@react-native-async-storage/async-storage';
import { LlmLink, OcrLanguageCode, OcrLanguageOption } from '../types';

const STORAGE_KEY_LINKS = '@studylens/custom_links_v2';
const STORAGE_KEY_LANGS = '@studylens/ocr_langs_v2';
const STORAGE_KEY_PREPROCESS = '@studylens/preprocess_v1';
const STORAGE_KEY_RESPONSE_LANG = '@studylens/response_lang_v1';

export const AVAILABLE_OCR_LANGUAGES: OcrLanguageOption[] = [
  { code: 'heb', label: 'עברית', flag: '🇮🇱', short: 'HE' },
  { code: 'fra', label: 'Français', flag: '🇫🇷', short: 'FR' },
  { code: 'eng', label: 'English', flag: '🇬🇧', short: 'EN' },
  { code: 'deu', label: 'Deutsch', flag: '🇩🇪', short: 'DE' },
  { code: 'spa', label: 'Español', flag: '🇪🇸', short: 'ES' },
  { code: 'ita', label: 'Italiano', flag: '🇮🇹', short: 'IT' },
  { code: 'lat', label: 'Latin', flag: '🏛️', short: 'LA' },
  { code: 'grc', label: 'Greek', flag: '🏺', short: 'GR' },
  { code: 'por', label: 'Português', flag: '🇵🇹', short: 'PT' }
];

export const DEFAULT_LLM_LINKS: LlmLink[] = [
  {
    id: 'default-chatgpt',
    icon: '💬',
    title: 'ChatGPT',
    url: 'https://chatgpt.com/',
    desc: ''
  },
  {
    id: 'default-gemini',
    icon: '✨',
    title: 'Gemini',
    url: 'https://gemini.google.com/app',
    desc: ''
  },
  {
    id: 'default-rozensweig-notebook',
    icon: '📓',
    title: 'Gemini Rozensweig Notebook',
    url: 'https://notebook.google.com/notebook/4cc82aec-e02c-48ef-b2e9-c37f95e05fd1',
    desc: ''
  }
];

export async function loadSavedLinks(): Promise<LlmLink[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_LINKS);
    if (!raw) return [...DEFAULT_LLM_LINKS];
    const parsed = JSON.parse(raw) as LlmLink[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_LLM_LINKS];
  } catch {
    return [...DEFAULT_LLM_LINKS];
  }
}

export async function saveLinks(links: LlmLink[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_LINKS, JSON.stringify(links));
}

export async function loadSelectedOcrLangs(): Promise<OcrLanguageCode[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_LANGS);
    if (!raw) return ['fra'];
    const parsed = JSON.parse(raw) as OcrLanguageCode[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : ['fra'];
  } catch {
    return ['fra'];
  }
}

export async function saveSelectedOcrLangs(langs: OcrLanguageCode[]): Promise<void> {
  const safe: OcrLanguageCode[] = langs.length > 0 ? langs : ['fra'];
  await AsyncStorage.setItem(STORAGE_KEY_LANGS, JSON.stringify(safe));
}

export async function loadPreprocessEnabled(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_PREPROCESS);
    if (raw === null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

export async function savePreprocessEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_PREPROCESS, enabled ? '1' : '0');
}

export async function loadResponseLang(): Promise<OcrLanguageCode> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_RESPONSE_LANG);
    const known = AVAILABLE_OCR_LANGUAGES.some((lang) => lang.code === raw);
    return known ? (raw as OcrLanguageCode) : 'fra';
  } catch {
    return 'fra';
  }
}

export async function saveResponseLang(lang: OcrLanguageCode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_RESPONSE_LANG, lang);
}



