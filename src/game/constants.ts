import type { PlayerCount, PortType, ProducingResource, Resource } from './types';

export const PIP_VALUE: Record<number, number> = {
  2: 1, 12: 1,
  3: 2, 11: 2,
  4: 3, 10: 3,
  5: 4, 9: 4,
  6: 5, 8: 5,
};

export const HIGH_YIELD_NUMBERS = new Set([5, 6, 8, 9]);
export const RED_NUMBERS = new Set([6, 8]);
export const LOW_YIELD_NUMBERS = new Set([2, 3, 11, 12]);

export const PRODUCING_RESOURCES: ProducingResource[] = ['wood', 'brick', 'wheat', 'sheep', 'ore'];

export interface BoardSpec {
  resourceCounts: Record<Resource, number>;
  numberCounts: Record<number, number>;
  portTypes: PortType[];
  rows: number[];
  totalHexes: number;
}

export const BASE_BOARD: BoardSpec = {
  resourceCounts: { wood: 4, brick: 3, wheat: 4, sheep: 4, ore: 3, desert: 1 },
  numberCounts: { 2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1 },
  // Canonical 5th-edition arrangement. Slots are stored clockwise from the
  // top-left, but the human-friendly ordering starts at the bottom-left and
  // walks UP the left side: 3:1, brick, wood, 3:1, wheat, ore, 3:1, sheep, 3:1.
  // Slot index → port type:
  //   0 top-left-of-top-row     → 3:1
  //   1 top-right-of-top-row    → wheat
  //   2 right-upper             → ore
  //   3 right-lower             → 3:1
  //   4 bottom-right            → sheep
  //   5 bottom-middle           → 3:1
  //   6 bottom-left             → 3:1   (the starting point)
  //   7 left-middle             → brick
  //   8 top-left-inner          → wood
  portTypes: ['generic', 'wheat', 'ore', 'generic', 'sheep', 'generic', 'generic', 'brick', 'wood'],
  rows: [3, 4, 5, 4, 3],
  totalHexes: 19,
};

export const EXPANSION_BOARD: BoardSpec = {
  // Standard 5-6 expansion tile distribution: 6 wood, 5 brick, 6 wheat,
  // 6 sheep, 5 ore, 2 desert = 30 hexes. (Cities & Knights swaps to 7
  // wheat / 5 sheep, but that's a separate variant — defer until needed.)
  resourceCounts: { wood: 6, brick: 5, wheat: 6, sheep: 6, ore: 5, desert: 2 },
  numberCounts: { 2: 2, 3: 3, 4: 3, 5: 3, 6: 3, 8: 3, 9: 3, 10: 3, 11: 3, 12: 2 },
  // 11 ports for the 5–6 expansion in CW order, aligned with
  // STANDARD_PORT_SIDES_EXPANSION (slot i ↔ portTypes[i]). Order matches the
  // canonical 5-6 expansion box layout: edges 3, 6, 9, 12, 15, 20, 23, 27,
  // 32, 35, 38 walking CW around the perimeter from the top-left.
  portTypes: ['wood', 'generic', 'wheat', 'generic', 'ore', 'generic', 'sheep', 'generic', 'generic', 'brick', 'sheep'],
  rows: [3, 4, 5, 6, 5, 4, 3],
  totalHexes: 30,
};

export function boardFor(playerCount: PlayerCount): BoardSpec {
  return playerCount <= 4 ? BASE_BOARD : EXPANSION_BOARD;
}

// Per-player-count cap on the snake-draft fairness stdev for a map to be
// accepted (no fallback). 1.0 is loose enough that challenge modes
// (scarcity / boom-or-bust / drought) — which by design create imbalanced
// boards — can still find candidates. If the generator can't hit this in
// MAX_ATTEMPTS, it falls back to the best candidate seen and surfaces a
// "best-effort" notice in the UI.
export const FAIRNESS_THRESHOLD: Record<PlayerCount, number> = {
  3: 1.0,
  4: 1.0,
  5: 1.0,
  6: 1.0,
};

// Stricter cap used when challenge.flavor === 'none' (balanced mode). At
// stdev ≤ 0.65 the spread (max−min) for 4 players lands around ~1.5, which
// matches the feel of an "even" map — no player's pick total runs away from
// the others. Tighter than 1.0 means more attempts on average, but still
// well within MAX_ATTEMPTS for a balanced board.
export const FAIRNESS_THRESHOLD_BALANCED: Record<PlayerCount, number> = {
  3: 0.6,
  4: 0.65,
  5: 0.75,
  6: 0.8,
};

export const MAX_ATTEMPTS = 5000;
