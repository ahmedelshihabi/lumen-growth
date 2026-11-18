/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_META_APP_ID?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_PAYMOB_ENABLED?: string;
  readonly VITE_MANUAL_INSTAPAY?: string;
  readonly VITE_MANUAL_WALLET?: string;
  readonly VITE_SUPPORT_WHATSAPP?: string;
}
