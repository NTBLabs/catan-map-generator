import { describe, expect, it } from 'vitest';
import { biasAnchorToLand } from '../src/ui/anchorBias';

// The pinch anchor is pulled onto the land's bounding circle before the
// fixed-point math runs. Base-board landR is ~4.36 user units; K is
// px-per-unit. The circle is centered on the board's CURRENT screen
// position (the view translation) and scales with zoom. Rotation never
// appears in these inputs by design: a circle about the board center is
// rotation-invariant, so the clamp is exact at every rotation.

const K = 50;
const LAND_R = 4.36;
const IDENT = { x: 0, y: 0, scale: 1 };

describe('biasAnchorToLand', () => {
  it('passes an on-land anchor through untouched', () => {
    // r = 4.36 * 50 = 218px; (100, -80) is well inside.
    expect(biasAnchorToLand(100, -80, IDENT, K, LAND_R)).toEqual({ ax: 100, ay: -80 });
    // Exactly on the rim counts as inside.
    expect(biasAnchorToLand(218, 0, IDENT, K, LAND_R)).toEqual({ ax: 218, ay: 0 });
  });

  it('pulls an off-land anchor to the nearest rim point along the ray', () => {
    const { ax, ay } = biasAnchorToLand(600, 0, IDENT, K, LAND_R);
    expect(ax).toBeCloseTo(218, 10);
    expect(ay).toBeCloseTo(0, 10);
    const d = biasAnchorToLand(300, 400, IDENT, K, LAND_R); // distance 500
    expect(d.ax).toBeCloseTo(300 * (218 / 500), 10);
    expect(d.ay).toBeCloseTo(400 * (218 / 500), 10);
  });

  it('centers the circle on the panned board, not the container', () => {
    const view = { x: 4, y: -2, scale: 1 }; // board center at (200, -100)px
    // 260px right of the board center: 42px outside the 218px rim.
    const { ax, ay } = biasAnchorToLand(460, -100, view, K, LAND_R);
    expect(ax).toBeCloseTo(200 + 218, 10);
    expect(ay).toBeCloseTo(-100, 10);
    // The same screen point is INSIDE when the board is centered under it.
    expect(biasAnchorToLand(180, -100, view, K, LAND_R)).toEqual({ ax: 180, ay: -100 });
  });

  it('scales the rim with the zoom level', () => {
    const zoomed = { x: 0, y: 0, scale: 2 }; // rim at 436px
    expect(biasAnchorToLand(400, 0, zoomed, K, LAND_R)).toEqual({ ax: 400, ay: 0 });
    const { ax } = biasAnchorToLand(900, 0, zoomed, K, LAND_R);
    expect(ax).toBeCloseTo(436, 10);
  });

  it('is inert on degenerate geometry', () => {
    expect(biasAnchorToLand(500, 0, IDENT, 0, LAND_R)).toEqual({ ax: 500, ay: 0 });
    expect(biasAnchorToLand(500, 0, IDENT, K, 0)).toEqual({ ax: 500, ay: 0 });
  });
});
