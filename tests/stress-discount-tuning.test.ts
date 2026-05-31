/** Snake-Draft Bias — Survival-Discount Slope Tuning
 *
 *  Production formula: `discount = max(0.4, 1 − K × 0.05)` where K =
 *  picksUntilR2. The discount span between P1 and P-last widens with
 *  player count, which correlates with growing P-last advantage:
 *
 *    pc=3: span 0.2 → advantage 0.95%
 *    pc=4: span 0.3 → advantage 1.67%   ← user-calibrated "real Catan"
 *    pc=5: span 0.4 → advantage 2.32%
 *    pc=6: span 0.5 → advantage 2.83%   ← "a bit hot"
 *
 *  Hypothesis: holding the discount span CONSTANT across player counts
 *  (e.g. always 0.3, matching pc=4 today) should keep pc=4 unchanged
 *  while compressing pc=6 toward the same range.
 *
 *  We re-implement the pair-evaluation simulator here with a configurable
 *  discount function and run it against the same generated maps, swapping
 *  only the discount strategy. Production code untouched.
 */
import { describe, it } from 'vitest';
import { generateMap } from '../src/generator/generate';
import { scoreMap } from '../src/generator/score';
import type {
  Hex,
  PlayerCount,
  ProducingResource,
  SpotScore,
  Variants,
} from '../src/game/types';

const RUN = process.env.RUN_DISCOUNT === '1';

function v(): Variants {
  return {
    includeDesert: true,
    desertReplacement: 'ore',
    shufflePorts: false,
    noSameNumberAdjacent: true,
    noSameNumberOnResource: true,
    noMultipleRedsOnResource: true,
    challenge: { flavor: 'none', targetResource: 'any' },
  };
}

interface DiscountStrategy {
  name: string;
  /** Returns the discount factor in [0,1] for the given pair-eval slot.
   *  K = picksUntilR2 = 2N − 2*step − 2 (so P-last has K=0, P1 has K=2N−2). */
  discount: (K: number, pc: number) => number;
}

const STRATEGIES: DiscountStrategy[] = [
  // A) production today
  { name: 'A: max(0.4, 1 − K·0.05)',  discount: (K) => Math.max(0.4, 1 - K * 0.05) },
  // D) steeper fixed slope, lower floor (best non-greedy from round 1)
  { name: 'D: max(0.3, 1 − K·0.07)',  discount: (K) => Math.max(0.3, 1 - K * 0.07) },
  // F) very aggressive: floor 0.2, steep slope
  { name: 'F: max(0.2, 1 − K·0.10)',  discount: (K) => Math.max(0.2, 1 - K * 0.10) },
  // G) even more aggressive: floor 0, very steep
  { name: 'G: max(0.0, 1 − K·0.12)',  discount: (K) => Math.max(0.0, 1 - K * 0.12) },
  // H) cap P-last to 0.85 (everyone less optimistic)
  { name: 'H: max(0.3, min(0.85, …))', discount: (K) => Math.max(0.3, Math.min(0.85, 1 - K * 0.07)) },
  // I) cap P-last to 0.75 + aggressive slope
  { name: 'I: max(0.2, min(0.75, …))', discount: (K) => Math.max(0.2, Math.min(0.75, 1 - K * 0.08)) },
  // GREEDY reference (no pair eval at all)
  { name: 'GREEDY (reference)',        discount: () => -1 /* sentinel */ },
];

// --- Simulator (parameterized; mirrors production pair-eval logic) --------

function firstPickValue(s: SpotScore): number {
  return s.total - s.roadPotentialBonus - s.startingHandBonus;
}

function uniqueAdj(inter: { hexIds: string[] }, hexById: Map<string, Hex>): Set<ProducingResource> {
  const out = new Set<ProducingResource>();
  for (const hexId of inter.hexIds) {
    const h = hexById.get(hexId);
    if (h && h.resource !== 'desert') out.add(h.resource as ProducingResource);
  }
  return out;
}

function simulateWithStrategy(
  spots: Map<string, SpotScore>,
  graph: ReturnType<typeof scoreMap>['graph'],
  hexById: Map<string, Hex>,
  pc: PlayerCount,
  strategy: DiscountStrategy,
): number[] {
  const order: number[] = [];
  for (let i = 0; i < pc; i++) order.push(i);
  for (let i = pc - 1; i >= 0; i--) order.push(i);

  const blocked = new Set<string>();
  const totals = new Array(pc).fill(0);
  const playerResources: Set<ProducingResource>[] = Array.from({ length: pc }, () => new Set());
  const intResources = new Map<string, Set<ProducingResource>>();
  for (const inter of graph.intersections.values()) intResources.set(inter.id, uniqueAdj(inter, hexById));

  const TOP_K_R1 = 12;
  const isGreedy = strategy.discount(0, pc) < 0;

  for (let step = 0; step < order.length; step++) {
    const playerIdx = order[step];
    const isSecond = step >= pc;
    const available = Array.from(spots.values()).filter(s => !blocked.has(s.intersectionId));
    if (available.length === 0) break;

    let chosen: SpotScore;
    let value: number;

    if (isGreedy) {
      // No pair eval, no diversification — just pick highest total.
      let best: SpotScore | null = null;
      let bestV = -Infinity;
      for (const s of available) {
        if (s.total > bestV) { bestV = s.total; best = s; }
      }
      chosen = best!;
      value = best!.total;
    } else if (isSecond) {
      // R2 picks: full total + diversification (same as production)
      const valueOf = (s: SpotScore) => {
        const adj = intResources.get(s.intersectionId) ?? new Set();
        let newRes = 0;
        for (const r of adj) if (!playerResources[playerIdx].has(r)) newRes++;
        return s.total + newRes * 0.5;
      };
      let bestV = -Infinity, bestSpot = available[0];
      for (const s of available) {
        const x = valueOf(s);
        if (x > bestV) { bestV = x; bestSpot = s; }
      }
      chosen = bestSpot;
      value = bestV;
    } else {
      // R1 pair-eval with configured discount
      const K = 2 * pc - 2 * step - 2;
      const planningDiscount = strategy.discount(K, pc);

      const topA = available.slice()
        .sort((a, b) => firstPickValue(b) - firstPickValue(a))
        .slice(0, TOP_K_R1);
      let bestA: SpotScore = topA[0] ?? available[0];
      let bestPair = -Infinity;
      for (const A of topA) {
        const interA = graph.intersections.get(A.intersectionId);
        if (!interA) continue;
        const aResSet = intResources.get(A.intersectionId) ?? new Set();
        const aNeighbors = new Set(interA.neighbors);
        let bestB = -Infinity;
        for (const B of available) {
          if (B.intersectionId === A.intersectionId) continue;
          if (aNeighbors.has(B.intersectionId)) continue;
          const bResSet = intResources.get(B.intersectionId) ?? new Set();
          let newRes = 0;
          for (const r of bResSet) if (!aResSet.has(r)) newRes++;
          const bVal = B.total + newRes * 0.5;
          if (bVal > bestB) bestB = bVal;
        }
        if (bestB === -Infinity) continue;
        const pair = firstPickValue(A) + bestB * planningDiscount;
        if (pair > bestPair) { bestPair = pair; bestA = A; }
      }
      chosen = bestA;
      value = firstPickValue(chosen);
    }

    totals[playerIdx] += value;
    blocked.add(chosen.intersectionId);
    const interC = graph.intersections.get(chosen.intersectionId)!;
    for (const nb of interC.neighbors) blocked.add(nb);
    for (const r of intResources.get(chosen.intersectionId) ?? new Set()) {
      playerResources[playerIdx].add(r);
    }
  }
  return totals;
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function stdev(xs: number[]) {
  if (!xs.length) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

describe('discount tuning', () => {
  it.runIf(RUN)('compare survival-discount strategies', () => {
    const N = Number(process.env.SAMPLES ?? 600);
    for (const pc of [3, 4, 5, 6] as PlayerCount[]) {
      console.log(`\n========================== pc=${pc} (n=${N}) ==========================`);

      // First: print the discount each strategy applies at each player slot.
      console.log('Discount values per slot (P1 to P-last):');
      for (const s of STRATEGIES) {
        const isGreedy = s.discount(0, pc) < 0;
        if (isGreedy) { console.log(`  ${s.name.padEnd(28)}  (no pair eval)`); continue; }
        const vals: string[] = [];
        for (let step = 0; step < pc; step++) {
          const K = 2 * pc - 2 * step - 2;
          vals.push(s.discount(K, pc).toFixed(2));
        }
        const span = (s.discount(0, pc) - s.discount(2 * pc - 2, pc)).toFixed(2);
        console.log(`  ${s.name.padEnd(28)}  ${vals.join(' → ')}   (span ${span})`);
      }

      // Now generate maps + run each strategy on same maps
      const t0 = Date.now();
      const perPlayerSums: Record<string, number[]> = {};
      for (const s of STRATEGIES) perPlayerSums[s.name] = new Array(pc).fill(0);
      const stdevs: Record<string, number[]> = {};
      for (const s of STRATEGIES) stdevs[s.name] = [];
      let succeeded = 0;
      for (let i = 0; i < N; i++) {
        try {
          const r = generateMap({ playerCount: pc, variants: v() });
          const scored = scoreMap(r.map.hexes, r.map.ports, pc);
          const hexById = new Map(r.map.hexes.map(h => [h.id, h] as const));
          for (const s of STRATEGIES) {
            const totals = simulateWithStrategy(scored.spots, scored.graph, hexById, pc, s);
            for (let j = 0; j < pc; j++) perPlayerSums[s.name][j] += totals[j];
            stdevs[s.name].push(stdev(totals));
          }
          succeeded++;
        } catch {}
      }
      console.log(`\n  ${succeeded} maps in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

      console.log('Strategy                       per-player means (centered on mode mean)            P-last − P1   stdev mean');
      for (const s of STRATEGIES) {
        const means = perPlayerSums[s.name].map(x => x / succeeded);
        const overall = means.reduce((a, b) => a + b, 0) / pc;
        const devs = means.map(m => ((m - overall) / overall * 100));
        const pLast = (means[pc - 1] - means[0]) / means[0] * 100;
        const devStr = devs.map((d, i) => `P${i + 1}:${(d >= 0 ? '+' : '') + d.toFixed(2)}%`).join('  ');
        const sd = mean(stdevs[s.name]);
        console.log(`  ${s.name.padEnd(28)}  ${devStr}   ${pLast.toFixed(2).padStart(6)}%      ${sd.toFixed(3)}`);
      }
    }
  }, 30 * 60 * 1000);
});
