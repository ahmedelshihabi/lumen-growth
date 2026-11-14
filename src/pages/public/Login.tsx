import { useEffect, useState, type FormEvent } from 'react';
import { navigate } from '../../lib/router';
import { supabase } from '../../lib/supabase';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { PublicLayout } from './PublicLayout';

function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get('next') ?? '/app';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

export default function Login() {
  const { t } = useI18n();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.user && session.mode === 'live') navigate(safeNext(), { replace: true });
  }, [session.user, session.mode]);

  const redirectTo = `${window.location.origin}${safeNext()}`;

  const sendLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const google = async () => {
    if (!supabase) return;
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) setError(error.message);
  };

  const input =
    'mt-1 h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <PublicLayout>
      <section className="mx-auto max-w-md px-4 py-14 sm:px-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-8">
          <h1 className="text-xl font-semibold">{t('login.title')}</h1>
          {!supabase ? (
            <>
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{t('login.demoOnly')}</p>
              <a href="/app?demo" className="mt-6 flex h-11 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700">
                {t('login.openDemo')}
              </a>
            </>
          ) : sent ? (
            <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
              {t('login.sent', { email })}
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('login.subtitle')}</p>
              <form onSubmit={sendLink} className="mt-6">
                <label className="block text-sm font-medium">
                  {t('login.email')}
                  <input type="email" required autoComplete="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
                </label>
                <button type="submit" disabled={busy} className="mt-4 flex h-11 w-full items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                  {t('login.sendLink')}
                </button>
              </form>
              <div className="my-5 flex items-center gap-3 text-xs text-zinc-400">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
                {t('login.or')}
                <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <button
                type="button"
                onClick={() => void google()}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                </svg>
                {t('login.google')}
              </button>
            </>
          )}
          {error && <p className="mt-4 text-sm text-red-600">{t('common.error', { message: error })}</p>}
        </div>
      </section>
    </PublicLayout>
  );
}
