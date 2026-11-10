/** NAIVE BASELINE run list: no sorting, filtering, states or keyboard support. */
import { useEffect, useState } from 'react';
import { Link } from '../router.ts';
import { naiveFetchRuns } from './naiveApi.ts';

export function NaiveRunList() {
  const [runs, setRuns] = useState<Array<{ id: string; name: string; status: string }> | null>(null);
  useEffect(() => {
    naiveFetchRuns().then(setRuns);
  }, []);
  return (
    <main className="naive">
      <h1>Training runs (naive baseline)</h1>
      {!runs && <p>Loading…</p>}
      <ul>
        {runs?.map((r) => (
          <li key={r.id}>
            <Link to={`/runs/${encodeURIComponent(r.id)}?impl=naive`}>{r.name}</Link> — {r.status}
          </li>
        ))}
      </ul>
    </main>
  );
}
