import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

/** null when no backend is configured (the app then runs in Demo mode). */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
  : null;

const DEMO_KEY = 'lumen.demo';

/**
 * Demo mode = no Supabase env vars, or `?demo` in the URL (remembered for the
 * tab session; `?demo=0` turns it off). Demo mode uses the seeded MockDataSource.
 */
export function isDemoMode(): boolean {
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.has('demo')) {
      if (p.get('demo') === '0') sessionStorage.removeItem(DEMO_KEY);
      else sessionStorage.setItem(DEMO_KEY, '1');
    }
    if (!supabaseConfigured) return true;
    return sessionStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return !supabaseConfigured;
  }
}

export const env = {
  // Public Meta (Facebook) App ID for "Lumen Growth". It is a public client_id
  // (it ships in the browser bundle), so a default here is safe; set
  // VITE_META_APP_ID to override it per environment.
  metaAppId: (import.meta.env.VITE_META_APP_ID as string | undefined) || '1612772370018192',
  // Google OAuth client id (public). Empty until the Google Ads connector is set up.
  googleClientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '',
  paymobEnabled: (import.meta.env.VITE_PAYMOB_ENABLED as string | undefined) === 'true',
  instapayAddress: (import.meta.env.VITE_MANUAL_INSTAPAY as string | undefined) ?? '',
  walletNumber: (import.meta.env.VITE_MANUAL_WALLET as string | undefined) ?? '',
  supportWhatsapp: (import.meta.env.VITE_SUPPORT_WHATSAPP as string | undefined) ?? '',
};
