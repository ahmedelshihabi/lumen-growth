import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { rememberWorkspace, useSession } from '../state/SessionContext';
import { useI18n } from '../i18n';
import { IconLogo } from '../components/icons';
import type { DictKey } from '../i18n/dict';

const KNOWN = ['invite_wrong_email', 'invite_expired', 'invite_invalid', 'plan_limit_members', 'not_authenticated'];

/** /invite/<token>: joins the workspace the link was made for, then opens it. */
export default function AcceptInvite({ token }: { token: string }) {
  const { t } = useI18n();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !supabase || !session.user) return;
    started.current = true;
    void supabase.rpc('accept_invite', { invite_token: token }).then(({ data, error: e }) => {
      if (e) {
        const code = KNOWN.find((k) => e.message.includes(k));
        setError(code ? t(`invite.err.${code}` as DictKey, { email: session.user?.email ?? '' }) : e.message);
        return;
      }
      rememberWorkspace(data as string);
      window.location.assign('/app');
    });
  }, [token, session.user, t]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <IconLogo width={40} height={40} className="mx-auto" />
        {error ? (
          <>
            <h1 className="mt-4 text-lg font-bold">{t('invite.failedTitle')}</h1>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{error}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => void session.signOut()} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                {t('invite.switchAccount')}
              </button>
              <a href="/app" className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                {t('invite.openApp')}
              </a>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-300">{t('invite.joining')}</p>
        )}
      </div>
    </div>
  );
}
