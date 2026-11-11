/** "Go to step": typed numbers are read in the display locale and validated, never guessed. */
import { useId, useState, type FormEvent } from 'react';
import { formatStep, formatValue } from './format.ts';
import { parseUserNumber } from './parse.ts';
import type { Range } from './zoom.ts';

export function GoToStep({ full, locale, onGo }: { full: Range; locale: string; onGo: (step: number, eventTime: number) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = parseUserNumber(text, locale);
    if (!r.ok) return setError(r.error === 'empty' ? 'Type a step number.' : `Not a number: “${text}”.`);
    if (!Number.isInteger(r.value)) return setError(`Steps are whole numbers — ${text} reads as ${formatValue(r.value, locale)}.`);
    if (r.value < full.x0 || r.value > full.x1) {
      return setError(`Step ${formatStep(r.value, locale)} is outside this run (${formatStep(full.x0, locale)}–${formatStep(full.x1, locale)}).`);
    }
    setError(null);
    onGo(r.value, e.timeStamp);
  };

  return (
    <form className="goto" onSubmit={submit}>
      <label htmlFor={inputId}>Go to step</label>
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        value={text}
        size={10}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
      />
      <button type="submit">Go</button>
      {error && (
        <span id={errorId} className="goto-error" role="alert" data-testid="goto-error">
          {error}
        </span>
      )}
    </form>
  );
}
