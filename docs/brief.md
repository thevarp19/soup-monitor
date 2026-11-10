# Brief (verbatim from the assignment PDF)

**Frontend Engineer.** Work: 4–6 h · Deadline: 48 h · Any stack · Deployment required (Vercel or GitHub Pages)

**DATA.** Generate it yourself: 20 training runs with the fields step, loss, lr, grad_norm. Some are deliberately broken: NaN and Infinity in loss, duplicate and unsorted steps, gaps, one run with 1,000,000 points and a single outlier spike in the middle of a long series.

**TASK.** A training-run monitor, and an answer to one question: can you show it to someone deciding whether to stop a $500 run? A chart that looks right and a chart that is truthful are not the same thing.

1. Build it. A run list (sort, filter), a run page with loss, lr and grad_norm charts, summary cards, loading, empty and error states, responsive layout, keyboard control, sufficient contrast.
2. Prove the chart is truthful. You can't draw a million points as they are, so you're discarding something. Show with automated tests that the spike is visible at every zoom level, NaN isn't drawn as 0 or silently smoothed, duplicates and unsorted steps don't distort the line, and numbers and axis labels match the data. Include the output and state what the tests would NOT catch.
3. Performance in numbers. First render and response to zoom and hover in a Performance trace (CPU throttling ×4), plus tab memory at 1M points. Numbers before and after optimization.
4. Silent failures. What looks fine but is wrong: stale data, a request race when switching runs quickly, locale and time zone, smoothing that hides divergence, a log scale with zeros. How you checked.
5. Verdict. SHIP or DON'T SHIP, and what to change first.

**DELIVERABLES.** Repository and deployed link · tests and their output · the Performance trace (file or screenshots) · a note of ≤2 pages · one paragraph on what surprised you and what still concerns you. Don't edit or hide failed results: a clear negative beats a quiet success. If something breaks, tell us what happened, what you tried, and what you learned.

**AI TOOLS.** Allowed. Note where you used them, which suggestions you accepted, and what you verified, changed, or redid yourself.

**SCORING.** Data truthfulness — 30% · silent failures — 20% · performance, UX and accessibility — 15% · live discussion — 35%.
