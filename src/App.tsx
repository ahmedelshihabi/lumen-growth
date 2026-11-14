import { useEffect, useMemo } from 'react';
import AppShell from './AppShell';
import { appRouteFromPath, navigate, usePath } from './lib/router';
import { supabase } from './lib/supabase';
import { getDataSource, type DataSource } from './data/source';
import { SupabaseDataSource } from './data/supabaseSource';
import { AppProvider } from './state/AppContext';
import { useSession } from './state/SessionContext';
import { useI18n } from './i18n';
import Landing from './pages/public/Landing';
import Pricing from './pages/public/Pricing';
import Login from './pages/public/Login';
import Admin from './pages/Admin';

function FullPageSpinner() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400" aria-busy="true">
      {t('common.loading')}
    </div>
  );
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return <FullPageSpinner />;
}

/** Authenticated area: picks the DataSource (demo -> mock, live -> Supabase) and mounts the app. */
function Authed({ children }: { children: (source: DataSource) => JSX.Element }) {
  const session = useSession();
  const source = useMemo<DataSource | null>(() => {
    if (session.mode === 'demo') return getDataSource();
    if (supabase && session.workspace) return new SupabaseDataSource(supabase, session.workspace.id);
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.mode, session.workspace?.id]);

  if (session.loading) return <FullPageSpinner />;
  if (!session.user) return <Redirect to={`/login?next=${encodeURIComponent(window.location.pathname)}`} />;
  if (!source) return <FullPageSpinner />;
  return children(source);
}

export default function App() {
  const path = usePath();

  if (path === '/') return <Landing />;
  if (path === '/pricing') return <Pricing />;
  if (path === '/login') return <Login />;
  if (path === '/admin') return <Authed>{() => <Admin />}</Authed>;

  const route = appRouteFromPath(path);
  if (route) {
    return (
      <Authed>
        {(source) => (
          <AppProvider source={source}>
            <AppShell route={route} />
          </AppProvider>
        )}
      </Authed>
    );
  }
  return <Redirect to="/" />;
}
