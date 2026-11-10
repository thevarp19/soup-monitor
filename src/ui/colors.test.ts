import { describe, expect, it } from 'vitest';
import { COLORS, blend, contrastRatio } from './colors.ts';

describe('contrastRatio (WCAG 2.x)', () => {
  it('black on white is 21:1, white on white 1:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

// axe checks text in the DOM but cannot see lines drawn on <canvas>, so chart colours are checked
// here: graphical objects need 3:1 against the background (WCAG 1.4.11), text 4.5:1 (1.4.3).
describe('palette contrast', () => {
  it.each(Object.entries(COLORS.series))('series %s line ≥ 3:1 on the chart background', (_name, color) => {
    expect(contrastRatio(color, COLORS.chartBg)).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(COLORS.series))('series %s raw line, faded under EMA, still ≥ 3:1', (_name, color) => {
    expect(contrastRatio(blend(color, COLORS.chartBg, COLORS.rawAlphaWithEma), COLORS.chartBg)).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(COLORS.markers))('marker %s ≥ 3:1', (_name, color) => {
    expect(contrastRatio(color, COLORS.chartBg)).toBeGreaterThanOrEqual(3);
  });

  it('axis labels ≥ 4.5:1', () => {
    expect(contrastRatio(COLORS.axisText, COLORS.chartBg)).toBeGreaterThanOrEqual(4.5);
  });
});
