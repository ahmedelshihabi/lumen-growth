// Shared HTTP + Supabase helpers for Edge Functions (Deno).
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.119.0';

export const corsHeaders: Record<string, string> = {
  // The SPA calls these functions from APP_URL. Restrict to it when set.
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError(500, 'missing_secret', `Server is missing the ${name} secret`);
  return v;
}

/** Service-role client: bypasses RLS. Never expose its results unfiltered. */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request, admin: SupabaseClient): Promise<User> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'unauthorized');
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'unauthorized');
  return data.user;
}

/**
 * The workspace the caller acts on: `requested` if they are a member of it,
 * otherwise their first (oldest) membership.
 */
export async function resolveWorkspace(
  admin: SupabaseClient,
  userId: string,
  requested?: string | null,
): Promise<{ workspaceId: string; role: 'owner' | 'member' }> {
  let q = admin.from('workspace_members').select('workspace_id, role').eq('user_id', userId).order('created_at').limit(1);
  if (requested) q = q.eq('workspace_id', requested);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(403, 'not_a_member');
  return { workspaceId: data.workspace_id as string, role: data.role as 'owner' | 'member' };
}

export interface PlanRow {
  id: string;
  tier: string;
  name_en: string;
  currency: string;
  price_minor: number;
  interval_days: number;
  max_ad_accounts: number;
  max_members: number;
  features: string[];
  is_public: boolean;
}

export interface SubscriptionRow {
  workspace_id: string;
  plan_id: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  current_period_end: string | null;
  plans: PlanRow;
}

export async function loadSubscription(admin: SupabaseClient, workspaceId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await admin
    .from('subscriptions')
    .select('workspace_id, plan_id, status, current_period_end, plans(*)')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as SubscriptionRow | null;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/** Wraps a handler with CORS preflight + uniform error responses. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: 'internal_error', message: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
