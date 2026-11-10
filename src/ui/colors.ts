/**
 * Chart palette. Canvas content is invisible to axe, so contrast is checked by unit tests
 * (colors.test.ts): lines and markers ≥ 3:1 (WCAG 1.4.11), axis text ≥ 4.5:1 (1.4.3).
 * Series are also told apart without colour: each metric has its own chart and title; EMA is
 * dashed and thicker than the raw line; marker kinds differ by shape.
 */
export const COLORS = {
  chartBg: '#ffffff',
  axisText: '#3d444d',
  grid: '#e6e8eb',
  series: { loss: '#0b5cad', lr: '#6a3ab2', grad_norm: '#a3214f' },
  /** Opacity of the raw line while the EMA line is shown on top. */
  rawAlphaWithEma: 0.7,
  markers: { nan: '#b42318', inf: '#9a4a00', nonpositive: '#5c5f66' },
} as const;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` drawn with `alpha` over `bg`, as an opaque hex colour. */
export function blend(fg: string, bg: string, alpha: number): string {
  const f = rgb(fg);
  const b = rgb(bg);
  return `#${f.map((c, i) => Math.round(alpha * c + (1 - alpha) * b[i]).toString(16).padStart(2, '0')).join('')}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
