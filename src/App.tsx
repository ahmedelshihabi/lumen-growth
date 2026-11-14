import { useMemo } from 'react';
import { Layout } from './components/Layout';
import { useHashRoute, type Route } from './lib/useHashRoute';
import { useApp } from './state/AppContext';
import { detectAnomalies } from './rules/anomalies';
import { generateRecommendations } from './rules/recommendations';
import Overview from './pages/Overview';
import Campaigns from './pages/Campaigns';
import Pacing from './pages/Pacing';
import Creatives from './pages/Creatives';
import Alerts from './pages/Alerts';
import Recommendations from './pages/Recommendations';
import Settings from './pages/Settings';

const PAGES: Record<Route, () => JSX.Element> = {
  overview: Overview,
  campaigns: Campaigns,
  pacing: Pacing,
  creatives: Creatives,
  alerts: Alerts,
  recommendations: Recommendations,
  settings: Settings,
};

export default function App() {
  const route = useHashRoute();
  const { data, error, rulesInput } = useApp();

  const badges = useMemo(() => {
    if (!rulesInput) return {};
    return {
      alerts: detectAnomalies(rulesInput).length,
      recommendations: generateRecommendations(rulesInput).length,
    };
  }, [rulesInput]);

  const Page = PAGES[route];

  return (
    <Layout route={route} badges={badges}>
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Failed to load data: {error}
        </div>
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70" />
          ))}
        </div>
      ) : (
        <Page />
      )}
    </Layout>
  );
}
