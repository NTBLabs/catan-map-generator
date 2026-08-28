import { describe, expect, it } from 'vitest';
import { createPanZoom, type PanZoomHandle } from '../src/ui/panZoom';

// Pointer-anchored zoom. tests/panzoom.test.ts is deliberately UNTOUCHED:
// its 22 tests passing unchanged is the proof that the unanchored paths
// (zoomByWheel / setPinchScale, still center-anchored) are bit-identical.
// This file covers only the new anchored variants.

const K = 50; // pxPerUnit
const R = 6;

function setup() {
  const handle: PanZoomHandle = {
    setCSSTransform: () => {},
    setWillChange: () => {},
    setSVGTransform: () => {},
  };
  return createPanZoom({
    handle: () => handle,
    geometry: () => ({ viewBoxR: R, boardCx: 0, boardCy: 0, pxPerUnit: K }),
    dev: false,
  });
}

/** Screen position (px, element-center origin) of a board point p (user
 *  units) under the composed mapping the two writers share. */
function screenOf(view: { x: number; y: number; scale: number }, p: { x: number; y: number }) {
  return {
    x: (view.x + view.scale * p.x) * K,
    y: (view.y + view.scale * p.y) * K,
  };
}

/** Board point currently under a screen anchor (px, element-center origin). */
function boardUnder(view: { x: number; y: number; scale: number }, a: { x: number; y: number }) {
  return {
    x: (a.x / K - view.x) / view.scale,
    y: (a.y / K - view.y) / view.scale,
  };
}

describe('anchored zoom fixed point', () => {
  it('keeps the board point under the wheel cursor fixed across a zoom step', () => {
    const pz = setup();
    const anchor = { x: 100, y: -60 };
    const p = boardUnder(pz.getView(), anchor);
    pz.zoomByWheelAt(-500, anchor.x, anchor.y); // scale 1 -> 2
    expect(pz.getView().scale).toBe(2);
    const after = screenOf(pz.getView(), p);
    expect(after.x).toBeCloseTo(anchor.x, 10);
    expect(after.y).toBeCloseTo(anchor.y, 10);
  });

  it('holds the fixed point across multiple steps with different anchors', () => {
    const pz = setup();
    const anchors = [
      { x: 80, y: 40 },
      { x: -120, y: 10 },
      { x: 30, y: -90 },
    ];
    for (const a of anchors) {
      const p = boardUnder(pz.getView(), a);
      pz.zoomByWheelAt(-150, a.x, a.y);
      const s = screenOf(pz.getView(), p);
      expect(s.x).toBeCloseTo(a.x, 10);
      expect(s.y).toBeCloseTo(a.y, 10);
    }
  });

  it('tracks a moving pinch midpoint: each frame anchors at its own origin', () => {
    const pz = setup();
    let scale = 1;
    let anchor = { x: 60, y: 30 };
    for (let i = 0; i < 5; i++) {
      scale += 0.2;
      anchor = { x: anchor.x + 15, y: anchor.y - 10 }; // fingers drifting
      const p = boardUnder(pz.getView(), anchor);
      pz.setPinchScaleAt(scale, anchor.x, anchor.y);
      const s = screenOf(pz.getView(), p);
      expect(s.x).toBeCloseTo(anchor.x, 10);
      expect(s.y).toBeCloseTo(anchor.y, 10);
    }
    expect(pz.getView().scale).toBeCloseTo(2, 10);
  });
});

describe('anchored zoom at the clamps', () => {
  it('computes the anchor against the CLAMPED scale, not the raw request', () => {
    const pz = setup();
    pz.setPinchScaleAt(2, 0, 0);
    const anchor = { x: 100, y: 0 };
    const p = boardUnder(pz.getView(), anchor);
    // Raw request 6 clamps to MAX_SCALE 3; the fixed point must hold for
    // the clamped factor, not drift by the unclamped one.
    pz.setPinchScaleAt(6, anchor.x, anchor.y);
    expect(pz.getView().scale).toBe(3);
    const s = screenOf(pz.getView(), p);
    expect(s.x).toBeCloseTo(anchor.x, 10);
    expect(s.y).toBeCloseTo(anchor.y, 10);
  });

  it('a fully saturated tick changes nothing, anchor included', () => {
    const pz = setup();
    pz.setPinchScaleAt(3, 0, 0);
    const before = pz.getView();
    pz.zoomByWheelAt(-500, 140, -80); // would exceed MAX_SCALE
    expect(pz.getView()).toEqual(before);
  });

  it('the pan clamp still wins: anchored zoom cannot push past the bound', () => {
    const pz = setup();
    // Anchor 1000px off-center wants t' = -40 user units at scale 3; the
    // bound is R * scale = 18. The board pins at the bound (the anchor
    // slides), preserving the half-the-board-on-screen guarantee.
    pz.zoomByWheelAt(-1000, 1000, 0); // scale 1 -> 3
    pz.render();
    expect(pz.getView().scale).toBe(3);
    expect(pz.getView().x).toBe(-R * 3);
  });

  it('does not acquire any hold: mode ownership is untouched by anchored calls', () => {
    const pz = setup();
    pz.zoomByWheelAt(-200, 50, 50);
    pz.setPinchScaleAt(1.4, -30, 20);
    expect(pz.holds()).toEqual([]);
    expect(pz.isCSSMode()).toBe(false);
  });

  it('unanchored methods still leave x and y untouched (board-center anchor)', () => {
    const pz = setup();
    pz.acquire('drag');
    pz.panByPixels(100, 50); // x=2, y=1 user units
    pz.release('drag');
    pz.zoomByWheel(-500);
    pz.setPinchScale(1.5);
    expect(pz.getView().x).toBe(2);
    expect(pz.getView().y).toBe(1);
  });
});
