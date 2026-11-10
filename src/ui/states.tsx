/** Loading, error and empty states, shared by the list and the run page. */
import type { ReactNode } from 'react';
import { ApiError } from '../api/mockApi.ts';

export function Skeleton({ label, lines = 3, className = '' }: { label: string; lines?: number; className?: string }) {
  return (
    <div className={`skeleton ${className}`} role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" aria-hidden="true" />
      ))}
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function ErrorState({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <h2>{title}</h2>
      <p>{describeError(error)}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty" role="status">
      <h2>{title}</h2>
      {children}
    </div>
  );
}
