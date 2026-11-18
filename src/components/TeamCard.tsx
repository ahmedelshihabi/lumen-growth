import { useCallback, useEffect, useState } from 'react';
import { Card, cx } from './ui';
import { supabase } from '../lib/supabase';
import { useSession } from '../state/SessionContext';
import { useI18n } from '../i18n';
import type { DictKey } from '../i18n/dict';

type Role = 'owner' | 'admin' | 'viewer';
interface Member {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
}
interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'viewer';
  token: string;
  expires_at: string;
}

const input =
  'h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm text-zinc-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
const KNOWN_ERRORS = ['already_member', 'plan_limit_members', 'not_allowed', 'subscription_inactive', 'invalid_role'];

const DEMO_MEMBERS: Member[] = [
  { user_id: 'demo-user', email: 'demo@example.com', full_name: 'Demo', role: 'owner' },
  { user_id: 'demo-2', email: 'media.buyer@example.com', full_name: 'Media buyer', role: 'admin' },
];

/** Settings -> Team: members, roles, invite links (shared by copy/WhatsApp until email is set up). */
export default function TeamCard() {
  const { t, locale } = useI18n();
  const { mode, workspace, role, canEdit, user, entitlements } = useSession();
  const live = mode === 'live' && !!supabase;
  const isOwner = role === 'owner';
  const [members, setMembers] = useState<Member[]>(live ? [] : DEMO_MEMBERS);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'viewer'>('viewer');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errText = (msg: string) => {
    const code = KNOWN_ERRORS.find((k) => msg.includes(k));
    return code ? t(`team.err.${code}` as DictKey) : msg;
  };
  const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

  const load = useCallback(async () => {
    if (!live || !workspace) return;
    const [m, i] = await Promise.all([
      supabase!.rpc('list_members', { ws: workspace.id }),
      canEdit
        ? supabase!.from('workspace_invites').select('id, email, role, token, expires_at').eq('workspace_id', workspace.id).is('accepted_at', null).gt('expires_at', new Date().toISOString()).order('created_at')
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (m.error) setError(errText(m.error.message));
    else setMembers((m.data as Member[]) ?? []);
    if (!i.error) setInvites((i.data as Invite[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, workspace, canEdit]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const invite = async () => {
    setError(null);
    setLink(null);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError(t('team.err.email'));
    if (!live) return setLink(inviteUrl('demo-token-nothing-is-saved'));
    setBusy(true);
    const { data, error: e } = await supabase!.rpc('create_invite', { ws: workspace!.id, invite_email: email.trim(), invite_role: newRole });
    setBusy(false);
    if (e) return setError(errText(e.message));
    const row = (data as { token: string }[])[0];
    setLink(inviteUrl(row.token));
    setEmail('');
    void load();
  };

  const revoke = async (id: string) => {
    if (!live) return;
    const { error: e } = await supabase!.rpc('revoke_invite', { invite_id: id });
    if (e) setError(errText(e.message));
    void load();
  };

  const setRole = async (member: string, r: 'admin' | 'viewer') => {
    if (!live) return;
    const { error: e } = await supabase!.rpc('set_member_role', { ws: workspace!.id, member, new_role: r });
    if (e) setError(errText(e.message));
    void load();
  };

  const remove = async (member: string) => {
    if (!live || !window.confirm(t('team.removeConfirm'))) return;
    const { error: e } = await supabase!.from('workspace_members').delete().eq('workspace_id', workspace!.id).eq('user_id', member);
    if (e) setError(errText(e.message));
    void load();
  };

  const max = entitlements.plan?.max_members ?? 1;
  const used = members.length + invites.length;
  const whatsapp = (url: string) => `https://wa.me/?text=${encodeURIComponent(`${t('team.waText')} ${url}`)}`;

  return (
    <Card className="mt-4" title={t('team.title')} action={<span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{t('team.used', { used, max })}</span>}>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                <bdi>{m.full_name || m.email}</bdi>
                {m.user_id === user?.id && <span className="ms-2 text-xs text-zinc-500">({t('team.you')})</span>}
              </div>
              <div className="truncate text-xs text-zinc-500 dark:text-zinc-400" dir="ltr">
                {m.email}
              </div>
            </div>
            {isOwner && m.role !== 'owner' ? (
              <>
                <select className={cx(input, 'h-8 text-xs')} value={m.role} onChange={(e) => void setRole(m.user_id, e.target.value as 'admin' | 'viewer')}>
                  <option value="admin">{t('team.role.admin')}</option>
                  <option value="viewer">{t('team.role.viewer')}</option>
                </select>
                <button type="button" onClick={() => void remove(m.user_id)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
                  {t('team.remove')}
                </button>
              </>
            ) : (
              <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{t(`team.role.${m.role}` as DictKey)}</span>
            )}
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 bg-zinc-50/60 px-4 py-3 dark:bg-zinc-800/30">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm" dir="ltr">
                {i.email}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {t('team.pending', { role: t(`team.role.${i.role}` as DictKey), date: new Date(i.expires_at).toLocaleDateString(locale, { dateStyle: 'medium' }) })}
              </div>
            </div>
            <button type="button" onClick={() => void copy(inviteUrl(i.token), i.id)} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
              {copied === i.id ? t('billing.copied') : t('team.copyLink')}
            </button>
            <button type="button" onClick={() => void revoke(i.id)} className="text-xs font-medium text-red-600 hover:underline dark:text-red-400">
              {t('team.revoke')}
            </button>
          </li>
        ))}
      </ul>

      {canEdit ? (
        <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
          <div className="mb-2 text-sm font-medium">{t('team.invite')}</div>
          <div className="flex flex-wrap gap-2">
            <input type="email" dir="ltr" className={cx(input, 'min-w-0 flex-1')} placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className={input} value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'viewer')}>
              <option value="viewer">{t('team.role.viewer')}</option>
              <option value="admin">{t('team.role.admin')}</option>
            </select>
            <button type="button" disabled={busy || used >= max} onClick={() => void invite()} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {t('team.createLink')}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{used >= max ? t('team.limitReached') : t('team.inviteHint')}</p>
          {link && (
            <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm dark:bg-brand-500/10">
              <div className="mb-2 text-xs font-medium text-brand-900 dark:text-brand-100">{t('team.linkReady')}</div>
              <code dir="ltr" className="block break-all rounded-lg bg-white px-2 py-1.5 text-xs dark:bg-zinc-900">
                {link}
              </code>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void copy(link, 'new')} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900">
                  {copied === 'new' ? t('billing.copied') : t('team.copyLink')}
                </button>
                <a href={whatsapp(link)} target="_blank" rel="noreferrer" className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700">
                  {t('team.sendWhatsapp')}
                </a>
              </div>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">{t('team.viewerNote')}</p>
      )}
    </Card>
  );
}
