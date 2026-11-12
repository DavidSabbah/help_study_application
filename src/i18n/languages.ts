import { I18nManager } from 'react-native';

export const APP_LANGUAGES = [
  { code: 'en', label: 'English', locale: 'en-GB' },
  { code: 'fr', label: 'Français', locale: 'fr-FR' },
  { code: 'he', label: 'עברית', locale: 'he-IL' },
  { code: 'de', label: 'Deutsch', locale: 'de-DE' },
  { code: 'es', label: 'Español', locale: 'es-ES' },
  { code: 'it', label: 'Italiano', locale: 'it-IT' },
  { code: 'pt', label: 'Português', locale: 'pt-PT' }
] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number]['code'];
export type AppLanguageChoice = AppLanguage | 'system';

const CODES = new Set<string>(APP_LANGUAGES.map((item) => item.code));

export function isAppLanguage(value: string): value is AppLanguage {
  return CODES.has(value);
}

export function deviceLocaleTag(): string {
  const native = I18nManager.getConstants().localeIdentifier;
  if (native) return native;
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en';
  } catch {
    return 'en';
  }
}

export function languageFromTag(tag: string): AppLanguage | null {
  const code = tag.toLowerCase().replace('_', '-').split('-')[0];
  if (code === 'iw') return 'he';
  return isAppLanguage(code) ? code : null;
}

export function deviceAppLanguage(): AppLanguage {
  return languageFromTag(deviceLocaleTag()) || 'en';
}

export function languageOption(code: AppLanguage) {
  return APP_LANGUAGES.find((item) => item.code === code) || APP_LANGUAGES[0];
}

export function isRtlLanguage(code: AppLanguage): boolean {
  return code === 'he';
}
