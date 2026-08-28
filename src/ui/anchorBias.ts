/** Pull a pinch-zoom anchor onto the board's land disc.
 *
 *  The anchored-zoom math honors any anchor faithfully, but fingers are not
 *  cursors: a pinch whose midpoint lands in open water (or off the board)
 *  makes the board slide toward a point the user never thought of as a
 *  target. The fix is a pre-step on the ANCHOR, not a change to the
 *  anchoring math: an anchor outside the land's bounding circle is pulled
 *  to the nearest point on it; an anchor inside passes through untouched,
 *  so on-board pinching is bit-identical.
 *
 *  The bound is the land's bounding CIRCLE (radius landR about the board
 *  center) rather than the hex outline or the full viewBox: the land is
 *  what a user aims at, and a circle centered on the board center is
 *  rotation-invariant, so the clamp is exact at every rotation with no
 *  board-local mapping, the same property the anchored math itself has.
 *
 *  All inputs live in the anchored-zoom coordinate convention: screen
 *  pixels relative to the ELEMENT CENTER. The land center sits at the
 *  current translation (view.x, view.y user units) and its screen radius is
 *  landR scaled by pxPerUnit and the current zoom.
 */
export function biasAnchorToLand(
  axPx: number,
  ayPx: number,
  view: { x: number; y: number; scale: number },
  pxPerUnit: number,
  landR: number,
): { ax: number; ay: number } {
  const k = pxPerUnit;
  if (!(k > 0) || !(landR > 0)) return { ax: axPx, ay: ayPx };
  const bx = view.x * k;
  const by = view.y * k;
  const r = landR * k * view.scale;
  const dx = axPx - bx;
  const dy = ayPx - by;
  const d = Math.hypot(dx, dy);
  if (d <= r) return { ax: axPx, ay: ayPx };
  const f = r / d;
  return { ax: bx + dx * f, ay: by + dy * f };
}
