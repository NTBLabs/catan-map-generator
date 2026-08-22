import { boardFor, HIGH_YIELD_NUMBERS, RED_NUMBERS } from '../game/constants';
import { buildHexIndex, hexNeighbors } from '../game/layout';
import type { Hex, PlayerCount, Port } from '../game/types';

export interface ConstraintOptions {
  noSameNumberAdjacent: boolean;
  noSameNumberOnResource: boolean;
  noMultipleRedsOnResource: boolean;
  /** Relax the always-on "no two red numbers adjacent" rule. Used only by
   *  the hotZone challenge flavor where the whole point is reds clustering
   *  into a contested zone. Off for every other generation path. */
  allowRedAdjacency?: boolean;
}

export function checkHardConstraints(
  hexes: Hex[],
  ports: Port[],
  opts: ConstraintOptions = { noSameNumberAdjacent: false, noSameNumberOnResource: false, noMultipleRedsOnResource: false },
): { ok: boolean; reason?: string } {
  const byKey = buildHexIndex(hexes);

  // Sanity: every non-desert hex must carry a number. If placement aborted
  // early this protects downstream consumers from null-number leaks.
  for (const hex of hexes) {
    if (hex.resource !== 'desert' && hex.number === null) {
      return { ok: false, reason: `missing number on ${hex.id}` };
    }
  }

  for (const hex of hexes) {
    for (const n of hexNeighbors(hex, byKey)) {
      if (hex.id >= n.id) continue;
      if (hex.resource !== 'desert' && hex.resource === n.resource) {
        return { ok: false, reason: `same-resource adjacency ${hex.id}-${n.id}` };
      }
      if (
        !opts.allowRedAdjacency &&
        hex.number !== null &&
        n.number !== null &&
        RED_NUMBERS.has(hex.number) &&
        RED_NUMBERS.has(n.number)
      ) {
        return { ok: false, reason: `red-number adjacency ${hex.id}-${n.id}` };
      }
      if (
        opts.noSameNumberAdjacent &&
        hex.number !== null &&
        n.number !== null &&
        hex.number === n.number
      ) {
        return { ok: false, reason: `same-number adjacency ${hex.id}-${n.id} both ${hex.number}` };
      }
    }
  }

  // 3-high-yield-at-one-intersection rule: any triplet of mutually adjacent hexes
  // all carrying high-yield numbers.
  for (const hex of hexes) {
    if (hex.number === null || !HIGH_YIELD_NUMBERS.has(hex.number)) continue;
    const ns = hexNeighbors(hex, byKey).filter(
      n => n.number !== null && HIGH_YIELD_NUMBERS.has(n.number),
    );
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i];
        const b = ns[j];
        if (areHexAdjacent(a, b)) {
          if (hex.id < a.id && hex.id < b.id) {
            return { ok: false, reason: `triple high-yield intersection ${hex.id}/${a.id}/${b.id}` };
          }
        }
      }
    }
  }

  // Reject port arrangements that have MORE of a 2:1 type than the player-count
  // spec calls for. Most boards allow at most one of each specific 2:1, but the
  // 5-6 expansion's canonical layout has 2 sheep ports — so the cap is derived
  // from boardFor(playerCount).portTypes rather than hard-coded to 1.
  const expectedPortCounts = new Map<string, number>();
  // hex array length is the only way to infer playerCount here without changing
  // the signature: 19 → base, 30 → expansion.
  const inferred: PlayerCount = hexes.length <= 19 ? 4 : 5;
  for (const t of boardFor(inferred).portTypes) {
    expectedPortCounts.set(t, (expectedPortCounts.get(t) ?? 0) + 1);
  }
  const portCounts = new Map<string, number>();
  for (const p of ports) portCounts.set(p.type, (portCounts.get(p.type) ?? 0) + 1);
  for (const [type, n] of portCounts) {
    if (type === 'generic') continue;
    const cap = expectedPortCounts.get(type) ?? 1;
    if (n > cap) {
      return { ok: false, reason: `${type} port appears ${n}× (spec cap ${cap})` };
    }
  }

  // No two of the SAME NUMBER on the SAME RESOURCE type — e.g. forbid two 5s
  // on brick. Reduces the "one resource depends on one die roll" failure mode.
  if (opts.noSameNumberOnResource) {
    const seen = new Map<string, Set<number>>();
    for (const hex of hexes) {
      if (hex.resource === 'desert' || hex.number === null) continue;
      let nums = seen.get(hex.resource);
      if (!nums) { nums = new Set(); seen.set(hex.resource, nums); }
      if (nums.has(hex.number)) {
        return { ok: false, reason: `duplicate number ${hex.number} on ${hex.resource}` };
      }
      nums.add(hex.number);
    }
  }

  // Spread the red numbers (6/8) across resource types as evenly as possible.
  // Base game has 4 reds across 5 resources → max 1 red per resource. 5–6
  // expansion has 6 reds across 5 resources → at least one resource HAS to
  // carry 2, so the cap auto-relaxes to ceil(reds/resources).
  if (opts.noMultipleRedsOnResource) {
    const reds = new Map<string, number>();
    const resources = new Set<string>();
    let totalReds = 0;
    for (const hex of hexes) {
      if (hex.resource === 'desert' || hex.number === null) continue;
      resources.add(hex.resource);
      if (RED_NUMBERS.has(hex.number)) {
        reds.set(hex.resource, (reds.get(hex.resource) ?? 0) + 1);
        totalReds++;
      }
    }
    const cap = resources.size > 0 ? Math.ceil(totalReds / resources.size) : Infinity;
    for (const [resource, count] of reds) {
      if (count > cap) {
        return { ok: false, reason: `${resource} carries ${count} reds, cap is ${cap}` };
      }
    }
  }
  return { ok: true };
}

export function areHexAdjacent(a: Hex, b: Hex): boolean {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (
    (dq === 1 && dr === 0) ||
    (dq === -1 && dr === 0) ||
    (dq === 0 && dr === 1) ||
    (dq === 0 && dr === -1) ||
    (dq === 1 && dr === -1) ||
    (dq === -1 && dr === 1)
  );
}
