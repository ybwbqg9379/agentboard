import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

function initialLanguage() {
  // Vitest / Vite test: keep English so unit tests that assert copy stay deterministic
  // (CI or dev machines with zh browser locale would otherwise flip timeline strings).
  if (import.meta.env?.MODE === 'test') {
    return 'en';
  }
  try {
    const stored = localStorage.getItem('agentboard-locale');
    if (stored === 'en' || stored === 'zh-CN') return stored;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language?.toLowerCase() || '';
    if (lang.startsWith('zh')) return 'zh-CN';
  }
  return 'en';
}

function applyDocumentLang(lng) {
  document.documentElement.lang = lng === 'zh-CN' ? 'zh-CN' : 'en';
}

/** RTL when we add ar/he/fa/ur; zh/en stay ltr */
function applyDocumentDirection(lng) {
  const code = (lng || '').split('-')[0].toLowerCase();
  const rtl = ['ar', 'he', 'fa', 'ur'].includes(code);
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
}

function applyDocumentTitle() {
  document.title = i18n.t('common.appTitle');
}

const lng = initialLanguage();
applyDocumentLang(lng);
applyDocumentDirection(lng);

i18n.on('languageChanged', (next) => {
  applyDocumentLang(next);
  applyDocumentDirection(next);
  applyDocumentTitle();
  try {
    localStorage.setItem('agentboard-locale', next);
  } catch {
    /* ignore */
  }
});

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    'zh-CN': { translation: zhCN },
  },
  lng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

applyDocumentTitle();

export default i18n;
