import { describe, it, expect } from 'vitest';
import { openLiftPx } from '../src/ui/openLift';

// Open-drawer board lift. Geometry from the real layouts: base board
// viewBoxR 6.659 with the top tile row's bottom vertex 2 units above
// center; expansion 8.244 / 3.5. Container heights assume the notice-state
// peek (130 + inset), the usual state once a map exists and the drawer is
// being opened.

const base = { viewBoxR: 6.659, topRowBottomUnits: -2 };
const expansion = { viewBoxR: 8.244, topRowBottomUnits: -3.5 };

const lift = (w: number, h: number, vh: number, geom: typeof base) =>
  openLiftPx({
    containerWidthPx: w,
    containerHeightPx: h,
    viewportHeightPx: vh,
    ...geom,
  });

describe('openLiftPx', () => {
  it('lifts a portrait phone far enough to clear the top tile row', () => {
    // iPhone-class portrait: 402x874, peek 164 (130 + 34 inset) ->
    // container 402x710. Row bottom sits at (710-402)/2 + 4.659 *
    // (402/13.318) = 294.6px; the open sheet top is 218.5px.
    const l = lift(402, 710, 874, base);
    expect(l).toBeGreaterThanOrEqual(80);
    expect(l).toBeLessThanOrEqual(100);
  });

  it('needs no lift in landscape, where the row already clears the sheet', () => {
    // 874x402 landscape, peek 151 -> container 874x251: height-limited fit
    // puts the base row bottom at 87.8px, sheet top at 100.5px.
    expect(lift(874, 251, 402, base)).toBe(0);
    expect(lift(874, 251, 402, expansion)).toBe(0);
  });

  it('scales with viewport and board size', () => {
    const androidBase = lift(360, 610, 740, base);
    expect(androidBase).toBeGreaterThanOrEqual(65);
    const tabletBase = lift(810, 950, 1080, base);
    expect(tabletBase).toBeGreaterThanOrEqual(85);
    // The expansion's frame is proportionally larger, so its top row sits
    // higher in the fitted square and needs less lift.
    const phoneExpansion = lift(402, 710, 874, expansion);
    expect(phoneExpansion).toBeGreaterThanOrEqual(50);
    expect(phoneExpansion).toBeLessThan(lift(402, 710, 874, base));
  });

  it('keeps the lifted top row on screen (top edge never clips above y=0)', () => {
    // Top edge of the top row is 2 units above its bottom vertex.
    for (const [w, h, vh, geom] of [
      [402, 710, 874, base],
      [360, 610, 740, base],
      [810, 950, 1080, base],
      [402, 710, 874, expansion],
    ] as const) {
      const side = Math.min(w, h);
      const ppu = side / (2 * geom.viewBoxR);
      const rowTop = (h - side) / 2 + (geom.viewBoxR + geom.topRowBottomUnits - 2) * ppu;
      expect(rowTop - lift(w, h, vh, geom)).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns zero on degenerate inputs', () => {
    expect(lift(0, 710, 874, base)).toBe(0);
    expect(lift(402, 0, 874, base)).toBe(0);
    expect(openLiftPx({ containerWidthPx: 402, containerHeightPx: 710, viewBoxR: 0, topRowBottomUnits: -2, viewportHeightPx: 874 })).toBe(0);
  });
});
