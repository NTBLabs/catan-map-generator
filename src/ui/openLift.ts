/**
 * Open-drawer board lift, mined from the reverted f0c5783.
 *
 * With the options drawer open (75dvh) the visible board strip is the top
 * quarter of the screen, and the centered fit puts the entire land area
 * below the sheet top: no board visible while choosing options. The fix
 * shifts the board container up just far enough that the top row of tiles
 * clears the sheet.
 *
 * The lift is applied by Board.tsx as PAIRED insets, top: -lift and
 * bottom: calc(var(--drawer-peek) + lift px), which preserve the
 * container's height exactly (height = viewport - top - bottom =
 * viewport - peek, lift cancelling out). Same height and width mean the
 * same fitted scale, because preserveAspectRatio sizes the square viewBox
 * by min(width, height); the board's center just rises by the lift. That
 * also keeps the pan/zoom CSS-vs-SVG mode equivalence intact: it assumes
 * the viewBox stays centered in the element, so alignment tricks like
 * xMidYMin (which would re-anchor for free) are off the table, and
 * panZoom.ts needs no change at all.
 *
 * No constant works across phone/tablet/orientation, so the lift derives
 * from the real geometry per viewport. Pure function, testable in node.
 */

/** Media query that switches the controls between bottom drawer and side
 *  panel. One definition, shared by Controls (drawer behavior) and Board
 *  (the lift applies only on the drawer side of the breakpoint). */
export const MOBILE_QUERY = '(max-width: 899px)';

/** Open drawer height as a fraction of the viewport (max-height: 75dvh in
 *  app.css; the body's content overflows, so on phones it is exactly
 *  this). */
export const OPEN_DRAWER_VIEWPORT_FRACTION = 0.75;

/**
 * topRowBottomUnits: the y of the top tile row's bottom vertex in viewBox
 * user units relative to the board center (negative, above center).
 * Measured from the real layouts: -2 for the 19-hex base board (top row
 * centers at y = -3), -3.5 for the 30-hex expansion (centers at -4.5).
 * Both boards center at cy = 0, including the wealthGap label-extended
 * viewBox, so viewBoxR alone fixes the vertical frame.
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
