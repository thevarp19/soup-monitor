import { NaiveRunList } from './naive/NaiveRunList.tsx';
import { NaiveRunPage } from './naive/NaiveRunPage.tsx';
import { matchRoute, useLocation } from './router.ts';
import { appLocale } from './ui/locale.ts';
import { RunListPage } from './ui/RunListPage.tsx';
import { RunPage } from './ui/RunPage.tsx';

export function App() {
  const { pathname, search } = useLocation();
  const route = matchRoute(pathname);
  const params = new URLSearchParams(search);

  // ?impl=naive keeps the stage-3 baseline reachable for before/after comparisons.
  if (params.get('impl') === 'naive') {
    // No `key={route.id}`: remounting per run would hide the request race the naive page must show.
    if (route.name === 'run') return <NaiveRunPage id={route.id} />;
    if (route.name === 'list') return <NaiveRunList />;
  }

  const locale = appLocale(search);
  return (
    <>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <div id="content">
        {route.name === 'list' && <RunListPage search={search} locale={locale} />}
        {route.name === 'run' && <RunPage id={route.id} locale={locale} listSearch={params.get('from') ?? ''} />}
        {route.name === 'not-found' && (
          <main className="page">
            <h1>Page not found</h1>
            <p>
              <a href="/">Go to the run list</a>
            </p>
          </main>
        )}
      </div>
      <footer className="footer">
        Numbers formatted for locale <code>{locale}</code> (change with <code>?locale=</code>). Data is generated deterministically in your browser.
      </footer>
    </>
  );
}
