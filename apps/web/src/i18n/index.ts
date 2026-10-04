import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';

/**
 * English is the only UI language in the beta (ADR-020); Hungarian follows. All copy lives in
 * `en.ts` so translation is a data change, and a test checks every key used in code exists.
 */
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
