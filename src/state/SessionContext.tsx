import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isDemoMode, supabase } from '../lib/supabase';
import { DEMO_PLANS, type Plan } from '../lib/plans';
import { computeEntitlements, type Entitlements, type SubscriptionInfo } from '../lib/entitlements';

export interface SessionState {
  mode: 'demo' | 'live';
  loading: boolean;
  user: { id: string; email: string | null } | null;
  profile: { full_name: string | null; is_platform_admin: boolean } | null;
  workspace: { id: string; name: string } | null;
  role: 'owner' | 'admin' | 'viewer' | null;
  /** Owner or admin: may edit goals/budgets/rules, create ads, apply recommendations, invite. */
  canEdit: boolean;
  /** Every workspace the user belongs to (for the switcher). */
  workspaces: { id: string; name: string; role: 'owner' | 'admin' | 'viewer' }[];
  switchWorkspace: (id: string) => void;
  subscription: SubscriptionInfo | null;
  plans: Plan[];
  entitlements: Entitlements;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);
const WS_KEY = 'lumen.workspace';

/** Remember which workspace to open (used by the switcher and after accepting an invite). */
export function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(WS_KEY, id);
  } catch {
    /* ignore */
  }
}

const DAY = 86_400_000;

function demoState(): Omit<SessionState, 'refresh' | 'signOut' | 'entitlements' | 'canEdit' | 'switchWorkspace'> {
  const end = new Date(Date.now() + 9 * DAY + 3_600_000).toISOString();
  return {
    mode: 'demo',
    loading: false,
    user: { id: 'demo-user', email: 'demo@example.com' },
    // Demo visitors are customers, not platform admins: no "Admin" link, /admin shows "forbidden".
    profile: { full_name: 'Demo', is_platform_admin: false },
    workspace: { id: '00000000-0000-4000-8000-000000000000', name: 'Demo workspace' },
    role: 'owner',
    workspaces: [{ id: '00000000-0000-4000-8000-000000000000', name: 'Demo workspace', role: 'owner' }],
    subscription: { plan_id: 'growth', status: 'trialing', trial_ends_at: end, current_period_end: end },
    plans: DEMO_PLANS,
  };
}

const EMPTY: Omit<SessionState, 'refresh' | 'signOut' | 'entitlements' | 'canEdit' | 'switchWorkspace'> = {
  mode: 'live',
  loading: true,
  user: null,
  profile: null,
  workspace: null,
  role: null,
  workspaces: [],
  subscription: null,
  plans: DEMO_PLANS,
};

export async function loadPlans(): Promise<Plan[]> {
  if (!supabase) return DEMO_PLANS;
  const { data, error } = await supabase.from('plans').select('*').eq('is_public', true).order('sort_order');
  if (error || !data?.length) return DEMO_PLANS;
  return data as Plan[];
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [demo] = useState(isDemoMode);
  const [state, setState] = useState(() => (demo ? demoState() : EMPTY));

  const load = useCallback(async () => {
    if (demo || !supabase) return;
    const { data: sess } = await supabase.auth.getSession();
    const user = sess.session?.user;
    if (!user) {
      setState({ ...EMPTY, loading: false, plans: await loadPlans() });
      return;
    }
    const [plans, profileRes, memberRes] = await Promise.all([
      loadPlans(),
      supabase.from('profiles').select('full_name, is_platform_admin').eq('id', user.id).maybeSingle(),
      supabase.from('workspace_members').select('role, created_at, workspaces(id, name)').eq('user_id', user.id).order('created_at'),
    ]);
    type Row = { role: string; workspaces: { id: string; name: string } | null };
    const all = ((memberRes.data ?? []) as unknown as Row[])
      .filter((m) => m.workspaces)
      .map((m) => ({ id: m.workspaces!.id, name: m.workspaces!.name, role: (m.role === 'member' ? 'admin' : m.role) as 'owner' | 'admin' | 'viewer' }));
    // The last workspace the user picked (e.g. the one they were just invited to), else their first.
    let preferred: string | null = null;
    try {
      preferred = localStorage.getItem(WS_KEY);
    } catch {
      /* ignore */
    }
    const current = all.find((w) => w.id === preferred) ?? all[0] ?? null;
    const ws = current ? { id: current.id, name: current.name } : null;
    let subscription: SubscriptionInfo | null = null;
    if (ws) {
      const { data } = await supabase
        .from('subscriptions')
        .select('plan_id, status, trial_ends_at, current_period_end')
        .eq('workspace_id', ws.id)
        .maybeSingle();
      subscription = (data as SubscriptionInfo | null) ?? null;
    }
    setState({
      mode: 'live',
      loading: false,
      user: { id: user.id, email: user.email ?? null },
      profile: (profileRes.data as SessionState['profile']) ?? null,
      workspace: ws,
      role: current?.role ?? null,
      workspaces: all,
      subscription,
      plans,
    });
  }, [demo]);

  useEffect(() => {
    if (demo || !supabase) return;
    void load();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void load();
    });
    return () => data.subscription.unsubscribe();
  }, [demo, load]);

  const signOut = useCallback(async () => {
    if (supabase && !demo) await supabase.auth.signOut();
    try {
      sessionStorage.removeItem('lumen.demo');
    } catch {
      /* ignore */
    }
    window.location.assign('/');
  }, [demo]);

  const switchWorkspace = useCallback((id: string) => {
    rememberWorkspace(id);
    // Full reload so every cached query (data source, settings, dismissals) is for the new workspace.
    window.location.assign('/app');
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      ...state,
      canEdit: state.role === 'owner' || state.role === 'admin',
      entitlements: computeEntitlements(state.subscription, state.plans),
      refresh: load,
      signOut,
      switchWorkspace,
    }),
    [state, load, signOut, switchWorkspace],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
