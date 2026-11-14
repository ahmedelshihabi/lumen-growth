import { useMemo } from 'react';
import { Layout } from './components/Layout';
import { LockScreen, NoDataYet, SessionBanner, UpgradeNotice } from './components/Gates';
import type { AppRoute } from './lib/router';
import { ROUTE_FEATURE, routeAccess } from './lib/entitlements';
import type { FeatureKey } from './lib/plans';
import { useApp } from './state/AppContext';
import { useSession } from './state/SessionContext';
import { useI18n } from './i18n';
import { detectAnomalies } from './rules/anomalies';
import { generateRecommendations } from './rules/recommendations';
import Overview from './pages/Overview';
import Campaigns from './pages/Campaigns';
import Pacing from './pages/Pacing';
import Creatives from './pages/Creatives';
import Alerts from './pages/Alerts';
import Recommendations from './pages/Recommendations';
import Settings from './pages/Settings';
import Billing from './pages/Billing';
import Connect from './pages/Connect';

/** Pages that render the loaded dataset (need data, show "connect Meta" when empty). */
const DATA_PAGES: Partial<Record<AppRoute, () => JSX.Element>> = {
  overview: Overview,
  campaigns: Campaigns,
  pacing: Pacing,
  creatives: Creatives,
  alerts: Alerts,
  recommendations: Recommendations,
  settings: Settings,
};

/** Pages that work without the dataset. */
const ACCOUNT_PAGES: Partial<Record<AppRoute, () => JSX.Element>> = {
  billing: Billing,
  connect: Connect,
};

export default function AppShell({ route }: { route: AppRoute }) {
  const { data, error, rulesInput } = useApp();
  const { entitlements } = useSession();
  const { t } = useI18n();
  const access = routeAccess(route, entitlements);

  const badges = useMemo(() => {
    if (!rulesInput || !entitlements.active) return {};
    return {
      alerts: entitlements.features.has('alerts') ? detectAnomalies(rulesInput).length : 0,
      recommendations: entitlements.features.has('recommendations') ? generateRecommendations(rulesInput).length : 0,
    };
  }, [rulesInput, entitlements]);

  let body: JSX.Element;
  const AccountPage = ACCOUNT_PAGES[route];
  const DataPage = DATA_PAGES[route];

  if (access === 'locked') body = <LockScreen />;
  else if (access === 'upgrade') body = <UpgradeNotice feature={ROUTE_FEATURE[route] as FeatureKey} />;
  else if (AccountPage) body = <AccountPage />;
  else if (error) {
    body = (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('common.failedToLoad', { message: error })}
      </div>
    );
  } else if (!data) {
    body = (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
        ))}
      </div>
    );
  } else if (data.campaigns.length === 0) body = <NoDataYet />;
  else body = DataPage ? <DataPage /> : <NoDataYet />;

  return (
    <Layout route={route} badges={badges}>
      <SessionBanner />
      {body}
    </Layout>
  );
}
