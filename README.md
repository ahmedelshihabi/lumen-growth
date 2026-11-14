# Lumen Growth

A multi-customer SaaS for media buyers and growth teams in Egypt and the Gulf. Customers connect their Meta ad accounts and get one dashboard with ROAS, CPA, budget pacing, creative fatigue, anomaly alerts and recommendations. The UI is in Arabic (default, right-to-left) and English. Billing is a monthly subscription in EGP through Paymob, with manual InstaPay / Vodafone Cash activation as a fallback.

**Status: closed beta.** The Meta app stays in Development mode, so only people added as testers can connect ad accounts, and payments can be activated by hand until Paymob approves the account. Going public later needs configuration only, no code changes. The non-developer launch guide is **[SETUP_AR.md](SETUP_AR.md)** (Egyptian Arabic).

## Architecture

```
Browser (Vite + React SPA, Vercel/Netlify)
  │  anon key + user JWT; RLS limits every query to the user's workspace
  ▼
Supabase
  ├─ Auth: email magic link, Google
  ├─ Postgres + RLS: plans, profiles, workspaces, members, subscriptions, payments,
  │                  meta_connections (tokens: service role only), ad_accounts,
  │                  campaigns, ads, insights_daily, campaign_budgets
  └─ Edge Functions (Deno)
       paymob-checkout      → Paymob Intention API → Unified Checkout URL
       paymob-webhook       ← Paymob callback: HMAC check, idempotent, +30 days
       meta-oauth-callback  → code → long-lived token, lists ad accounts
       meta-sync            → Graph API insights (30 days, campaign + ad level)
       admin-activate       → platform admin activates after a manual transfer
```

### Security model

- RLS is on for every table. Clients can only **read** their own workspace's rows. Subscriptions and payments are written only by Edge Functions using the service role, so a user cannot grant themselves a plan.
- `meta_connections.access_token` has RLS with no policies, and every privilege is revoked from `anon` and `authenticated`. The UI reads a token-free status through `get_meta_connection()`.
- Column grants let a user change only `profiles.full_name`/`locale`, `workspaces.name` and `ad_accounts.selected`. `is_platform_admin` is set from the SQL editor.
- Plan limits are enforced in the database. Triggers check `max_ad_accounts` when an account is selected and `max_members` when a member is added. Writes such as budgets and account selection need an active subscription (`workspace_is_active()`).
- A new signup gets a profile, its own workspace (as owner) and a 14-day **Growth** trial (trigger `handle_new_user`).

### Plans (seeded, per month)

| Plan | EGP | Ad accounts | Members | Pages |
|---|---|---|---|---|
| Free | 0 | 1 | 1 | Overview, Campaigns |
| Starter | 999 | 2 | 2 | + Pacing, Alerts |
| Growth | 2,499 | 5 | 5 | + Creatives, Recommendations |
| Agency | 6,999 | 25 | 15 | + priority support |

Prices are stored in minor units with a `currency` per plan, so AED or SAR rows can be added later (`unique (tier, currency)`). When a trial ends or a subscription lapses, the app shows a read-only lock screen that links to billing. The owner can also continue on Free.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production build to dist/
npm test          # Vitest: rules, entitlements, Paymob HMAC, period maths, Meta mapping
```

**Demo mode.** With no `VITE_SUPABASE_*` variables, or with `?demo` in the URL (`?demo=0` turns it off), the app uses the seeded `MockDataSource` and a fake trialing workspace. No backend is needed, and everything builds and runs.

To use a real backend, copy `.env.example` to `.env.local` and follow SETUP_AR.md. The function secrets are listed in `supabase/functions/.env.example` and are set with `supabase secrets set`. They never go in the frontend env.

To type-check the Edge Functions, run `deno check supabase/functions/*/index.ts`. This needs Deno.

## Project layout

```
supabase/
  migrations/              # schema, RLS, triggers, billing RPCs, seed plans
  functions/
    _shared/               # http/auth helpers, Paymob + Graph clients,
                           # pure: paymob-hmac.ts, period.ts, meta.ts (+ *.test.ts)
    paymob-checkout/ paymob-webhook/ meta-oauth-callback/ meta-sync/ admin-activate/
  config.toml              # verify_jwt off for paymob-webhook and meta-sync
src/
  App.tsx                  # path router: / /pricing /login /app/* /admin
  AppShell.tsx             # gating: lock screen, upgrade prompts, empty state
  i18n/                    # dict.ts (en + ar), provider, language toggle
  state/SessionContext.tsx # user, workspace, subscription, plans, entitlements
  state/AppContext.tsx     # dataset from the active DataSource, goals, theme
  data/source.ts           # DataSource interface + MockDataSource (demo)
  data/supabaseSource.ts   # SupabaseDataSource (insights_daily, budgets)
  lib/entitlements.ts      # plan/feature/lock logic (tested)
  pages/                   # 7 dashboard pages + Billing, Connect, Admin
  pages/public/            # Landing, Pricing, Login
  rules/                   # pure rules engines (unchanged API)
public/legal/              # DRAFT terms / privacy / refunds pages
```

## Data notes

- `meta-sync` pulls `GET /{act}/insights` with `level=campaign|ad` and `time_increment=1` for the last 30 days, plus campaign and ad metadata, and upserts them into `insights_daily`. Over time, daily syncs build up history. Only the first `max_ad_accounts` selected accounts are synced.
- Purchases come from `actions` / `action_values`, taking the first of `omni_purchase`, `purchase` and the pixel purchase, so they are not double counted. 3-second views come from `actions[video_view]`.
- Meta has no monthly budgets, so teams enter them per campaign in **Settings** (`campaign_budgets`). Pacing and the pacing recommendations skip campaigns without one.
- Alert and recommendation texts come from the rules engine and are still English in both languages.

## Unverified API details

The Paymob and Meta developer sites could not be reached from the build environment. Everything below was written from prior knowledge and is marked `// VERIFY:` in code. Check each item before going live: `grep -rn "VERIFY:" supabase/functions`.

- Paymob: the `POST /v1/intention/` path, `Authorization: Token <secret>`, the body (amount in piasters, `payment_methods` as integration IDs, required `billing_data` fields, `special_reference`, `notification_url`), the `intention_order_id` response field, the unified checkout URL `/unifiedcheckout/?publicKey=&clientSecret=`, the regional hosts, and the HMAC field list and order, boolean rendering, `?hmac=` query param, `type: "TRANSACTION"` and `order.merchant_order_id` = special_reference.
- Meta: the pinned Graph version (`v24.0`), the dialog URL, both `oauth/access_token` exchanges, `Authorization: Bearer` on Graph calls, the `/me/adaccounts`, `/campaigns`, `/ads` and `/insights` fields, the purchase and video action types, the budget minor-unit offsets and the creative `object_type` values.
