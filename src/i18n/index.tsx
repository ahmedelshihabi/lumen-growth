import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DICTS, type DictKey, type Lang } from './dict';
import { setDateLocale } from '../lib/dates';

const LANG_KEY = 'lumen.lang';

/** Intl locale per UI language. Latin digits in Arabic keep numbers easy to scan in tables. */
export const INTL_LOCALE: Record<Lang, string> = { ar: 'ar-EG-u-nu-latn', en: 'en-US' };

export type TFn = (key: DictKey, vars?: Record<string, string | number>) => string;

interface I18n {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  locale: string;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: TFn;
}

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  try {
    const p = new URLSearchParams(window.location.search).get('lang');
    if (p === 'ar' || p === 'en') return p;
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return 'ar'; // Arabic by default
}

export function applyLang(lang: Lang) {
  const el = document.documentElement;
  el.lang = lang;
  el.dir = lang === 'ar' ? 'rtl' : 'ltr';
  // Metric/money formatting in the dashboard deliberately stays en-US ("EGP 12,345", "1.2K")
  // in both languages: mixed-direction currency strings read badly inside dense tables.
  setDateLocale(INTL_LOCALE[lang]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const l = initialLang();
    applyLang(l);
    return l;
  });

  useEffect(() => applyLang(lang), [lang]);

  const setLang = useCallback((l: Lang) => {
    applyLang(l);
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];
    const t: TFn = (key, vars) => {
      let s = dict[key] ?? DICTS.en[key] ?? key;
      // In Arabic, wrap each value in a first-strong isolate (FSI…PDI) so "$1,234", "1.2%"
      // or "act_123" keep their own direction inside the right-to-left sentence.
      // Values with no Arabic letters ("1.33x", "EGP 1,250", "Search | Brand") get a left-to-right
      // isolate (LRI); anything containing Arabic gets a first-strong isolate (FSI).
      const wrap = (v: string | number) => {
        if (lang !== 'ar') return String(v);
        const str = String(v);
        return /[\u0600-\u06FF]/.test(str) ? `\u2068${str}\u2069` : `\u2066${str}\u2069`;
      };
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(wrap(v));
      return s;
    };
    return {
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      locale: INTL_LOCALE[lang],
      setLang,
      toggleLang: () => setLang(lang === 'ar' ? 'en' : 'ar'),
      t,
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside <I18nProvider>');
  return v;
}

export function LanguageToggle({ className = '' }: { className?: string }) {
  const { t, toggleLang, lang } = useI18n();
  return (
    <button
      type="button"
      onClick={toggleLang}
      aria-label={t('common.languageLabel')}
      lang={lang === 'ar' ? 'en' : 'ar'}
      className={`inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800 ${className}`}
    >
      {t('common.language')}
    </button>
  );
}
