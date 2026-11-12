import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { MessageKey, translate } from './catalog';
import {
  AppLanguage,
  AppLanguageChoice,
  deviceAppLanguage,
  deviceLocaleTag,
  isRtlLanguage,
  languageFromTag,
  languageOption
} from './languages';
import { loadAppLanguageChoice, saveAppLanguageChoice } from '../storage/settingsStorage';

interface I18nValue {
  lang: AppLanguage;
  choice: AppLanguageChoice;
  locale: string;
  direction: 'ltr' | 'rtl';
  followsPhone: boolean;
  phoneLanguage: AppLanguage;
  phoneSupported: boolean;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setAppLanguage: (next: AppLanguageChoice) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [choice, setChoice] = useState<AppLanguageChoice>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancel = false;
    loadAppLanguageChoice().then((saved) => {
      if (cancel) return;
      setChoice(saved);
      setReady(true);
    });
    return () => {
      cancel = true;
    };
  }, []);

  const phoneLanguage = deviceAppLanguage();
  const phoneSupported = languageFromTag(deviceLocaleTag()) !== null;
  const lang = choice === 'system' ? phoneLanguage : choice;

  const setAppLanguage = useCallback((next: AppLanguageChoice) => {
    setChoice(next);
    void saveAppLanguageChoice(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      choice,
      locale: languageOption(lang).locale,
      direction: isRtlLanguage(lang) ? 'rtl' : 'ltr',
      followsPhone: choice === 'system',
      phoneLanguage,
      phoneSupported,
      t: (key, vars) => translate(lang, key, vars),
      setAppLanguage
    }),
    [lang, choice, phoneLanguage, phoneSupported, setAppLanguage]
  );

  if (!ready) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return value;
}
