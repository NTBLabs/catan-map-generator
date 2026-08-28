/**
 * The header status line's state, derived from the store. Pure, so the four
 * states (and the invariants the drawer's measured peek depends on) are
 * testable without a DOM.
 *
 * Single-line is load-bearing: the drawer's collapsed height is MEASURED from
 * the header, so a status text that wrapped would change the peek and move
 * the board. The CSS pins the line (nowrap + hidden overflow) and every text
 * produced here is short enough not to need the ellipsis in practice.
 */

export type GenStatusKind = 'idle' | 'generating' | 'done' | 'fallback';

export interface GenStatus {
  kind: GenStatusKind;
  /** Rendered verbatim in the header line. Empty for idle: the line keeps its
   *  reserved height (CSS), it just shows nothing. */
  text: string;
}

export function statusFor(s: {
  generating: boolean;
  hasMap: boolean;
  attempts: number;
  fellBack: boolean;
}): GenStatus {
  if (s.generating) return { kind: 'generating', text: 'Generating…' };
  // "Solved in N attempts" is developer vocabulary; a plainer phrasing is
  // wanted post-launch once the copy settles. Copy change only, on purpose.
  if (s.hasMap && s.fellBack) return { kind: 'fallback', text: `Best effort: ${s.attempts} attempts` };
  if (s.hasMap && s.attempts > 0) {
    return { kind: 'done', text: `Solved in ${s.attempts} attempt${s.attempts === 1 ? '' : 's'}` };
  }
  // No map yet, or a map loaded from a share link (attempts 0): nothing to
  // report about a generation that didn't happen here.
  return { kind: 'idle', text: '' };
}
