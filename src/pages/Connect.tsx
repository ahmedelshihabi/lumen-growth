import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, ChannelBadge, PageHeader, cx } from '../components/ui';
import { primaryBtn } from '../components/Gates';
import { IconLink } from '../components/icons';
import { env, supabase } from '../lib/supabase';
import { navigate } from '../lib/router';
import { formatDateTime } from '../lib/dates';
import { metaOAuthDialogUrl } from '../../supabase/functions/_shared/meta.ts';
import { useSession } from '../state/SessionContext';
import { useApp } from '../state/AppContext';
import { useI18n } from '../i18n';

interface AccountRow {
  id: string;
  meta_account_id: string;
  name: string;
  currency: string;
  selected: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

interface ConnectionInfo {
  meta_user_name: string | null;
  expires_at: string | null;
}

const STATE_KEY = 'lumen.metaOAuthState';

export default function Connect() {
  const { t } = useI18n();
  const session = useSession();
  const app = useApp();
  const { workspace, entitlements: ent, mode } = session;
  const live = mode === 'live' && !!supabase;

  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exchanged = useRef(false);

  const load = useCallback(async () => {
    if (!live || !workspace) return;
    const [c, a] = await Promise.all([
      supabase!.rpc('get_meta_connection', { ws: workspace.id }),
      supabase!
        .from('ad_accounts')
        .select('id, meta_account_id, name, currency, selected, last_synced_at, last_sync_error')
        .eq('workspace_id', workspace.id)
        .order('name'),
    ]);
    const row = (c.data as ConnectionInfo[] | null)?.[0] ?? null;
    setConn(row);
    const rows = (a.data as AccountRow[] | null) ?? [];
    setAccounts(rows);
    setDraft(new Set(rows.filter((r) => r.selected).map((r) => r.id)));
  }, [live, workspace]);

  // Demo: sample accounts, nothing leaves the browser.
  useEffect(() => {
    if (live) return;
    const rows: AccountRow[] = (app.data?.accounts ?? []).map((a, i) => ({
      id: a.id,
      meta_account_id: a.id,
      name: a.name,
      currency: a.currency,
      selected: i < 2,
      last_synced_at: app.data ? `${app.data.asOf}T06:00:00Z` : null,
      last_sync_error: null,
    }));
    setAccounts(rows);
    setDraft(new Set(rows.filter((r) => r.selected).map((r) => r.id)));
    setConn({ meta_user_name: 'Demo User', expires_at: null });
  }, [live, app.data]);

  // Live: initial load, then handle the ?code=...&state=... redirect from Facebook Login.
  useEffect(() => {
    if (!live || !workspace) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const oauthError = params.get('error_description') ?? params.get('error');

    if (oauthError) {
      setError(oauthError);
      navigate('/app/connect', { replace: true });
    }
    if (!code || exchanged.current) {
      void load();
      return;
    }
    exchanged.current = true;
    let expected: string | null = null;
    try {
      expected = sessionStorage.getItem(STATE_KEY);
      sessionStorage.removeItem(STATE_KEY);
    } catch {
      /* ignore */
    }
    navigate('/app/connect', { replace: true });
    if (!expected || expected !== state) {
      setError(t('connect.stateMismatch'));
      void load();
      return;
    }
    setBusy(true);
    setStatus(t('connect.exchanging'));
    void supabase!.functions
      .invoke('meta-oauth-callback', { body: { code, redirect_uri: `${window.location.origin}/app/connect`, workspace_id: workspace.id } })
      .then(async ({ error }) => {
        setBusy(false);
        setStatus(null);
        if (error) setError(error.message);
        await load();
      });
  }, [live, workspace, load, t]);

  const startOAuth = () => {
    if (!env.metaAppId) return;
    const state = crypto.randomUUID();
    try {
      sessionStorage.setItem(STATE_KEY, state);
    } catch {
      /* ignore */
    }
    window.location.assign(metaOAuthDialogUrl(env.metaAppId, `${window.location.origin}/app/connect`, state));
  };

  const max = ent.maxAdAccounts;
  const toggle = (id: string) =>
    setDraft((d) => {
      const n = new Set(d);
      if (n.has(id)) n.delete(id);
      else if (n.size < max) n.add(id);
      return n;
    });

  const dirty = accounts.some((a) => a.selected !== draft.has(a.id));

  const saveSelection = async () => {
    setError(null);
    if (!live) {
      setAccounts((rows) => rows.map((r) => ({ ...r, selected: draft.has(r.id) })));
      setStatus(t('common.saved'));
      return;
    }
    setBusy(true);
    // Deselect first so the database limit trigger never sees a transient overflow.
    const off = accounts.filter((a) => a.selected && !draft.has(a.id)).map((a) => a.id);
    const on = accounts.filter((a) => !a.selected && draft.has(a.id)).map((a) => a.id);
    let err: string | null = null;
    if (off.length) err = (await supabase!.from('ad_accounts').update({ selected: false }).in('id', off)).error?.message ?? null;
    for (const id of on) {
      if (err) break;
      err = (await supabase!.from('ad_accounts').update({ selected: true }).eq('id', id)).error?.message ?? null;
    }
    setBusy(false);
    if (err) setError(err.includes('plan_limit') ? t('connect.limitReached') : err);
    else setStatus(t('common.saved'));
    await load();
  };

  const syncNow = async () => {
    setError(null);
    if (!live) {
      setStatus(t('connect.synced'));
      return;
    }
    setBusy(true);
    setStatus(t('connect.syncing'));
    const { error } = await supabase!.functions.invoke('meta-sync', { body: { workspace_id: workspace?.id } });
    setBusy(false);
    setStatus(error ? null : t('connect.synced'));
    if (error) setError(error.message);
    await load();
    app.reload();
  };

  const selectedCount = draft.size;

  return (
    <>
      <PageHeader title={t('connect.title')} subtitle={t('connect.subtitle')} />

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
        {mode === 'demo' ? t('connect.demoNote') : t('connect.beta')}
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-4 px-4 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1877f2]/10 text-[#1877f2]">
            <IconLink />
          </div>
          <div className="min-w-0 flex-1">
            {conn ? (
              <>
                <div className="text-sm font-medium">{t('connect.connectedAs', { name: conn.meta_user_name ?? 'Meta' })}</div>
                {conn.expires_at && <div className="text-xs text-zinc-500 dark:text-zinc-400">{t('connect.expires', { date: formatDateTime(conn.expires_at) })}</div>}
              </>
            ) : (
              <div className="text-sm text-zinc-600 dark:text-zinc-300">{t('connect.subtitle')}</div>
            )}
            {live && !env.metaAppId && <div className="mt-1 text-xs text-red-600">{t('connect.notConfigured')}</div>}
          </div>
          <button
            type="button"
            onClick={startOAuth}
            disabled={!live || !env.metaAppId || busy}
            className={cx(primaryBtn, 'bg-[#1877f2] hover:bg-[#166fe0] disabled:cursor-not-allowed disabled:opacity-50')}
          >
            {conn ? t('connect.reconnect') : t('connect.button')}
          </button>
        </div>
      </Card>

      <Card
        className="mt-4"
        title={t('connect.accounts')}
        action={<span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{t('connect.limit', { used: selectedCount, max })}</span>}
      >
        {accounts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-zinc-500">{t('connect.noAccounts')}</div>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {accounts.map((a) => {
              const checked = draft.has(a.id);
              const blocked = !checked && selectedCount >= max;
              return (
                <li key={a.id}>
                  <label className={cx('flex items-center gap-3 px-4 py-3', blocked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40')}>
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={checked} disabled={blocked || busy} onChange={() => toggle(a.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium"><bdi>{a.name}</bdi></span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400" dir="ltr">
                        {a.meta_account_id} · {a.currency}
                      </span>
                    </span>
                    <span className="text-end text-xs text-zinc-500 dark:text-zinc-400">
                      {a.last_sync_error ? (
                        <span className="text-red-600" title={a.last_sync_error}>
                          {a.last_sync_error.slice(0, 60)}
                        </span>
                      ) : a.last_synced_at ? (
                        t('connect.lastSync', { date: formatDateTime(a.last_synced_at, true) })
                      ) : (
                        t('connect.never')
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => void saveSelection()}
            disabled={!dirty || busy}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t('connect.saveSelection')}
          </button>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={busy || accounts.every((a) => !a.selected)}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {t('connect.syncNow')}
          </button>
          {selectedCount >= max && <span className="text-xs text-amber-700 dark:text-amber-300">{t('connect.limitReached')}</span>}
          <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
            {status}
          </span>
        </div>
        {error && <div className="border-t border-zinc-100 px-4 py-3 text-sm text-red-600 dark:border-zinc-800">{t('common.error', { message: error })}</div>}
      </Card>

      {/* Google Ads is built on branch feat/google-ads and goes live once Google approves the developer token. */}
      <Card className="mt-4" title={t('connect.otherTitle')}>
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {(['google', 'tiktok'] as const).map((ch) => (
            <li key={ch} className="flex flex-wrap items-center gap-3 px-4 py-4">
              <ChannelBadge channel={ch} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t(ch === 'google' ? 'connect.google' : 'connect.tiktok')}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{t(ch === 'google' ? 'connect.googleBody' : 'connect.tiktokBody')}</div>
              </div>
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={t('connect.soonNote')}>
                {t('connect.soon')}
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{t('connect.soonNote')}</p>
      </Card>
    </>
  );
}
