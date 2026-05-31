/** Strategy F Validation
 *
 *  Compares production strategy A vs proposed F + sensitivity variants
 *  on the SAME map seed set across all strategies (so map-variance is
 *  controlled and only the discount formula varies).
 *
 *  Strategies:
 *    A   : production    max(0.4, 1 − K · 0.05)      [baseline]
 *    F   : proposed       max(0.2, 1 − K · 0.10)
 *    F'  : sensitivity    max(0.25, 1 − K · 0.10)    [floor +0.05]
 *    F'' : sensitivity    max(0.2,  1 − K · 0.08)    [slope −0.02]
 *    F'''_: sensitivity   max(0.2,  1 − K · 0.12)    [slope +0.02]
 *    GREEDY: reference    no pair eval
 *
 *  Metrics tracked per strategy per pc:
 *    - P-last advantage  (P_last mean − P1 mean) / P1 mean × 100
 *    - P1 mean outcome
 *    - P1 5th-percentile (tail risk)
 *    - mean of bottom-5% P1 outcomes (worst-case severity)
 *    - per-map fairness stdev
 *    - A-selection distribution:
 *        "standalone" = A picked equals the highest-firstPickValue available
 *        "pair-shifted" = A differs from standalone-optimal
 *        + average firstPickValue gap when shifted
 *      reported per player position
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

const RUN = process.env.RUN_F_VAL === '1';

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
  discount: (K: number, pc: number) => number;
}

const STRATEGIES: DiscountStrategy[] = [
  { name: 'A:   max(0.40, 1 − K·0.05) [PROD]',  discount: (K) => Math.max(0.40, 1 - K * 0.05) },
  { name: 'F:   max(0.20, 1 − K·0.10) [PROP]',  discount: (K) => Math.max(0.20, 1 - K * 0.10) },
  { name: "F':  max(0.25, 1 − K·0.10) [s−floor]", discount: (K) => Math.max(0.25, 1 - K * 0.10) },
  { name: "F'': max(0.20, 1 − K·0.08) [s−slow]",  discount: (K) => Math.max(0.20, 1 - K * 0.08) },
  { name: "F''': max(0.20, 1 − K·0.12) [s−fast]", discount: (K) => Math.max(0.20, 1 - K * 0.12) },
  { name: 'GREEDY (no pair eval)',               discount: () => -1 },
];

// --- Simulator (parameterized; matches production pair-eval) -------------

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

interface SimResult {
  totals: number[];
  fairnessStdev: number;
  /** For each R1 pick (one per player), record whether the chosen A
   *  matched the standalone-optimal A. If shifted, record the firstPickValue
   *  gap (standaloneTop − chosenFPV) — how much standalone value was traded
   *  for pair value. */
  r1ShiftByPlayer: Array<{ shifted: boolean; gap: number }>;
}

function simulateWithStrategy(
  spots: Map<string, SpotScore>,
  graph: ReturnType<typeof scoreMap>['graph'],
  hexById: Map<string, Hex>,
  pc: PlayerCount,
  strategy: DiscountStrategy,
): SimResult {
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
  const r1ShiftByPlayer: SimResult['r1ShiftByPlayer'] = new Array(pc).fill(null).map(() => ({ shifted: false, gap: 0 }));

  for (let step = 0; step < order.length; step++) {
    const playerIdx = order[step];
    const isSecond = step >= pc;
    const available = Array.from(spots.values()).filter(s => !blocked.has(s.intersectionId));
    if (available.length === 0) break;

    let chosen: SpotScore;
    let value: number;

    if (isGreedy) {
      let best: SpotScore | null = null;
      let bestV = -Infinity;
      for (const s of available) if (s.total > bestV) { bestV = s.total; best = s; }
      chosen = best!;
      value = best!.total;
    } else if (isSecond) {
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
      // R1 pair eval
      const K = 2 * pc - 2 * step - 2;
      const planningDiscount = strategy.discount(K, pc);

      const topA = available.slice()
        .sort((a, b) => firstPickValue(b) - firstPickValue(a))
        .slice(0, TOP_K_R1);
      const standaloneTop = topA[0]; // highest firstPickValue
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

      // Record whether choice was standalone-optimal or pair-shifted
      if (standaloneTop && chosen.intersectionId !== standaloneTop.intersectionId) {
        r1ShiftByPlayer[playerIdx] = {
          shifted: true,
          gap: firstPickValue(standaloneTop) - firstPickValue(chosen),
        };
      }
    }

    totals[playerIdx] += value;
    blocked.add(chosen.intersectionId);
    const interC = graph.intersections.get(chosen.intersectionId)!;
    for (const nb of interC.neighbors) blocked.add(nb);
    for (const r of intResources.get(chosen.intersectionId) ?? new Set()) {
      playerResources[playerIdx].add(r);
    }
  }

  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;

  return {
    totals,
    fairnessStdev: Math.sqrt(variance),
    r1ShiftByPlayer,
  };
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] * (hi - pos) + s[hi] * (pos - lo);
}

describe('strategy F validation', () => {
  it.runIf(RUN)('A vs F + sensitivity, controlled map seeds', () => {
    const N = Number(process.env.SAMPLES ?? 600);

    for (const pc of [3, 4, 5, 6] as PlayerCount[]) {
      console.log(`\n======================== pc=${pc} (n=${N}) ========================`);

      // Per-strategy aggregates
      const perPlayerSum: Record<string, number[]> = {};
      const p1Outcomes: Record<string, number[]> = {};
      const stdevs: Record<string, number[]> = {};
      const shiftedFracPerPlayer: Record<string, number[]> = {}; // per-strategy → per-player array (sum-of-shifted)
      const shiftGapPerPlayer: Record<string, number[]> = {}; // per-strategy → per-player array (sum-of-gap-when-shifted)
      const shiftCountPerPlayer: Record<string, number[]> = {}; // per-strategy → per-player array (count-shifted, for averaging gap)
      for (const s of STRATEGIES) {
        perPlayerSum[s.name] = new Array(pc).fill(0);
        p1Outcomes[s.name] = [];
        stdevs[s.name] = [];
        shiftedFracPerPlayer[s.name] = new Array(pc).fill(0);
        shiftGapPerPlayer[s.name] = new Array(pc).fill(0);
        shiftCountPerPlayer[s.name] = new Array(pc).fill(0);
      }

      const t0 = Date.now();
      let succeeded = 0;
      for (let i = 0; i < N; i++) {
        let map;
        try {
          map = generateMap({ playerCount: pc, variants: v() }).map;
        } catch { continue; }
        const scored = scoreMap(map.hexes, map.ports, pc);
        const hexById = new Map(map.hexes.map(h => [h.id, h] as const));

        // Run every strategy against THIS same map
        for (const s of STRATEGIES) {
          const r = simulateWithStrategy(scored.spots, scored.graph, hexById, pc, s);
          for (let j = 0; j < pc; j++) perPlayerSum[s.name][j] += r.totals[j];
          p1Outcomes[s.name].push(r.totals[0]);
          stdevs[s.name].push(r.fairnessStdev);
          for (let j = 0; j < pc; j++) {
            if (r.r1ShiftByPlayer[j].shifted) {
              shiftedFracPerPlayer[s.name][j] += 1;
              shiftGapPerPlayer[s.name][j] += r.r1ShiftByPlayer[j].gap;
              shiftCountPerPlayer[s.name][j] += 1;
            }
          }
        }
        succeeded++;
      }
      console.log(`  ${succeeded} maps × ${STRATEGIES.length} sims = ${succeeded * STRATEGIES.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

      // ----------------- 1) P-last advantage table -----------------
      console.log('--- P-last advantage (P_last mean − P1 mean) / P1 mean × 100 ---');
      console.log('Strategy                              P1 mean    P_last mean   P-last adv   Δ vs A');
      const aP1 = perPlayerSum['A:   max(0.40, 1 − K·0.05) [PROD]'][0] / succeeded;
      const aPL = perPlayerSum['A:   max(0.40, 1 − K·0.05) [PROD]'][pc - 1] / succeeded;
      const aAdv = (aPL - aP1) / aP1 * 100;
      for (const s of STRATEGIES) {
        const p1m = perPlayerSum[s.name][0] / succeeded;
        const plm = perPlayerSum[s.name][pc - 1] / succeeded;
        const adv = (plm - p1m) / p1m * 100;
        const delta = adv - aAdv;
        const dStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}pp`;
        console.log(`  ${s.name.padEnd(38)} ${p1m.toFixed(3).padStart(7)}   ${plm.toFixed(3).padStart(7)}        ${adv.toFixed(2).padStart(5)}%      ${dStr.padStart(7)}`);
      }

      // ----------------- 2) P1 mean outcome -----------------
      console.log('\n--- P1 mean outcome (higher = better for P1) ---');
      console.log('Strategy                              P1 mean   Δ vs A');
      for (const s of STRATEGIES) {
        const p1m = perPlayerSum[s.name][0] / succeeded;
        const delta = p1m - aP1;
        const dStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`;
        console.log(`  ${s.name.padEnd(38)} ${p1m.toFixed(3).padStart(7)}    ${dStr.padStart(7)}`);
      }

      // ----------------- 3) P1 tail risk -----------------
      console.log('\n--- P1 tail risk: worst 5% of P1 outcomes ---');
      console.log('Strategy                              p5         mean-of-bottom-5%  Δ vs A (p5)');
      const aP5 = quantile(p1Outcomes['A:   max(0.40, 1 − K·0.05) [PROD]'], 0.05);
      for (const s of STRATEGIES) {
        const sorted = [...p1Outcomes[s.name]].sort((a, b) => a - b);
        const p5 = quantile(sorted, 0.05);
        const bottom5pct = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)));
        const bottomMean = mean(bottom5pct);
        const delta = p5 - aP5;
        const dStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`;
        console.log(`  ${s.name.padEnd(38)} ${p5.toFixed(3).padStart(7)}    ${bottomMean.toFixed(3).padStart(7)}            ${dStr.padStart(7)}`);
      }

      // ----------------- 4) Fairness stdev (per-map mean) -----------------
      console.log('\n--- Fairness: mean per-map stdev of player totals ---');
      console.log('Strategy                              stdev mean   Δ vs A');
      const aSd = mean(stdevs['A:   max(0.40, 1 − K·0.05) [PROD]']);
      for (const s of STRATEGIES) {
        const sd = mean(stdevs[s.name]);
        const delta = sd - aSd;
        const dStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(4)}`;
        console.log(`  ${s.name.padEnd(38)} ${sd.toFixed(4).padStart(8)}   ${dStr.padStart(8)}`);
      }

      // ----------------- 5) A-selection distribution -----------------
      console.log('\n--- A-selection: fraction of R1 picks that DIFFER from standalone-optimal A ---');
      console.log('Strategy                              by player position (P1 → P_last)        avg pair-shift gap');
      for (const s of STRATEGIES) {
        const fracs: string[] = [];
        let totalShifted = 0;
        let totalGap = 0;
        for (let j = 0; j < pc; j++) {
          const fr = shiftedFracPerPlayer[s.name][j] / succeeded * 100;
          fracs.push(`P${j + 1}:${fr.toFixed(0)}%`);
          totalShifted += shiftCountPerPlayer[s.name][j];
          totalGap += shiftGapPerPlayer[s.name][j];
        }
        const avgGap = totalShifted > 0 ? totalGap / totalShifted : 0;
        console.log(`  ${s.name.padEnd(38)} ${fracs.join('  ').padEnd(40)}    ${avgGap.toFixed(3)}`);
      }
    }
  }, 60 * 60 * 1000);
});
