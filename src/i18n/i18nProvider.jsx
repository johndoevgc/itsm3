import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import en from './en.json';
import zh from './zh.json';
import ms from './ms.json';
import ta from './ta.json';

const LOCALES = { en, zh, ms, ta };
const LOCALE_KEY = 'vgc_itsm_locale';
const DEFAULT_LOCALE = 'en';

const I18nContext = createContext(null);

function getInitialLocale() {
  try {
    const stored = localStorage.getItem(LOCALE_KEY);
    if (stored && LOCALES[stored]) return stored;
  } catch (_) { /* SSR or private browsing */ }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(getInitialLocale);

  const setLocale = useCallback((loc) => {
    if (!LOCALES[loc]) return;
    setLocaleState(loc);
    try { localStorage.setItem(LOCALE_KEY, loc); } catch (_) {}
  }, []);

  const t = useCallback((key, fallback) => {
    return LOCALES[locale]?.[key] ?? LOCALES.en[key] ?? fallback ?? key;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return React.createElement(I18nContext.Provider, { value }, children);
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) return (key) => LOCALES.en[key] ?? key;
  return ctx.t;
}

export function useLocale() {
  const ctx = useContext(I18nContext);
  if (!ctx) return { locale: DEFAULT_LOCALE, setLocale: () => {} };
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}

export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ms', label: 'Bahasa Melayu' },
  { code: 'ta', label: 'தமிழ்' },
];
