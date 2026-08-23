import { describe, expect, it } from 'vitest';
import {
  createPanZoom,
  STRANDED_HOLD_MS,
  type PanZoom,
  type PanZoomHandle,
  type View,
} from '../src/ui/panZoom';

// The controller writes through an injected handle, so the "DOM" here is three
// recorded strings. That is the whole reason panZoom.ts is a separate module:
// mode ownership is testable in plain node, with no jsdom and no synthesized
// PointerEvents, so T1's mutation check is a real check rather than a bet on
// how faithfully jsdom models pointer capture.
type FakeDOM = {
  css: string;
  willChange: string;
  svg: string | null;
  handle: PanZoomHandle;
};

function fakeDOM(): FakeDOM {
  const dom: FakeDOM = {
    css: '',
    willChange: '',
    svg: null,
    handle: {
      setCSSTransform: v => { dom.css = v; },
      setWillChange: v => { dom.willChange = v; },
      setSVGTransform: v => { dom.svg = v; },
    },
  };
  return dom;
}

const GEOMETRY = { viewBoxR: 6, boardCx: 0, boardCy: 0, pxPerUnit: 50 };

function setup(opts: { now?: () => number; warn?: (m: string) => void } = {}) {
  const dom = fakeDOM();
  const warnings: string[] = [];
  const pz = createPanZoom({
    handle: () => dom.handle,
    geometry: () => GEOMETRY,
    dev: true,
    warn: opts.warn ?? (m => warnings.push(m)),
    now: opts.now,
  });
  return { dom, pz, warnings };
}

/**
 * Both transforms live at once is the bug. In that state the board renders at
 * scale^2 because the CSS transform composes on top of the group matrix.
 */
const isComposed = (dom: FakeDOM) => dom.css !== '' && dom.svg !== null;

/** Drive a zoomed-in wheel burst and leave the wheel holding CSS mode. */
function wheelZoomIn(pz: PanZoom) {
  pz.acquire('wheel');
  pz.zoomByWheel(-500); // -500 * 0.002 = +1.0 → scale 2
  pz.render();
}

describe('panZoom mode ownership', () => {
  // T1. The reported bug, reproduced at the state-machine level: an orphaned
  // wheel idle timer expiring inside a live drag must NOT perform the swap.
  //
  // Mutation-verified. Replacing the guard in release():
  //     if (holds.size > 0) return;
  // with an unconditional swap makes the "hands off" and "never composed"
  // assertions below fail, which is exactly the old exitCSSMode() behavior.
  // Dropping the holds set entirely (making acquire/release no-ops over a
  // boolean) fails them too.
  it('orphaned wheel timer mid-drag hands off instead of swapping', () => {
    const { dom, pz } = setup();

    // Wheel-zoom to 2x. The wheel now holds CSS mode and has armed its timer.
    wheelZoomIn(pz);
    expect(pz.getView().scale).toBe(2);
    expect(pz.holds()).toEqual(['wheel']);
    expect(dom.css).not.toBe('');
    expect(dom.svg).toBeNull();

    // Grab and drag before the timer expires. Both gestures now hold.
    pz.acquire('drag');
    expect(pz.holds()).toEqual(['drag', 'wheel']);

    pz.panByPixels(40, 0);
    pz.render();
    expect(isComposed(dom)).toBe(false);

    // The orphaned timer expires mid-drag. This is the exact moment the old
    // code installed the group matrix under a live drag.
    pz.release('wheel');
    expect(pz.holds()).toEqual(['drag']);
    expect(pz.isCSSMode()).toBe(true);
    expect(dom.svg).toBeNull();

    // Keep dragging. Under the old code this frame re-applied the CSS
    // transform on top of the matrix and the board jumped to 4x.
    for (let i = 0; i < 30; i++) {
      pz.panByPixels(4, 2);
      pz.render();
      expect(isComposed(dom)).toBe(false);
    }

    // Release restores SVG mode at the correct scale, which is why the old bug
    // snapped back on pointer-up.
    pz.release('drag');
    expect(pz.holds()).toEqual([]);
    expect(dom.css).toBe('');
    expect(dom.svg).toContain('matrix(2 0 0 2');
  });

  // The negative control: the same sequence with the wheel released before the
  // drag starts is clean, which matches repro B being clean in the browser.
  it('wheel released before the drag starts leaves one transform live', () => {
    const { dom, pz } = setup();

    wheelZoomIn(pz);
    pz.release('wheel');
    expect(pz.holds()).toEqual([]);
    expect(dom.css).toBe('');
    expect(dom.svg).toContain('matrix(2 0 0 2');

    pz.acquire('drag');
    expect(dom.svg).toBeNull();
    for (let i = 0; i < 10; i++) {
      pz.panByPixels(5, 5);
      pz.render();
      expect(isComposed(dom)).toBe(false);
    }
    pz.release('drag');
    expect(isComposed(dom)).toBe(false);
  });

  // A wheel tick arriving DURING a drag is the deterministic form of the bug:
  // it arms a fresh timer that is near-certain to expire before the drag ends.
  it('wheel tick during a live drag cannot end the drag mode', () => {
    const { dom, pz } = setup();

    pz.acquire('drag');
    pz.panByPixels(20, 0);
    pz.render();

    pz.acquire('wheel');
    pz.zoomByWheel(-250);
    pz.render();
    expect(pz.holds()).toEqual(['drag', 'wheel']);

    pz.release('wheel'); // timer expires mid-drag
    expect(pz.isCSSMode()).toBe(true);
    expect(isComposed(dom)).toBe(false);

    pz.panByPixels(10, 10);
    pz.render();
    expect(isComposed(dom)).toBe(false);

    pz.release('drag');
    expect(pz.holds()).toEqual([]);
  });

  // T2. Every gesture type returns the hold set to empty.
  it('holds return to empty after every gesture type', () => {
    const { dom, pz } = setup();

    pz.acquire('drag');
    pz.panByPixels(10, 10);
    pz.render();
    pz.release('drag');
    expect(pz.holds()).toEqual([]);

    pz.acquire('pinch');
    pz.setPinchScale(1.8);
    pz.render();
    pz.release('pinch');
    expect(pz.holds()).toEqual([]);

    pz.acquire('wheel');
    pz.zoomByWheel(-100);
    pz.render();
    pz.release('wheel');
    expect(pz.holds()).toEqual([]);

    // Double-click / reset button.
    pz.acquire('drag');
    pz.reset();
    expect(pz.holds()).toEqual([]);
    expect(pz.getView()).toEqual({ x: 0, y: 0, scale: 1 });
    expect(dom.css).toBe('');
    expect(dom.svg).toBeNull();

    // Overlapping gestures unwind to empty in either order.
    pz.acquire('wheel');
    pz.acquire('drag');
    pz.release('wheel');
    pz.release('drag');
    expect(pz.holds()).toEqual([]);

    pz.acquire('wheel');
    pz.acquire('drag');
    pz.release('drag');
    pz.release('wheel');
    expect(pz.holds()).toEqual([]);
  });

  it('acquire is idempotent per key so a wheel burst takes one hold', () => {
    const { pz } = setup();
    for (let i = 0; i < 25; i++) pz.acquire('wheel');
    expect(pz.holds()).toEqual(['wheel']);
    pz.release('wheel');
    expect(pz.holds()).toEqual([]);
  });

  // T3. F4: the exit is written to absolute values, so repeating it is a no-op.
  it('a double exit is harmless', () => {
    const { dom, pz } = setup();

    pz.acquire('drag');
    pz.panByPixels(100, -50);
    pz.render();
    pz.release('drag');

    const after = { css: dom.css, willChange: dom.willChange, svg: dom.svg };
    const view = pz.getView();

    // Release again from a path that no longer holds anything.
    pz.release('drag');
    pz.release('wheel');
    pz.release('pinch');

    expect({ css: dom.css, willChange: dom.willChange, svg: dom.svg }).toEqual(after);
    expect(pz.getView()).toEqual(view);
    expect(pz.holds()).toEqual([]);
    expect(isComposed(dom)).toBe(false);
  });

  // T4. F2: reset forces the set empty rather than decrementing, and a release
  // arriving afterwards from a gesture that WAS holding does not underflow.
  it('reset forces holds to zero and later releases do not underflow', () => {
    const { dom, pz } = setup();

    pz.acquire('wheel');
    pz.acquire('drag');
    pz.acquire('pinch');
    expect(pz.holds()).toEqual(['drag', 'pinch', 'wheel']);

    pz.reset();
    expect(pz.holds()).toEqual([]);
    expect(pz.isCSSMode()).toBe(false);
    expect(dom.css).toBe('');
    expect(dom.willChange).toBe('');
    expect(dom.svg).toBeNull();

    // The three gestures are still live and each will eventually end. None of
    // them may drag the board back into CSS mode or corrupt the count.
    pz.release('drag');
    pz.release('pinch');
    pz.release('wheel');
    expect(pz.holds()).toEqual([]);
    expect(pz.isCSSMode()).toBe(false);
    expect(isComposed(dom)).toBe(false);

    // And the next gesture still works from the reset state.
    pz.acquire('drag');
    expect(pz.isCSSMode()).toBe(true);
    pz.release('drag');
    expect(pz.holds()).toEqual([]);
  });

  it('reset from an empty hold set is a no-op, not an underflow', () => {
    const { pz } = setup();
    pz.reset();
    pz.reset();
    expect(pz.holds()).toEqual([]);
    expect(pz.isCSSMode()).toBe(false);
  });
});

describe('panZoom view math', () => {
  // The extraction must not move the board. These pin the two writers to the
  // exact strings Board.tsx produced before the refactor.
  it('writes the same CSS transform the inline version did', () => {
    const { dom, pz } = setup();
    pz.acquire('drag');
    pz.panByPixels(100, 50); // /50 px-per-unit → +2, +1 user units
    pz.render();
    expect(pz.getView()).toEqual({ x: 2, y: 1, scale: 1 });
    expect(dom.css).toBe('translate3d(100px, 50px, 0) scale(1)');
  });

  it('writes the same SVG matrix the inline version did', () => {
    const { dom, pz } = setup();
    pz.acquire('wheel');
    pz.zoomByWheel(-500); // scale 2
    pz.release('wheel');
    // boardCx/Cy are 0 here, so tx = x + 0 * (1 - scale) = 0.
    expect(dom.svg).toBe('matrix(2 0 0 2 0 0)');
  });

  it('pivots the SVG matrix around a non-origin board center', () => {
    const dom = fakeDOM();
    const pz = createPanZoom({
      handle: () => dom.handle,
      geometry: () => ({ viewBoxR: 6, boardCx: 0.5, boardCy: -0.25, pxPerUnit: 50 }),
      dev: false,
    });
    pz.acquire('wheel');
    pz.zoomByWheel(-500); // scale 2
    pz.release('wheel');
    // tx = 0 + 0.5 * (1 - 2) = -0.5, ty = 0 + -0.25 * (1 - 2) = 0.25
    expect(dom.svg).toBe('matrix(2 0 0 2 -0.5 0.25)');
  });

  it('removes the SVG transform entirely at identity', () => {
    const { dom, pz } = setup();
    pz.acquire('drag');
    pz.panByPixels(100, 0);
    pz.render();
    pz.release('drag');
    expect(dom.svg).not.toBeNull();
    pz.reset();
    expect(dom.svg).toBeNull();
  });

  it('clamps pan to +/- viewBoxR * scale and feeds the clamped value forward', () => {
    const { pz } = setup();
    pz.acquire('drag');
    // 10000px / 50 = 200 user units, far past the bound of 6 * 1.
    pz.panByPixels(10000, -10000);
    pz.render();
    expect(pz.getView().x).toBe(6);
    expect(pz.getView().y).toBe(-6);

    // The clamped value is what the next delta accumulates onto, so reversing
    // moves immediately instead of unwinding an invisible overshoot.
    pz.panByPixels(-50, 0);
    pz.render();
    expect(pz.getView().x).toBe(5);
  });

  it('widens the clamp bound with scale', () => {
    const { pz } = setup();
    pz.acquire('wheel');
    pz.zoomByWheel(-500); // scale 2 → bound 12
    pz.acquire('drag');
    pz.panByPixels(10000, 0);
    pz.render();
    expect(pz.getView().x).toBe(12);
  });

  it('never divides the drag delta by scale', () => {
    const { pz } = setup();
    pz.acquire('wheel');
    pz.zoomByWheel(-500); // scale 2
    pz.acquire('drag');
    pz.panByPixels(100, 0);
    // translate sits left of scale in the CSS string, so it applies in the
    // post-scale parent space: 100px of cursor travel is 100px of translate at
    // any zoom level.
    expect(pz.getView().x).toBe(2);
  });

  it('clamps scale to the MIN/MAX range from both wheel and pinch', () => {
    const { pz } = setup();
    pz.acquire('wheel');
    pz.zoomByWheel(-100000);
    expect(pz.getView().scale).toBe(3);
    pz.zoomByWheel(100000);
    expect(pz.getView().scale).toBe(0.6);
    pz.setPinchScale(99);
    expect(pz.getView().scale).toBe(3);
    pz.setPinchScale(0.01);
    expect(pz.getView().scale).toBe(0.6);
  });

  it('a stray frame after the last release writes SVG, never a second transform', () => {
    const { dom, pz } = setup();
    pz.acquire('drag');
    pz.panByPixels(60, 0);
    pz.render();
    pz.release('drag');
    // A queued rAF that the cancel missed.
    pz.render();
    expect(dom.css).toBe('');
    expect(isComposed(dom)).toBe(false);
  });

  it('getView returns a copy', () => {
    const { pz } = setup();
    const v = pz.getView() as View;
    v.scale = 99;
    expect(pz.getView().scale).toBe(1);
  });
});

describe('panZoom stranded-hold diagnostic', () => {
  it('warns once when a hold outlives any plausible gesture', () => {
    let t = 0;
    const { pz, warnings } = setup({ now: () => t });

    pz.acquire('drag');
    t += STRANDED_HOLD_MS / 2;
    pz.checkStranded();
    expect(warnings).toEqual([]);

    t += STRANDED_HOLD_MS;
    pz.checkStranded();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('drag');
    expect(warnings[0]).toContain('stuck in CSS mode');

    // Once per stranded episode, not once per poll.
    pz.checkStranded();
    pz.checkStranded();
    expect(warnings).toHaveLength(1);
  });

  it('stays quiet for gestures that end normally and re-arms afterwards', () => {
    let t = 0;
    const { pz, warnings } = setup({ now: () => t });

    for (let i = 0; i < 5; i++) {
      pz.acquire('drag');
      t += 1000;
      pz.checkStranded();
      pz.release('drag');
      t += 10_000;
      pz.checkStranded();
    }
    expect(warnings).toEqual([]);

    // A leak after a healthy run is still caught.
    pz.acquire('wheel');
    t += STRANDED_HOLD_MS + 1;
    pz.checkStranded();
    expect(warnings).toHaveLength(1);
  });

  it('is silent when dev is off', () => {
    const dom = fakeDOM();
    const warnings: string[] = [];
    let t = 0;
    const pz = createPanZoom({
      handle: () => dom.handle,
      geometry: () => GEOMETRY,
      dev: false,
      warn: m => warnings.push(m),
      now: () => t,
    });
    pz.acquire('drag');
    t += STRANDED_HOLD_MS * 10;
    pz.checkStranded();
    expect(warnings).toEqual([]);
  });
});

describe('panZoom before mount', () => {
  it('tracks view state even while the handle is null', () => {
    const pz = createPanZoom({
      handle: () => null,
      geometry: () => GEOMETRY,
      dev: false,
    });
    pz.acquire('drag');
    pz.panByPixels(100, 50);
    pz.render();
    expect(pz.getView()).toEqual({ x: 2, y: 1, scale: 1 });
    expect(pz.holds()).toEqual(['drag']);
    pz.release('drag');
    expect(pz.holds()).toEqual([]);
  });
});
