/**
 * A ~50-line router: two routes and query-string state. Chosen over react-router to keep every
 * line explainable; the History API does the work. Vercel rewrites all paths to index.html.
 */
import { createElement, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export type Route = { name: 'list' } | { name: 'run'; id: string } | { name: 'not-found' };

export function matchRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'list' };
  if (parts.length === 2 && parts[0] === 'runs') {
    try {
      return { name: 'run', id: decodeURIComponent(parts[1]) };
    } catch {
      return { name: 'not-found' };
    }
  }
  return { name: 'not-found' };
}

const NAVIGATE_EVENT = 'app:navigate';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

/** Current pathname + search; re-renders on navigation and back/forward. */
export function useLocation(): { pathname: string; search: string } {
  const href = useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);
  const q = href.indexOf('?');
  return q === -1 ? { pathname: href, search: '' } : { pathname: href.slice(0, q), search: href.slice(q) };
}

export function navigate(to: string, { replace = false } = {}) {
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

/** <a> that navigates client-side on a plain left click and behaves natively otherwise. */
export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    rest.onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return createElement('a', { ...rest, href: to, onClick });
}
