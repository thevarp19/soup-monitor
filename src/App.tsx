import { NaiveRunList } from './naive/NaiveRunList.tsx';
import { NaiveRunPage } from './naive/NaiveRunPage.tsx';
import { matchRoute, useLocation } from './router.ts';

// Stage 3 (perf baseline): only the naive UI exists. The real UI replaces this in stage 4 and the
// naive one stays reachable with ?impl=naive.
export function App() {
  const { pathname } = useLocation();
  const route = matchRoute(pathname);
  // No `key={route.id}`: remounting per run would hide the request race the naive page must show.
  if (route.name === 'run') return <NaiveRunPage id={route.id} />;
  if (route.name === 'list') return <NaiveRunList />;
  return (
    <main>
      <h1>Not found</h1>
    </main>
  );
}
