import { useEffect, useState } from 'react';

export type Route = 'overview' | 'campaigns' | 'pacing' | 'creatives' | 'alerts' | 'recommendations' | 'settings';

export const ROUTES: Route[] = ['overview', 'campaigns', 'pacing', 'creatives', 'alerts', 'recommendations', 'settings'];

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(h) ? h : 'overview';
}

/** Minimal hash router - avoids a router dependency for seven pages. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => {
      setRoute(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
