/** The escape-hatch reset: the WHOLE view, not just pan/zoom.
 *
 *  Pan/zoom lives in the panZoom controller while rotation lives in the
 *  store, so a full view reset crosses two seams. Keeping the crossing in
 *  one function lets a test pin the contract that the reset leaves NO view
 *  state dirty. The contract matters because of a real report: after
 *  a5591b8 grouped the rotate nudges, the rightmost button reads as "the
 *  reset" for the whole cluster, and its old pan/zoom-only behavior meant
 *  that on a rotated (but unpanned) board it ran and changed nothing,
 *  which reads as a dead button. */
import type { PanZoom } from './panZoom';

export function resetView(panZoom: Pick<PanZoom, 'reset'>, resetRotation: () => void): void {
  panZoom.reset();
  resetRotation();
}
