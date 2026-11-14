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
  role: 'owner' | 'member' | null;
  subscription: SubscriptionInfo | null;
  plans: Plan[];
  entitlements: Entitlements;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

const DAY = 86_400_000;

function demoState(): Omit<SessionState, 'refresh' | 'signOut' | 'entitlements'> {
  const end = new Date(Date.now() + 9 * DAY + 3_600_000).toISOString();
  return {
    mode: 'demo',
    loading: false,
    user: { id: 'demo-user', email: 'demo@example.com' },
    profile: { full_name: 'Demo', is_platform_admin: true },
    workspace: { id: '00000000-0000-4000-8000-000000000000', name: 'Demo workspace' },
    role: 'owner',
    subscription: { plan_id: 'growth', status: 'trialing', trial_ends_at: end, current_period_end: end },
    plans: DEMO_PLANS,
  };
}

const EMPTY: Omit<SessionState, 'refresh' | 'signOut' | 'entitlements'> = {
  mode: 'live',
  loading: true,
  user: null,
  profile: null,
  workspace: null,
  role: null,
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
      supabase.from('workspace_members').select('role, workspaces(id, name)').eq('user_id', user.id).order('created_at').limit(1).maybeSingle(),
    ]);
    const ws = (memberRes.data?.workspaces ?? null) as unknown as { id: string; name: string } | null;
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
      role: (memberRes.data?.role as SessionState['role']) ?? null,
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

  const value = useMemo<SessionState>(
    () => ({ ...state, entitlements: computeEntitlements(state.subscription, state.plans), refresh: load, signOut }),
    [state, load, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}
