/** cityPotentialBonus weight sweep — re-score impact test.
 *
 *  Asymmetry to correct: roadPotentialBonus (+0.8) rewards brick+wood
 *  adjacency. ore+wheat adjacency gets no equivalent bonus.
 *
 *  Test plan:
 *    1) Generate N baseline maps under defaults
 *    2) For each spot, compute rescored total under W ∈ {0, 0.4, 0.6, 0.8}:
 *         rescored.total = baseline.total + (W if ore+wheat adj)
 *    3) Re-rank, measure top-1 / top-20 composition shifts
 *    4) Select smallest W that materially raises ore+wheat top-1 rate
 *       without flipping brick+wood out of dominance or creating a new
 *       dominant single-pair pattern.
 *
 *  Same map distribution under all four weights, so the only thing moving
 *  is the ranking — a clean isolation of weight effect.
 */
import { describe, it, expect } from 'vitest';
import { generateMap } from '../src/generator/generate';
import { scoreMap } from '../src/generator/score';
import type { PlayerCount, Variants, SpotScore, Archetype } from '../src/game/types';

const RUN = process.env.RUN_CITY_SWEEP === '1';
const WEIGHTS = [0, 0.4, 0.6, 0.8];

function baseVariants(): Variants {
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

interface RescoredSpot {
  spot: SpotScore;
  adj: Set<string>;
  total: number;
}

interface WeightStats {
  weight: number;
  // Top-1 metrics (per map)
  top1OreWheat: number;
  top1BrickWood: number;
  top1BrickOre: number;
  top1OreSheep: number;
  top1ArchetypeCounts: Map<Archetype, number>;
  // Top-20 metrics (per map × 20 slots)
  top20OreWheat: number;
  top20BrickWood: number;
  top20BrickOre: number;
  top20ArchetypeCounts: Map<Archetype, number>;
  // Map-level: did the apex change vs baseline?
  apexChangedFromBaseline: number;
}

function makeStats(weight: number): WeightStats {
  return {
    weight,
    top1OreWheat: 0,
    top1BrickWood: 0,
    top1BrickOre: 0,
    top1OreSheep: 0,
    top1ArchetypeCounts: new Map(),
    top20OreWheat: 0,
    top20BrickWood: 0,
    top20BrickOre: 0,
    top20ArchetypeCounts: new Map(),
    apexChangedFromBaseline: 0,
  };
}

function bump(m: Map<Archetype, number>, k: Archetype) {
  m.set(k, (m.get(k) ?? 0) + 1);
}

describe('city bonus weight sweep', () => {
  it.runIf(RUN)('quantifies top-spot composition shift across weights', () => {
    const N = Number(process.env.SAMPLES ?? 500);

    for (const pc of [4, 6] as PlayerCount[]) {
      console.log(`\n=========================== pc=${pc} (n=${N}) ===========================`);

      const statsByWeight: WeightStats[] = WEIGHTS.map(makeStats);
      let succeeded = 0;

      for (let i = 0; i < N; i++) {
        let result;
        try {
          result = generateMap({ playerCount: pc, variants: baseVariants() });
        } catch { continue; }
        succeeded++;
        const scored = scoreMap(result.map.hexes, result.map.ports, pc);
        const hexById = new Map(result.map.hexes.map(h => [h.id, h] as const));

        // Precompute adjacency set for each spot once.
        const allSpots: RescoredSpot[] = [];
        for (const spot of scored.spots.values()) {
          const inter = scored.graph.intersections.get(spot.intersectionId)!;
          const adj = new Set<string>();
          for (const hexId of inter.hexIds) {
            const h = hexById.get(hexId);
            if (h && h.resource !== 'desert') adj.add(h.resource);
          }
          allSpots.push({ spot, adj, total: spot.total });
        }

        // Baseline (W=0) apex for change-detection
        const baselineSorted = [...allSpots].sort((a, b) => b.total - a.total);
        const baselineApex = baselineSorted[0].spot.intersectionId;

        for (let wi = 0; wi < WEIGHTS.length; wi++) {
          const W = WEIGHTS[wi];
          const stats = statsByWeight[wi];

          // Rescore: add W if ore+wheat adjacent.
          const rescored: RescoredSpot[] = allSpots.map(r => ({
            spot: r.spot,
            adj: r.adj,
            total: r.spot.total + (r.adj.has('ore') && r.adj.has('wheat') ? W : 0),
          }));
          rescored.sort((a, b) => b.total - a.total);

          // Top-1
          const apex = rescored[0];
          if (apex.spot.intersectionId !== baselineApex) stats.apexChangedFromBaseline++;
          if (apex.adj.has('ore') && apex.adj.has('wheat')) stats.top1OreWheat++;
          if (apex.adj.has('brick') && apex.adj.has('wood')) stats.top1BrickWood++;
          if (apex.adj.has('brick') && apex.adj.has('ore')) stats.top1BrickOre++;
          if (apex.adj.has('ore') && apex.adj.has('sheep')) stats.top1OreSheep++;
          bump(stats.top1ArchetypeCounts, apex.spot.archetype);

          // Top-20
          for (let r = 0; r < Math.min(20, rescored.length); r++) {
            const s = rescored[r];
            if (s.adj.has('ore') && s.adj.has('wheat')) stats.top20OreWheat++;
            if (s.adj.has('brick') && s.adj.has('wood')) stats.top20BrickWood++;
            if (s.adj.has('brick') && s.adj.has('ore')) stats.top20BrickOre++;
            bump(stats.top20ArchetypeCounts, s.spot.archetype);
          }
        }
      }

      console.log(`  (${succeeded} maps)`);
      console.log(`  Top-1 resource-pair rates (% of maps):`);
      console.log(`    weight | ore+wheat | brick+wood | brick+ore | ore+sheep | apex-change-vs-baseline`);
      for (const s of statsByWeight) {
        const pct = (x: number) => ((x / succeeded) * 100).toFixed(1).padStart(5);
        console.log(`    +${s.weight.toFixed(1)}   |  ${pct(s.top1OreWheat)}%   |   ${pct(s.top1BrickWood)}%   |  ${pct(s.top1BrickOre)}%   |  ${pct(s.top1OreSheep)}%   |  ${pct(s.apexChangedFromBaseline)}%`);
      }

      console.log(`  Top-20 resource-pair rates (% of 20 × maps slots):`);
      console.log(`    weight | ore+wheat | brick+wood | brick+ore`);
      for (const s of statsByWeight) {
        const slots = succeeded * 20;
        const pct = (x: number) => ((x / slots) * 100).toFixed(1).padStart(5);
        console.log(`    +${s.weight.toFixed(1)}   |  ${pct(s.top20OreWheat)}%   |   ${pct(s.top20BrickWood)}%   |  ${pct(s.top20BrickOre)}%`);
      }

      console.log(`  Top-1 archetype distribution (% of maps):`);
      const archKeys: Archetype[] = ['expansion', 'cityRush', 'balanced', 'portEconomy', 'devCards'];
      const hdr = '    weight | ' + archKeys.map(a => a.padStart(11)).join(' | ');
      console.log(hdr);
      for (const s of statsByWeight) {
        const cells = archKeys.map(a => {
          const v = s.top1ArchetypeCounts.get(a) ?? 0;
          return `${((v / succeeded) * 100).toFixed(1)}%`.padStart(11);
        }).join(' | ');
        console.log(`    +${s.weight.toFixed(1)}   | ${cells}`);
      }

      console.log(`  Top-20 archetype distribution (% of slots):`);
      console.log(hdr);
      for (const s of statsByWeight) {
        const slots = succeeded * 20;
        const cells = archKeys.map(a => {
          const v = s.top20ArchetypeCounts.get(a) ?? 0;
          return `${((v / slots) * 100).toFixed(1)}%`.padStart(11);
        }).join(' | ');
        console.log(`    +${s.weight.toFixed(1)}   | ${cells}`);
      }
    }

    expect(true).toBe(true);
  }, 30 * 60 * 1000);
});
