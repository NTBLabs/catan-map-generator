import { boardFor, HIGH_YIELD_NUMBERS, RED_NUMBERS } from '../game/constants';
import { buildEmptyLayout, buildHexIndex, hexNeighbors } from '../game/layout';
import type { Hex, PlayerCount, Port, PortType, Resource, Variants, WealthGapTarget } from '../game/types';
import { shuffle } from './random';

export interface RandomizedMap {
  hexes: Hex[];
  ports: Port[];
}

function adjustForVariants(playerCount: PlayerCount, variants: Variants) {
  const spec = boardFor(playerCount);
  const resourceCounts: Record<Resource, number> = { ...spec.resourceCounts };
  const numberCounts: Record<number, number> = { ...spec.numberCounts };

  // 5-6 expansion always uses 2 deserts per the rules — ignore an attempt
  // to turn it off (the UI also disables that toggle, but be defensive).
  const includeDesert = playerCount > 4 ? true : variants.includeDesert;

  if (!includeDesert) {
    const replacement = variants.desertReplacement;
    const desertCount = resourceCounts.desert ?? 0;
    resourceCounts.desert = 0;
    resourceCounts[replacement] = (resourceCounts[replacement] ?? 0) + desertCount;
    for (let i = 0; i < desertCount; i++) {
      const mid = [4, 10, 5, 9, 3, 11][i % 6];
      numberCounts[mid] = (numberCounts[mid] ?? 0) + 1;
    }
  }
  return { resourceCounts, numberCounts };
}

function placeResources(
  hexes: Hex[],
  bag: Resource[],
  rng: () => number,
  strict: boolean,
  wealthGapTarget?: WealthGapTarget,
): boolean {
  const MAX_DESERTS_ON_RICH = 1;
  const order = shuffle(hexes.map((_, i) => i), rng);
  const remaining: Resource[] = bag.slice();
  let desertsOnRich = 0;
  for (const idx of order) {
    const hex = hexes[idx];
    const byKey = buildHexIndex(hexes);
    const neighborResources = new Set(
      hexNeighbors(hex, byKey).map(n => n.resource).filter(r => r !== 'desert'),
    );
    const candidatesIdx: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      if (r === 'desert' || !neighborResources.has(r)) candidatesIdx.push(i);
    }
    if (candidatesIdx.length === 0) {
      if (!strict) {
        // Fallback to any remaining tile
        candidatesIdx.push(...remaining.map((_, i) => i));
      } else {
        return false;
      }
    }
    // wealthGap targeting: keep deserts off the rich side.
    //   - Soft rule (desertsOnRich < MAX): filter out desert IF non-desert
    //     options exist. Random fall-through allowed.
    //   - Hard rule (desertsOnRich >= MAX): strictly forbid desert on rich.
    //     If no non-desert options exist, fail the placement so the main
    //     loop retries with a fresh order.
    let pool = candidatesIdx;
    const onRich = wealthGapTarget && wealthGapSide(hex, wealthGapTarget) === 'rich';
    if (onRich) {
      const nonDesert = pool.filter(i => remaining[i] !== 'desert');
      const atCap = desertsOnRich >= MAX_DESERTS_ON_RICH;
      if (nonDesert.length > 0) {
        pool = nonDesert;
      } else if (atCap) {
        // Already at the rich-side desert quota and no other option — bail.
        return false;
      }
      // else: under cap, no non-desert options → fall through to allow desert.
    }
    const chosenPos = pool[Math.floor(rng() * pool.length)];
    const chosenRes = remaining[chosenPos];
    if (onRich && chosenRes === 'desert') desertsOnRich++;
    hex.resource = chosenRes;
    remaining.splice(chosenPos, 1);
  }
  return true;
}

/** High-yield placement strategies:
 *  - 'off':     no preference, placement is uniform over candidates
 *  - 'byCount': equalize COUNT of high-yields per resource (current default).
 *               Side effect: 3-tile resources get higher PER-TILE high-yield
 *               rate because the same count divides into fewer tiles. This
 *               creates a ~5% per-tile pip advantage for brick/ore.
 *  - 'byRate':  equalize RATE of high-yields per tile across resources.
 *               Picks the resource with the lowest (hyCount / totalTiles)
 *               ratio. Removes the 3-tile per-tile bias. */
export type SpreadHighYieldMode = 'off' | 'byCount' | 'byRate';

interface PlaceNumbersOpts {
  spreadHighYield: SpreadHighYieldMode;
  noSameNumberAdjacent: boolean;
  noSameNumberOnResource: boolean;
  noMultipleRedsOnResource: boolean;
  /** Relax the "no red adjacency" placement rule. Used only by the hotZone
   *  challenge flavor — the whole point is reds clustering. */
  allowRedAdjacency?: boolean;
  /** wealthGap target axis + side. When set, placement biases high-pip
   *  numbers (4/5/6/8/9/10) toward the rich side and low-pip numbers
   *  (2/3/11/12) toward the dividing line, falling back to sparse side.
   *  Low-pip never lands on rich side except as last resort. */
  wealthGapTarget?: WealthGapTarget;
}

const HIGH_PIP_NUMBERS = new Set([4, 5, 6, 8, 9, 10]);

function wealthGapAxisCoord(hex: Hex, axis: 'q' | 'r' | 's'): number {
  if (axis === 'q') return hex.q;
  if (axis === 'r') return hex.r;
  return -hex.q - hex.r;
}

/** Returns the 'rich' / 'div' / 'sparse' side of a hex relative to the
 *  wealthGap target. 'div' = on the dividing line (axis coord == 0). */
function wealthGapSide(hex: Hex, target: WealthGapTarget): 'rich' | 'div' | 'sparse' {
  const c = wealthGapAxisCoord(hex, target.axis);
  if (c === 0) return 'div';
  const sign: 1 | -1 = c > 0 ? 1 : -1;
  return sign === target.richSide ? 'rich' : 'sparse';
}

/** Filters candidate slots by wealthGap preference. High-pip numbers prefer
 *  the rich side (then div, then sparse). Low-pip numbers prefer the div
 *  (dividing line) first, then sparse, NEVER rich unless no other option. */
function wealthGapPreferred(candidates: Hex[], num: number, target: WealthGapTarget): Hex[] {
  if (HIGH_PIP_NUMBERS.has(num)) {
    const rich = candidates.filter(s => wealthGapSide(s, target) === 'rich');
    if (rich.length > 0) return rich;
    const div = candidates.filter(s => wealthGapSide(s, target) === 'div');
    if (div.length > 0) return div;
    return candidates;
  } else {
    const div = candidates.filter(s => wealthGapSide(s, target) === 'div');
    if (div.length > 0) return div;
    const sparse = candidates.filter(s => wealthGapSide(s, target) === 'sparse');
    if (sparse.length > 0) return sparse;
    return candidates; // forced fallback — predicate will reject, attempt loop retries
  }
}

function placeNumbers(
  hexes: Hex[],
  bag: number[],
  rng: () => number,
  opts: PlaceNumbersOpts,
): boolean {
  const slots = hexes.filter(h => h.resource !== 'desert');
  for (const h of slots) h.number = null;

  // Two-phase placement:
  //   1. High-yield numbers (5, 6, 8, 9) — when spreading, push them onto the
  //      resource with the fewest existing high-yields. Reds first since they
  //      have the tightest neighbor constraint.
  //   2. Remaining numbers — fill the rest with a light "don't duplicate the
  //      same number on the same resource" preference.
  const highYieldNumbers = bag.filter(n => HIGH_YIELD_NUMBERS.has(n));
  const lowYieldNumbers = bag.filter(n => !HIGH_YIELD_NUMBERS.has(n));
  highYieldNumbers.sort((a, b) => Number(RED_NUMBERS.has(b)) - Number(RED_NUMBERS.has(a)));

  const byKey = buildHexIndex(hexes);

  // Total reds in the bag — used by the noMultipleReds cap below. With base
  // counts (2×6 + 2×8 = 4 reds, 5 producing resources) the cap is 1; with the
  // expansion (3×6 + 3×8 = 6 reds, 5 resources) the cap is 2.
  const totalReds = highYieldNumbers.filter(n => RED_NUMBERS.has(n)).length;
  const producingResources = new Set<string>();
  for (const s of slots) producingResources.add(s.resource);
  const redCap = producingResources.size > 0 ? Math.ceil(totalReds / producingResources.size) : Infinity;

  for (const num of highYieldNumbers) {
    const isRed = RED_NUMBERS.has(num);
    const hyCount = new Map<string, number>();
    const redCountByResource = new Map<string, number>();
    const resourcesAlreadyWithNum = new Set<string>();
    for (const s of slots) {
      if (s.number === null) continue;
      if (HIGH_YIELD_NUMBERS.has(s.number)) {
        hyCount.set(s.resource, (hyCount.get(s.resource) ?? 0) + 1);
      }
      if (RED_NUMBERS.has(s.number)) {
        redCountByResource.set(s.resource, (redCountByResource.get(s.resource) ?? 0) + 1);
      }
      if (s.number === num) resourcesAlreadyWithNum.add(s.resource);
    }

    const candidates = slots.filter(s => {
      if (s.number !== null) return false;
      const ns = hexNeighbors(s, byKey);
      if (!opts.allowRedAdjacency && isRed && ns.some(n => n.number !== null && RED_NUMBERS.has(n.number))) return false;
      if (violatesTripleHighYield(s, hexes)) return false;
      if (opts.noSameNumberAdjacent && ns.some(n => n.number === num)) return false;
      if (opts.noSameNumberOnResource && resourcesAlreadyWithNum.has(s.resource)) return false;
      if (opts.noMultipleRedsOnResource && isRed && (redCountByResource.get(s.resource) ?? 0) >= redCap) return false;
      return true;
    });
    if (candidates.length === 0) return false;

    let pool = candidates;
    if (opts.spreadHighYield !== 'off') {
      // Count or rate? byCount equalizes total high-yield placements per
      // resource; byRate equalizes per-tile rate so 3-tile resources don't
      // accumulate higher-density high-yields than 4-tile resources.
      const tileCount = new Map<string, number>();
      for (const s of slots) tileCount.set(s.resource, (tileCount.get(s.resource) ?? 0) + 1);
      const metric = (resource: string): number => {
        const c = hyCount.get(resource) ?? 0;
        if (opts.spreadHighYield === 'byRate') {
          const t = tileCount.get(resource) ?? 1;
          return c / t;
        }
        return c;
      };
      let minMetric = Infinity;
      for (const c of candidates) {
        const m = metric(c.resource);
        if (m < minMetric) minMetric = m;
      }
      const preferred = candidates.filter(c => metric(c.resource) === minMetric);
      if (preferred.length > 0) pool = preferred;
    }
    // Soft preference (always on): don't place this number on a resource that
    // already has it. Falls back to the broader pool when impossible.
    const uniqueOnResource = pool.filter(c => !resourcesAlreadyWithNum.has(c.resource));
    if (uniqueOnResource.length > 0) pool = uniqueOnResource;

    // wealthGap targeting: high-yield numbers (all >= 4 pips) belong on the
    // rich side. Falls through to the broader pool if no rich-side slot is
    // available — predicate rejection then triggers a retry.
    if (opts.wealthGapTarget) {
      const preferred = wealthGapPreferred(pool, num, opts.wealthGapTarget);
      if (preferred.length > 0) pool = preferred;
    }

    const chosen = pool[Math.floor(rng() * pool.length)];
    chosen.number = num;
  }

  const shuffledRest = shuffle(lowYieldNumbers, rng);
  const remainingSlots = shuffle(slots.filter(s => s.number === null), rng);
  for (const num of shuffledRest) {
    const sameNumOnResource = new Set<string>();
    for (const s of slots) {
      if (s.number === num) sameNumOnResource.add(s.resource);
    }
    const validSoft = (s: Hex): boolean => {
      if (s.number !== null) return false;
      if (opts.noSameNumberAdjacent && hexNeighbors(s, byKey).some(n => n.number === num)) return false;
      return true;
    };
    const validStrict = (s: Hex): boolean => {
      if (!validSoft(s)) return false;
      if (opts.noSameNumberOnResource && sameNumOnResource.has(s.resource)) return false;
      return true;
    };
    // wealthGap targeting: walk preferred side first, then fall through.
    // Low-pip numbers (2/3/11/12) prefer dividing line, then sparse side,
    // and only land on rich as a true last resort (which the strict
    // findWealthGapAxis predicate will then reject, triggering a retry).
    const preferredOrder = opts.wealthGapTarget
      ? wealthGapPreferred(remainingSlots, num, opts.wealthGapTarget)
      : remainingSlots;
    let target = preferredOrder.find(s => validStrict(s) && !sameNumOnResource.has(s.resource));
    if (!target) target = preferredOrder.find(validStrict);
    if (!target && opts.wealthGapTarget) {
      // Fall back to ALL remaining slots if preferred side has no valid candidate.
      target = remainingSlots.find(s => validStrict(s) && !sameNumOnResource.has(s.resource));
      if (!target) target = remainingSlots.find(validStrict);
    }
    if (!target && !opts.noSameNumberOnResource) target = remainingSlots.find(validSoft);
    if (!target) return false;
    target.number = num;
  }
  return true;
}

function violatesTripleHighYield(target: Hex, hexes: Hex[]): boolean {
  const byKey = buildHexIndex(hexes);
  const nbs = hexNeighbors(target, byKey);
  const highNbs = nbs.filter(n => n.number !== null && HIGH_YIELD_NUMBERS.has(n.number));
  for (let i = 0; i < highNbs.length; i++) {
    for (let j = i + 1; j < highNbs.length; j++) {
      const a = highNbs[i];
      const b = highNbs[j];
      const dq = a.q - b.q;
      const dr = a.r - b.r;
      const adj =
        (dq === 1 && dr === 0) || (dq === -1 && dr === 0) ||
        (dq === 0 && dr === 1) || (dq === 0 && dr === -1) ||
        (dq === 1 && dr === -1) || (dq === -1 && dr === 1);
      if (adj) return true;
    }
  }
  return false;
}

function countsMatchBag(hexes: Hex[], expected: Record<Resource, number>): boolean {
  const actual: Partial<Record<Resource, number>> = {};
  for (const h of hexes) actual[h.resource] = (actual[h.resource] ?? 0) + 1;
  for (const [res, n] of Object.entries(expected) as Array<[Resource, number]>) {
    if ((actual[res] ?? 0) !== n) return false;
  }
  return true;
}

function placePorts(
  slots: Array<{ hexId: string; side: 0 | 1 | 2 | 3 | 4 | 5 }>,
  portBag: PortType[],
  rng: () => number,
  shufflePorts: boolean,
): Port[] {
  const bag = shufflePorts ? shuffle(portBag, rng) : portBag.slice();
  return slots.slice(0, bag.length).map((slot, i) => ({
    hexId: slot.hexId,
    side: slot.side,
    type: bag[i],
  }));
}

export function randomizeMap(
  playerCount: PlayerCount,
  variants: Variants,
  rng: () => number,
  spreadMode?: SpreadHighYieldMode,
  wealthGapTarget?: WealthGapTarget,
): RandomizedMap {
  const { resourceCounts, numberCounts } = adjustForVariants(playerCount, variants);
  const layout = buildEmptyLayout(playerCount);
  const hexes: Hex[] = layout.hexes.map(h => ({ ...h }));

  const resourceBag = (Object.entries(resourceCounts) as Array<[Resource, number]>)
    .flatMap(([res, n]) => Array.from({ length: n }, () => res));
  const numberBag = (Object.entries(numberCounts) as Array<[string, number]>)
    .flatMap(([num, n]) => Array.from({ length: n }, () => Number(num)));

  // Try strict resource placement first; if it fails all 8 attempts we must
  // do a non-strict placement so the hex array isn't left in a half-placed
  // state (which previously leaked extra desert hexes into the output).
  let placedStrictly = false;
  for (let strictTry = 0; strictTry < 8; strictTry++) {
    for (const h of hexes) h.resource = 'desert';
    if (placeResources(hexes, resourceBag, rng, true, wealthGapTarget)) {
      placedStrictly = true;
      break;
    }
  }
  if (!placedStrictly) {
    for (const h of hexes) h.resource = 'desert';
    placeResources(hexes, resourceBag, rng, false, wealthGapTarget);
  }

  // Defensive sanity check: the resource counts on the board MUST match the
  // bag. If they don't, force a non-strict placement (which always finishes).
  if (!countsMatchBag(hexes, resourceCounts)) {
    for (const h of hexes) h.resource = 'desert';
    placeResources(hexes, resourceBag, rng, false, wealthGapTarget);
  }

  // High-yield spread strategy per scenario:
  // - Balanced (none): default 'byCount' (or experimental override)
  // - Rich vs Poor / Hot Zone: 'byRate' — equalize per-tile high-yield rate,
  //   which inherently biases reds/9s/5s onto the 3-tile resources (brick,
  //   ore) so they're not proportionally starved. Hot Zone's cluster
  //   concentrates pip mass on whatever resources sit at the cluster
  //   coordinates; without spread, the non-cluster 3-tile resources end up
  //   with no reds AND no high non-reds, failing the per-tile pip floor.
  // - Scarcity / Boom-or-bust / Drought: 'off' — their identity REQUIRES
  //   the freedom to starve/concentrate resources arbitrarily.
  const spreadForScenario =
    variants.challenge.flavor === 'none' ? (spreadMode ?? 'byCount') :
    variants.challenge.flavor === 'wealthGap' || variants.challenge.flavor === 'hotZone' ? 'byRate' :
    'off';
  placeNumbers(hexes, numberBag, rng, {
    spreadHighYield: spreadForScenario,
    noSameNumberAdjacent: variants.noSameNumberAdjacent,
    noSameNumberOnResource: variants.noSameNumberOnResource,
    noMultipleRedsOnResource: variants.noMultipleRedsOnResource,
    // Both 'hotZone' and 'random' may eventually require a hot-zone match
     // (random rolls hotZone with 1/5 odds), so placement loosens for both.
    allowRedAdjacency: variants.challenge.flavor === 'hotZone' || variants.challenge.flavor === 'random',
    wealthGapTarget,
  });

  const ports = placePorts(layout.perimeterPortSlots, boardFor(playerCount).portTypes, rng, variants.shufflePorts);
  return { hexes, ports };
}
