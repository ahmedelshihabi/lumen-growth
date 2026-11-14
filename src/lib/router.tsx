import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/**
 * Tiny history-API router (no dependency). Paths:
 *   /            landing          /pricing   /login
 *   /app/...     gated app        /admin     platform admin
 * Hosting must rewrite unknown paths to index.html (see vercel.json / public/_redirects).
 */

const EVENT = 'lumen:navigate';

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(EVENT));
  window.scrollTo({ top: 0 });
}

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    window.addEventListener(EVENT, on);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(EVENT, on);
    };
  }, []);
  return path.replace(/\/+$/, '') || '/';
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!href.startsWith('/') || rest.target) return;
    e.preventDefault();
    navigate(href);
  };
  return <a href={href} onClick={handle} {...rest} />;
}

export type AppRoute =
  | 'overview'
  | 'campaigns'
  | 'pacing'
  | 'creatives'
  | 'alerts'
  | 'recommendations'
  | 'create'
  | 'settings'
  | 'billing'
  | 'connect';

export const APP_ROUTES: AppRoute[] = ['overview', 'campaigns', 'pacing', 'creatives', 'alerts', 'recommendations', 'create', 'settings', 'billing', 'connect'];

export function appRouteFromPath(path: string): AppRoute | null {
  if (path === '/app') return 'overview';
  const m = /^\/app\/([a-z]+)$/.exec(path);
  return m && (APP_ROUTES as string[]).includes(m[1]) ? (m[1] as AppRoute) : null;
}

export const appHref = (r: AppRoute) => (r === 'overview' ? '/app' : `/app/${r}`);
