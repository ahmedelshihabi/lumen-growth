import type { ReactNode } from 'react';
import { Link } from '../../lib/router';
import { useSession } from '../../state/SessionContext';
import { LanguageToggle, useI18n } from '../../i18n';
import { IconLogo } from '../../components/icons';

export function PublicLayout({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { user } = useSession();
  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
            <IconLogo width={24} height={24} />
            <span className="truncate">{t('app.name')}</span>
          </Link>
          <nav className="ms-auto flex items-center gap-1 sm:gap-2">
            <Link href="/pricing" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white sm:inline-flex">
              {t('nav.pricing')}
            </Link>
            <LanguageToggle className="px-2.5" />
            <Link
              href={user ? '/app' : '/login'}
              className="inline-flex h-9 items-center rounded-full bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700 dark:bg-zap-400 dark:text-brand-950 dark:hover:bg-zap-300"
            >
              {user ? t('nav.openApp') : t('nav.login')}
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-zinc-500 dark:text-zinc-400 sm:px-6">
          <span>{t('landing.footer', { year: new Date().getFullYear() })}</span>
          <Link href="/pricing" className="hover:underline sm:hidden">
            {t('nav.pricing')}
          </Link>
          {/* Replace these with your real policy pages before launch (see SETUP_AR.md, legal checklist). */}
          <a href="/legal/terms.html" className="hover:underline">{t('landing.terms')}</a>
          <a href="/legal/privacy.html" className="hover:underline">{t('landing.privacy')}</a>
          <a href="/legal/refunds.html" className="hover:underline">{t('landing.refunds')}</a>
        </div>
      </footer>
    </div>
  );
}
