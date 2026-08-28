/** Whether a board gesture began on the view-control overlay rather than
 *  the pan surface.
 *
 *  The pan/zoom gesture binds to the WHOLE board container, so pointer
 *  events from the overlaid control cluster bubble into the drag handler:
 *  pressing a rotate nudge panned the map under the finger. CDP probing
 *  showed this was never nudge-specific: drags starting on the readout
 *  panned identically, and the pan/zoom reset merely masked its own
 *  accidental pans because its click resets the view. So the guard keys on
 *  the CLUSTER container, not on any button class: ancestor-based, it
 *  survives button renames and regroupings like a5591b8's pill wrapper. */
export function beginsOnViewControls(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return !!(el && typeof el.closest === 'function' && el.closest('.board__view-controls'));
}
