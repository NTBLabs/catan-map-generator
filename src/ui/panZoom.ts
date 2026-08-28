/**
 * Headless pan/zoom controller for the board.
 *
 * Extracted from Board.tsx so the mode-ownership rules can be exercised
 * without a DOM: every DOM write goes through the injected PanZoomHandle, so
 * a test hands in a plain object and asserts on what would have been written.
 * The view math (user-unit storage, the clamp bound, the CSS to SVG
 * equivalence) is carried over from Board.tsx unchanged.
 *
 * ## Why the mode is owned by a SET
 *
 * The board renders pan/zoom two ways. During an active gesture it is a CSS
 * transform on the outer <svg> (fast GPU composite, transient blur is fine).
 * At rest it is an SVG matrix on an inner <g> (vector re-render, sharp at any
 * zoom). The two are algebraically equivalent, so swapping between them is
 * invisible. They are NOT additive: applied at the same time they COMPOSE,
 * and the board renders at scale^2.
 *
 * Three gestures can each want CSS mode (drag, pinch, wheel) and each ends on
 * its own signal. The wheel's signal is a bare idle timer, which can expire in
 * the middle of a drag. With a shared boolean, or with an exit call that any
 * gesture may make unilaterally, that expiry rips CSS mode out from under the
 * live drag: the exit installs the SVG matrix, the drag's next frame writes
 * the CSS transform back on top of it, and the board jumps to scale^2 until
 * the pointer is released. That was the observed bug.
 *
 * So CSS mode is held by a set of gesture keys rather than a flag or a
 * counter:
 *
 *   - CSS mode is active if and only if the set is non-empty.
 *   - A gesture releasing its own key cannot end a mode another gesture still
 *     holds. The orphaned timer hands off instead of swapping.
 *   - acquire and release are idempotent per key. A double release is a no-op
 *     and an underflow is not representable.
 *
 * That last property is the one that matters most. A counter can go negative,
 * and a negative counter never returns to zero, which strands the board in CSS
 * mode permanently. That failure is invisible on desktop and reintroduces the
 * iOS stale-bitmap blur that the mode swap exists to prevent. With a set the
 * hazard cannot be written down. It also lets the reset paths clear the set
 * outright, which is the correct move for a path that never acquired.
 */

export type View = { x: number; y: number; scale: number };

export const MIN_SCALE = 0.6;
export const MAX_SCALE = 3;
export const RESET: View = { x: 0, y: 0, scale: 1 };

/** Wheel zoom rate, in scale units per unit of wheel delta. */
export const WHEEL_ZOOM_RATE = 0.002;

/**
 * How long a hold may persist before it is treated as leaked. Any real gesture
 * is over long before this; a stranded hold lasts forever. Dev-only
 * diagnostic, so the generous bound costs nothing and avoids crying wolf at a
 * user who presses the button and sits still.
 */
export const STRANDED_HOLD_MS = 60_000;

/** Every gesture that can hold the board in CSS mode. */
export type HoldKey = 'drag' | 'pinch' | 'wheel';

/**
 * The DOM writes, injected. Both target elements are refs in Board.tsx and are
 * null before mount, so the whole handle is null then and writes are skipped,
 * matching the "if (!svg) return" guards this replaces.
 */
export interface PanZoomHandle {
  /** Outer <svg> CSS transform. Empty string clears it. */
  setCSSTransform(value: string): void;
  /** Outer <svg> will-change. Empty string clears it. */
  setWillChange(value: string): void;
  /** Inner <g> transform attribute. null removes the attribute. */
  setSVGTransform(value: string | null): void;
}

/**
 * Board geometry, read fresh on every write so a regenerated map (which can
 * change viewBoxR via the wealthGap label reach) or a container resize is
 * picked up without rebuilding the controller.
 */
export interface PanZoomGeometry {
  /** Half the viewBox side, in user units. Also the clamp bound at scale 1. */
  viewBoxR: number;
  boardCx: number;
  boardCy: number;
  /** Pixels per SVG user unit at the current container size. */
  pxPerUnit: number;
}

export interface PanZoomDeps {
  handle: () => PanZoomHandle | null;
  geometry: () => PanZoomGeometry;
  /** Gates the stranded-hold diagnostic. Board passes import.meta.env.DEV. */
  dev?: boolean;
  warn?: (message: string) => void;
  /** Injected clock, so the diagnostic is testable without real time. */
  now?: () => number;
}

export interface PanZoom {
  /** Current view, copied. Callers cannot mutate controller state through it. */
  getView(): View;
  /** Sorted, for stable assertions. */
  holds(): HoldKey[];
  isCSSMode(): boolean;
  /** Take a hold on CSS mode. Idempotent per key. */
  acquire(key: HoldKey): void;
  /** Drop one hold. Swaps back to SVG mode only when the last one goes. */
  release(key: HoldKey): void;
  panByPixels(dxPx: number, dyPx: number): void;
  /** Center-anchored zoom (scale-only change; the board's own center stays
   *  put). Kept byte-identical for callers with no pointer position. */
  zoomByWheel(dy: number): void;
  setPinchScale(s: number): void;
  /** Pointer-anchored zoom: the board point under the anchor stays fixed
   *  on screen. (axPx, ayPx) are screen pixels relative to the ELEMENT
   *  CENTER, the one origin both transform writers share. */
  zoomByWheelAt(dy: number, axPx: number, ayPx: number): void;
  setPinchScaleAt(s: number, axPx: number, ayPx: number): void;
  /** Clamp the view and write it in whichever mode is currently held. */
  render(): void;
  /** Force every hold off and snap to identity in SVG mode. */
  reset(): void;
  /** Dev-only leaked-hold diagnostic. */
  checkStranded(): void;
  clamp(next: View): View;
}

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

export function createPanZoom(deps: PanZoomDeps): PanZoom {
  const dev = deps.dev ?? true;
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const now = deps.now ?? (() => Date.now());

  let view: View = { ...RESET };
  const holds = new Set<HoldKey>();
  let heldSince = 0;
  let strandedWarned = false;

  // Clamp in SVG user units. Allows panning up to +/- R*scale in each axis,
  // which keeps at least half the board on screen at any zoom level.
  const clamp = (next: View): View => {
    const max = deps.geometry().viewBoxR * next.scale;
    return {
      scale: next.scale,
      x: Math.max(-max, Math.min(max, next.x)),
      y: Math.max(-max, Math.min(max, next.y)),
    };
  };

  // CSS transform on the outer <svg>. Panning is in pixels here (a CSS unit),
  // so x/y (stored in user units) are multiplied by pxPerUnit. translate sits
  // left of scale, so it applies in the post-scale parent space and maps 1:1
  // to screen pixels, which is why drag deltas are never divided by scale.
  const writeCSS = (v: View) => {
    const h = deps.handle();
    if (!h) return;
    const k = deps.geometry().pxPerUnit;
    h.setCSSTransform(`translate3d(${v.x * k}px, ${v.y * k}px, 0) scale(${v.scale})`);
  };

  // SVG-native transform on the inner <g>. Scale pivots around the viewBox
  // center (boardCx, boardCy) to match the CSS transform's
  // "transform-origin: center center", which is what makes the two modes
  // render the identical view.
  const writeSVG = (v: View) => {
    const h = deps.handle();
    if (!h) return;
    if (v.x === 0 && v.y === 0 && v.scale === 1) {
      h.setSVGTransform(null);
      return;
    }
    const { boardCx, boardCy } = deps.geometry();
    const tx = v.x + boardCx * (1 - v.scale);
    const ty = v.y + boardCy * (1 - v.scale);
    h.setSVGTransform(`matrix(${v.scale} 0 0 ${v.scale} ${tx} ${ty})`);
  };

  // Enter CSS mode: drop the inner group's transform, then write the
  // equivalent CSS transform. Both writes land in one frame, so the swap is
  // invisible.
  const enterCSS = () => {
    const h = deps.handle();
    if (!h) return;
    h.setSVGTransform(null);
    h.setWillChange('transform');
    writeCSS(view);
  };

  // Exit to SVG mode. One synchronous block: clear the CSS transform, drop
  // will-change, assert the group matrix. Every field is written to an
  // absolute value rather than toggled, so calling this twice writes the same
  // thing twice and a double exit is harmless whatever path it came from.
  const exitToSVG = () => {
    const h = deps.handle();
    if (!h) return;
    h.setCSSTransform('');
    h.setWillChange('');
    writeSVG(view);
  };

  // Anchored zoom: change scale while the board point under the anchor
  // stays fixed on screen. Derivation from the composed mapping
  // p -> c + t + s(p - c) (c = element center, t = translation): holding
  // M(p*) = A across s -> s' gives t' = a(1 - s'/s) + (s'/s)t with
  // a = A - c, here already converted to user units. The scale is clamped
  // BEFORE the translation is computed, so a tick that saturates at
  // MIN/MAX cannot smear the anchor. The pan clamp still applies at
  // render: at the bound the board pins and the anchor slides, keeping
  // the at-least-half-the-board-on-screen guarantee.
  const zoomToAt = (nextScale: number, axPx: number, ayPx: number) => {
    const s = clampScale(nextScale);
    const prev = view.scale;
    if (s === prev) return;
    const k = deps.geometry().pxPerUnit;
    if (!(k > 0)) {
      view = { ...view, scale: s };
      return;
    }
    const f = s / prev;
    const ax = axPx / k;
    const ay = ayPx / k;
    view = {
      scale: s,
      x: ax * (1 - f) + f * view.x,
      y: ay * (1 - f) + f * view.y,
    };
  };

  const checkStranded = () => {
    if (!dev) return;
    if (holds.size === 0) {
      strandedWarned = false;
      return;
    }
    if (strandedWarned) return;
    if (now() - heldSince <= STRANDED_HOLD_MS) return;
    strandedWarned = true;
    warn(
      `[panZoom] CSS mode has been held for over ${STRANDED_HOLD_MS / 1000}s by ` +
        `[${[...holds].sort().join(', ')}] with no gesture end. A hold leaked: the ` +
        `board is stuck in CSS mode and will render a stale bitmap on iOS.`,
    );
  };

  return {
    getView: () => ({ ...view }),
    holds: () => [...holds].sort(),
    isCSSMode: () => holds.size > 0,
    clamp,
    checkStranded,

    acquire(key) {
      if (holds.has(key)) return;
      const wasEmpty = holds.size === 0;
      holds.add(key);
      if (wasEmpty) {
        heldSince = now();
        strandedWarned = false;
        enterCSS();
      }
    },

    release(key) {
      holds.delete(key);
      // Only the last hold performs the swap. An orphaned wheel timer landing
      // mid-drag gets here, finds the drag still holding, and hands off.
      if (holds.size > 0) return;
      view = clamp(view);
      exitToSVG();
    },

    panByPixels(dxPx, dyPx) {
      const k = deps.geometry().pxPerUnit;
      // pxPerUnit is never <= 0 (it falls back to 1 before bounds are
      // measured), so this is defensive only. Kept because the alternative is
      // dividing by zero and poisoning the view with NaN.
      if (!(k > 0)) return;
      view = { ...view, x: view.x + dxPx / k, y: view.y + dyPx / k };
    },

    zoomByWheel(dy) {
      view = { ...view, scale: clampScale(view.scale - dy * WHEEL_ZOOM_RATE) };
    },

    setPinchScale(s) {
      view = { ...view, scale: clampScale(s) };
    },

    zoomByWheelAt(dy, axPx, ayPx) {
      zoomToAt(view.scale - dy * WHEEL_ZOOM_RATE, axPx, ayPx);
    },

    setPinchScaleAt(s, axPx, ayPx) {
      zoomToAt(s, axPx, ayPx);
    },

    render() {
      view = clamp(view);
      // Writes in whichever mode is held. A stray frame arriving after the
      // last release therefore writes SVG, not a second composed transform.
      if (holds.size > 0) writeCSS(view);
      else writeSVG(view);
      checkStranded();
    },

    reset() {
      // Force, do not decrement. This path never acquired, and the gestures
      // whose keys are being dropped may still be live: their eventual release
      // finds an empty set and re-asserts SVG mode, which is a no-op.
      holds.clear();
      strandedWarned = false;
      view = { ...RESET };
      exitToSVG();
    },
  };
}
