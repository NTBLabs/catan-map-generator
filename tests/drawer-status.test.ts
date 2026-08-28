import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DRAWER_PEEK_FALLBACK_PX,
  collapsedOffsetPx,
  computePeekPx,
  openLiftPx,
} from '../src/ui/drawerMetrics';
import { statusFor, type GenStatusKind } from '../src/ui/status';

// The drawer's collapsed height ("peek") is one measured number shared by the
// JS collapse offset and the CSS consumers. These tests pin the math and the
// invariants the measurement depends on.

describe('drawer peek math', () => {
  it('peek is header height plus safe-area inset, rounded up', () => {
    expect(computePeekPx(103, 34)).toBe(137);
    expect(computePeekPx(103, 0)).toBe(103);
    expect(computePeekPx(103.4, 20.6)).toBe(124);
  });

  it('clamps garbage inputs instead of poisoning the layout', () => {
    expect(computePeekPx(NaN, 34)).toBe(34);
    expect(computePeekPx(103, NaN)).toBe(103);
    expect(computePeekPx(-5, -5)).toBe(0);
    expect(computePeekPx(Infinity, 0)).toBe(0);
  });

  it('collapse offset is drawer height minus peek, never negative', () => {
    expect(collapsedOffsetPx(655, 137)).toBe(518);
    expect(collapsedOffsetPx(100, 137)).toBe(0);
  });

  it('the static CSS fallback matches DRAWER_PEEK_FALLBACK_PX', () => {
    // theme.css carries a pre-measurement fallback that should equal the JS
    // constant; this is the drift guard the old PEEK_PX comment could only
    // promise.
    const theme = readFileSync(join(__dirname, '../src/ui/theme.css'), 'utf8');
    expect(theme).toContain(`--drawer-peek: calc(${DRAWER_PEEK_FALLBACK_PX}px + env(safe-area-inset-bottom))`);
  });
});

describe('open-drawer lift', () => {
  // Real geometry from the layouts: base board viewBoxR 6.659 with the top
  // tile row's bottom vertex 2 units above center; expansion 8.244 / 3.5.
  const base = { viewBoxR: 6.659, topRowBottomUnits: -2 };
  const expansion = { viewBoxR: 8.244, topRowBottomUnits: -3.5 };

  const lift = (w: number, h: number, vh: number, geom: typeof base) =>
    openLiftPx({
      containerWidthPx: w,
      containerHeightPx: h,
      viewportHeightPx: vh,
      ...geom,
    });

  it('lifts a portrait phone far enough to clear the top tile row', () => {
    // iPhone-class portrait: 402x874, peek 137 -> container 402x737.
    const l = lift(402, 737, 874, base);
    // Row bottom sits at (737-402)/2 + 4.659 * (402/13.318) = 308.1px; the
    // open drawer top is 218.5px. Lift must cover the 89.6px gap plus pad.
    expect(l).toBeGreaterThanOrEqual(90);
    expect(l).toBeLessThanOrEqual(110);
  });

  it('landscape needs no lift when the row already clears the sheet', () => {
    // 874x402 landscape, peek 124 -> container 874x278: height-limited fit
    // puts the row bottom at 4.659 * (278/13.318) = 97.3px, drawer top at
    // 100.5px. Within the 8px pad this still asks for a few px, never a
    // phone-sized lift.
    const l = lift(874, 278, 402, base);
    expect(l).toBeLessThanOrEqual(10);
  });

  it('scales up for tablets and the larger expansion board', () => {
    const tablet = lift(810, 977, 1080, base);
    expect(tablet).toBeGreaterThanOrEqual(97);
    const exp = lift(402, 737, 874, expansion);
    expect(exp).toBeGreaterThanOrEqual(65);
    expect(exp).toBeLessThan(tablet);
  });

  it('returns zero on degenerate inputs', () => {
    expect(lift(0, 737, 874, base)).toBe(0);
    expect(lift(402, 0, 874, base)).toBe(0);
    expect(openLiftPx({ containerWidthPx: 402, containerHeightPx: 737, viewBoxR: 0, topRowBottomUnits: -2, viewportHeightPx: 874 })).toBe(0);
  });
});

describe('generation status line', () => {
  const cases: Array<[GenStatusKind, Parameters<typeof statusFor>[0]]> = [
    ['idle', { generating: false, hasMap: false, attempts: 0, fellBack: false }],
    ['generating', { generating: true, hasMap: true, attempts: 12, fellBack: false }],
    ['done', { generating: false, hasMap: true, attempts: 12, fellBack: false }],
    ['fallback', { generating: false, hasMap: true, attempts: 5000, fellBack: true }],
  ];

  it('maps store state to the four kinds', () => {
    for (const [kind, input] of cases) {
      expect(statusFor(input).kind).toBe(kind);
    }
  });

  it('generating wins over a previous result during regeneration', () => {
    expect(statusFor({ generating: true, hasMap: true, attempts: 500, fellBack: true }).kind).toBe('generating');
  });

  it('a URL-loaded map (attempts 0) reads as idle, not as solved in 0', () => {
    expect(statusFor({ generating: false, hasMap: true, attempts: 0, fellBack: false }).kind).toBe('idle');
  });

  it('pluralizes attempts', () => {
    expect(statusFor({ generating: false, hasMap: true, attempts: 1, fellBack: false }).text).toBe('Solved in 1 attempt');
    expect(statusFor({ generating: false, hasMap: true, attempts: 2, fellBack: false }).text).toBe('Solved in 2 attempts');
  });

  // The header's measured height must be identical across all four states:
  // the peek is measured FROM the header, so a height change would move the
  // board. No layout engine exists in this test environment (and jsdom does
  // not compute layout either), so the assertion pins the mechanism that
  // makes the height state-independent: every status text is a single line,
  // and the CSS gives the line a FIXED height with wrapping forbidden.
  it('header height is state-independent: all four texts are single-line', () => {
    for (const [, input] of cases) {
      const { text } = statusFor(input);
      expect(text).not.toMatch(/\n/);
      expect(text.length).toBeLessThan(40);
    }
  });

  it('header height is state-independent: the CSS pins the line box', () => {
    const css = readFileSync(join(__dirname, '../src/ui/app.css'), 'utf8');
    const rule = css.match(/\.controls__status \{[^}]*\}/)?.[0];
    expect(rule).toBeTruthy();
    expect(rule).toMatch(/[^-]height: 20px/);
    expect(rule).toMatch(/line-height: 20px/);
    expect(rule).toMatch(/white-space: nowrap/);
    expect(rule).toMatch(/overflow: hidden/);
  });
});
