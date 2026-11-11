// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Freshness } from './Freshness.tsx';

const text = () => screen.getByTestId('freshness').textContent ?? '';

describe('Freshness — "is this data current?" (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 10, 11, 10, 10, 21));
  });
  afterEach(() => {
    cleanup(); // RTL's auto-cleanup needs Vitest globals, which are off
    vi.useRealTimers();
  });

  it('shows when the data was last updated, then marks it stale once the threshold passes', () => {
    const loadedAt = Date.now();
    render(<Freshness lastSuccessAt={loadedAt} live staleMs={30_000} error={null} locale="en-US" timeZone="UTC" />);
    expect(text()).toContain('Updated 10:10:21 AM UTC');
    expect(screen.queryByText('Stale')).toBeNull();

    act(() => vi.advanceTimersByTime(29_000));
    expect(screen.queryByText('Stale')).toBeNull();
    expect(text()).toContain('29 seconds ago');

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(text()).toContain('31 seconds ago');
  });

  it('a failed refresh is shown, and the data is not presented as current', () => {
    render(<Freshness lastSuccessAt={Date.now() - 45_000} live staleMs={30_000} error={new Error('HTTP 500: boom')} locale="en-US" timeZone="UTC" />);
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(text()).toContain('Last refresh failed: HTTP 500: boom');
  });

  it('a finished (not live) run shows the load time but is never "stale"', () => {
    render(<Freshness lastSuccessAt={Date.now() - 3_600_000} live={false} staleMs={30_000} error={null} locale="en-US" timeZone="UTC" />);
    expect(screen.queryByText('Stale')).toBeNull();
    expect(text()).toContain('Loaded 09:10:21 AM UTC');
  });
});
