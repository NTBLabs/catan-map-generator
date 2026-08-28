/**
 * Pure math for the mobile options drawer's collapsed height and the board's
 * response to the drawer being open. Extracted so the numbers have one home:
 * Controls.tsx measures the DOM and feeds the raw values in, Board.tsx feeds
 * its geometry in, and both consume the results. Nothing here touches the DOM,
 * so all of it is testable in node.
 *
 * The collapsed height ("peek") had three definition sites before this module
 * (a JS constant, a CSS custom property, and a comment promising they match)
 * and two of them disagreed about the safe-area inset. Now the peek is ONE
 * measured number: header height plus the live safe-area inset, computed here,
 * written to --drawer-peek for the CSS consumers (board bottom inset, drawer
 * pre-mount transform) and used directly by the drawer's collapse offset.
 */

/** Media query that switches the controls between bottom drawer and side
 *  panel. Shared by Controls (drawer behavior) and Board (open-drawer lift)
 *  so the two cannot disagree about where the breakpoint is. */
export const MOBILE_QUERY = '(max-width: 899px)';

/** Pre-measurement fallback for --drawer-peek, in px, matching the static
 *  value in theme.css. Only visible for the frames before the first header
 *  measurement lands (or if JS never runs, in which case React never mounts
 *  and there is no drawer to align with anyway). Derived from the header's
 *  CSS: handle row (10+5+6+16+8 = 45px) plus header row (48px button + 10px
 *  padding = 58px). */
export const DRAWER_PEEK_FALLBACK_PX = 103;

/** Open drawer height as a fraction of the viewport (max-height: 75dvh in
 *  app.css keeps the real drawer at or under this; content overflows, so on
 *  phones it is exactly this). */
export const OPEN_DRAWER_VIEWPORT_FRACTION = 0.75;

/** The collapsed drawer's visible height: the measured header plus the
 *  safe-area inset it must clear. Non-finite or negative inputs (unmounted
 *  refs, exotic env() results) clamp to zero rather than poisoning the
 *  layout with NaN. */
export function computePeekPx(headerHeightPx: number, safeAreaInsetPx: number): number {
  const header = Number.isFinite(headerHeightPx) ? Math.max(0, headerHeightPx) : 0;
  const inset = Number.isFinite(safeAreaInsetPx) ? Math.max(0, safeAreaInsetPx) : 0;
  return Math.ceil(header + inset);
}

/** How far down the drawer translates when collapsed. Clamped at zero so a
 *  drawer shorter than its own peek (impossible in practice, representable in
 *  math) pins open instead of translating upward. */
export function collapsedOffsetPx(drawerHeightPx: number, peekPx: number): number {
  return Math.max(0, drawerHeightPx - peekPx);
}

/**
 * How far the board container must shift up while the drawer is OPEN so the
 * top row of resource tiles stays visible above the sheet.
 *
 * The board centers its square viewBox in the container (xMidYMid meet), so
 * with the container spanning the viewport minus the peek, the open drawer
 * (75dvh) covers the entire land area on phones: the visible strip is the
 * top quarter of the screen and the land starts below it. The lift cannot be
 * a constant: it depends on viewport size, board size, and orientation
 * (landscape usually needs none). So Board.tsx computes it from its real
 * geometry and applies it as paired top/bottom insets that preserve the
 * container's HEIGHT, which keeps the fitted scale identical and therefore
 * keeps the pan/zoom CSS-vs-SVG mode equivalence intact (that equivalence
 * assumes the viewBox stays centered in the element, so alignment tricks
 * like xMidYMin are off the table).
 *
 * topRowBottomUnits: the y of the top tile row's bottom vertex in viewBox
 * user units, relative to the board center (negative, above center).
 * Measured from the real layouts: -2 for the 19-hex base board, -3.5 for the
 * 30-hex expansion (both boards center at cy = 0).
 */
export function openLiftPx(opts: {
  containerWidthPx: number;
  containerHeightPx: number;
  viewBoxR: number;
  topRowBottomUnits: number;
  viewportHeightPx: number;
  /** Breathing room between the tile row and the sheet edge. */
  padPx?: number;
}): number {
  const { containerWidthPx: w, containerHeightPx: h, viewBoxR: R, topRowBottomUnits, viewportHeightPx } = opts;
  const pad = opts.padPx ?? 8;
  if (!(w > 0) || !(h > 0) || !(R > 0) || !(viewportHeightPx > 0)) return 0;
  const side = Math.min(w, h);
  const boardTop = (h - side) / 2;
  const pxPerUnit = side / (2 * R);
  const rowBottom = boardTop + (R + topRowBottomUnits) * pxPerUnit;
  const openDrawerTop = viewportHeightPx * (1 - OPEN_DRAWER_VIEWPORT_FRACTION);
  return Math.max(0, Math.ceil(rowBottom - openDrawerTop + pad));
}
