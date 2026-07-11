import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ta from './ta.json';

const storedLang =
  typeof localStorage !== 'undefined' ? localStorage.getItem('eworks-lang') : null;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ta: { translation: ta },
  },
  lng: storedLang === 'ta' || storedLang === 'en' ? storedLang : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ்' },
] as const;

export default i18n;
