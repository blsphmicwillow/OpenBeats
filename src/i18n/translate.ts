import { DEFAULT_LANGUAGE, type LanguageCode } from './languages';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';

/** Keys are the English source strings, so a missing translation falls back to English. */
const DICTIONARIES: Record<LanguageCode, Record<string, string>> = {
  en: {},
  es,
  fr,
  de,
};

export function translate(
  language: LanguageCode,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const text = DICTIONARIES[language]?.[key] ?? DICTIONARIES[DEFAULT_LANGUAGE][key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
