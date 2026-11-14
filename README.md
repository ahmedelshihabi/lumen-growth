# Lumen Growth

A working MVP of a performance-marketing dashboard for media buyers, performance marketers and growth teams. It covers Meta, Google Ads and TikTok in one view and runs entirely in the browser on a seeded mock-data layer.

## Features

- **Overview**: KPI tiles (Spend, Revenue, ROAS, CPA, CTR, Conversions), each with its change against the previous period and a sparkline. Also a daily spend vs revenue trend, a channel split and the top alerts. The date range can be 7, 14, 30 or 90 days.
- **Campaigns**: a table of all campaigns across channels. You can sort it and filter by search text, channel, status and health. It shows status, daily budget, spend, revenue, ROAS, CPA, CTR and frequency. Health is color-coded against each account's goals.
- **Budget pacing**: monthly budget vs month-to-date spend, by channel and by campaign. Projected month-end spend is month-to-date spend plus the 7-day run rate times the days left. Over- and under-pacing are flagged, with the daily spend needed to land on plan.
- **Creative analytics**: a grid of creatives shown as colored placeholder tiles. Each card has hook rate (3-second views / impressions), CTR, CPA and spend. A fatigue indicator flags frequency rising while CTR falls (last 7 days vs the 7 days before), with a sparkline of both.
- **Alerts**: rule-based anomaly detection with severities.
  - CPA up more than 30% day over day
  - ROAS drop (last 3 days vs the 14 days before)
  - Spend stopped on a campaign that is not paused
  - Frequency above 4
- **Recommendations**: a deterministic rules engine.
  - Budget shifts from campaigns below goal to campaigns above it, e.g. "Shift 15% budget from X (ROAS 0.8) to Y (ROAS 3.4)"
  - Pausing campaigns that lose money
  - Raising or lowering budgets based on pacing
  - Creative refreshes
  - Delivery fixes
  - Audience expansion

  Each recommendation comes with an estimated monthly impact.
- **Settings**: target CPA and ROAS per ad account, saved in `localStorage`. These goals drive the health colors and the rules. The theme toggle is also here.
- Light and dark mode (follows the system setting the first time). The layout works from 1440px down to phone width.

## Run it

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production build to dist/
npm run preview   # serve dist/ on http://localhost:4173
npm test          # Vitest unit tests for the rules
```

Stack: Vite, React 18, TypeScript, Tailwind CSS 3, Recharts. There is no backend.

## Project layout

```
src/
  data/
    types.ts         # Domain types: AdAccount, Campaign, Creative, daily metric rows
    source.ts        # DataSource interface + MockDataSource + loadDataset()
    mock.ts          # Seeded generator (190 days, 3 accounts, 12 campaigns, 20 creatives)
  rules/             # Pure functions, no React
    anomalies.ts     # detectAnomalies()
    recommendations.ts  # generateRecommendations()
    pacing.ts        # computePacing()
    fatigue.ts       # detectFatigue()
    health.ts        # campaignHealth(), metricHealth()
    summary.ts       # per-campaign aggregation for a date range
    targets.ts       # default goals per account
    rules.test.ts    # Vitest tests
  lib/               # metrics aggregation, dates, formatting, chart colors, hash router
  state/AppContext.tsx  # dataset loading, date range, goals (localStorage), theme
  components/        # Layout (sidebar / mobile drawer), UI primitives, chart tooltip, icons
  pages/             # Overview, Campaigns, Pacing, Creatives, Alerts, Recommendations, Settings
```

## Plugging in real data

The UI talks to data only through the `DataSource` interface in `src/data/source.ts`:

```ts
interface DataSource {
  getAsOf(): Promise<ISODate>;
  getAccounts(): Promise<AdAccount[]>;
  getCampaigns(): Promise<Campaign[]>;
  getCreatives(): Promise<Creative[]>;
  getCampaignDaily(range: DateRange): Promise<CampaignDailyMetric[]>;
  getCreativeDaily(range: DateRange): Promise<CreativeDailyMetric[]>;
}
```

To go live:

1. Write a backend or proxy that holds the platform OAuth tokens. Do not put tokens in the browser.
2. Map each platform's fields onto the types in `src/data/types.ts`. All amounts are in account currency, and dates are `YYYY-MM-DD` in the account's timezone.
   - **Meta** (`/insights`, `level=campaign|ad`, `time_increment=1`): `spend`, `impressions`, `reach`, `clicks`, `frequency`. Conversions come from `actions[purchase]` and revenue from `action_values[purchase]`. `videoViews3s` comes from `video_play_actions`.
   - **Google Ads** (GAQL `campaign` / `ad_group_ad` with `segments.date`): `metrics.cost_micros / 1e6`, `impressions`, `clicks`, `conversions`, `conversions_value`.
   - **TikTok** (`/report/integrated/get/`, `stat_time_day`): `spend`, `impressions`, `reach`, `clicks`, `frequency`, `conversion`, `total_complete_payment_rate` / value, `video_watched_2s`.
3. Implement `DataSource` (for example `ApiDataSource`) and return it from `getDataSource()`.
4. `monthlyBudget` is a planning value, not a platform field. Load it from your budget sheet or database.

The rules engines in `src/rules/` only consume these normalized shapes, so they work unchanged on real data. Their thresholds are in the exported `DEFAULT_*_CONFIG` objects.
