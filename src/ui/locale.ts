/**
 * The one place that decides the display locale: ?locale=xx-YY if supported, else the browser's
 * language. Every formatter receives it explicitly — nothing relies on the runtime default.
 */
export function appLocale(search = typeof window === 'undefined' ? '' : window.location.search): string {
  const requested = new URLSearchParams(search).get('locale');
  if (requested) {
    try {
      if (Intl.NumberFormat.supportedLocalesOf([requested]).length > 0) return requested;
    } catch {
      /* invalid tag → fall through */
    }
  }
  return (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
}
