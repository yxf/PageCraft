import { en } from './locales/en';

export type LanguagePreference = 'auto' | 'zh-CN' | 'en';
let preference: LanguagePreference = 'auto';
const listeners = new Set<() => void>();
export function normalizePreference(value: unknown): LanguagePreference {
  return value === 'zh-CN' || value === 'en' ? value : 'auto';
}
export function resolveLanguage(
  value: LanguagePreference,
  browserLanguage: string,
): 'zh-CN' | 'en' {
  return value === 'auto' ? (/^zh\b/i.test(browserLanguage) ? 'zh-CN' : 'en') : value;
}
export const getPreference = () => preference;
export const getLocale = () =>
  resolveLanguage(preference, typeof navigator === 'undefined' ? 'en' : navigator.language);
export const subscribeLanguage = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function translate(key: string, locale: 'zh-CN' | 'en', values: unknown[] = []) {
  const text = locale === 'en' ? (en[key] ?? key) : key;
  return text.replace(/\{(\d+)\}/g, (match, index) =>
    index < values.length ? String(values[index]) : match,
  );
}
export const t = (key: string, ...values: unknown[]) => translate(key, getLocale(), values);
function update(value: unknown) {
  preference = normalizePreference(value);
  document.documentElement.lang = getLocale();
  document.title = getLocale() === 'en' ? 'PageCraft' : 'PageCraft · 页匠';
  listeners.forEach((listener) => listener());
}
const extension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
export async function initializeLanguage() {
  try {
    update(
      extension
        ? (await chrome.storage.local.get('language')).language
        : localStorage.getItem('pagecraft-language'),
    );
  } catch {
    update('auto');
  }
  if (extension)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.language) update(changes.language.newValue);
    });
  else
    window.addEventListener('storage', (event) => {
      if (event.key === 'pagecraft-language') update(event.newValue);
    });
  window.addEventListener('languagechange', () => update(preference));
}
export async function setLanguage(value: LanguagePreference) {
  if (extension) await chrome.storage.local.set({ language: value });
  else localStorage.setItem('pagecraft-language', value);
  update(value);
}
