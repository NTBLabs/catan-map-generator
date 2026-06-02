/** Synergy Bonus Investigation
 *
 *  hasRoadCombo  = brick + wood share a number at the spot → +1.5
 *  hasCityCombo  = ore + wheat share a number at the spot → +1.5
 *  hasSettlementCombo = all 4 settlement materials adjacent → +0.5
 *
 *  Production claim: roadCombo and cityCombo are dormant because
 *  noSameNumberAdjacent + noSameNumberOnResource defaults forbid the
 *  shared-number setup. Phase 1 confirms with hard numbers.
 *
 *  Phase 2 explores both options the user listed:
 *    Option 1 — remove shared-number requirement, treat as adjacency
 *               only. Already what roadPotentialBonus does for road;
 *               needs symmetric cityPotentialBonus for city.
 *    Option 2 — soften constraints (turn off noSameNumberAdjacent and/or
 *               noSameNumberOnResource) and see how often synergy fires.
 *
 *  Plus measures the structural asymmetry: road has BOTH an adjacency
 *  bonus (+0.8) and a shared-number bonus (+1.5); city only has the
 *  shared-number bonus. That asymmetry exists regardless of the
 *  shared-number question.
 */
import { describe, it } from 'vitest';
import { generateMap } from '../src/generator/generate';
import { scoreMap } from '../src/generator/score';
import type { PlayerCount, Variants } from '../src/game/types';

const RUN = process.env.RUN_SYNERGY === '1';

function baseVariants(overrides: Partial<Variants> = {}): Variants {
  return {
    includeDesert: true,
    desertReplacement: 'ore',
    shufflePorts: false,
    noSameNumberAdjacent: true,
    noSameNumberOnResource: true,
    noMultipleRedsOnResource: true,
    challenge: { flavor: 'none', targetResource: 'any' },
    ...overrides,
  };
}

interface ConstraintConfig {
  name: string;
  variants: Variants;
}

const CONFIGS: ConstraintConfig[] = [
  {
    name: 'A: defaults (NSNA on, NSNoR on)',
    variants: baseVariants(),
  },
  {
    name: 'B: noSameNumberAdjacent OFF',
    variants: baseVariants({ noSameNumberAdjacent: false }),
  },
  {
    name: 'C: noSameNumberOnResource OFF',
    variants: baseVariants({ noSameNumberOnResource: false }),
  },
  {
    name: 'D: BOTH constraints OFF',
    variants: baseVariants({ noSameNumberAdjacent: false, noSameNumberOnResource: false }),
  },
];

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

describe('synergy investigation', () => {
  it.runIf(RUN)('quantify dormancy + constraint sensitivity + asymmetry', () => {
    const N = Number(process.env.SAMPLES ?? 500);

    for (const pc of [4, 6] as PlayerCount[]) {
      console.log(`\n=========================== pc=${pc} (n=${N}) ===========================`);

      for (const cfg of CONFIGS) {
        const t0 = Date.now();
        let succeeded = 0;
        let totalSpots = 0;
        let spotsWithRoadCombo = 0;     // hasRoadCombo (shared-number brick+wood)
        let spotsWithCityCombo = 0;     // hasCityCombo (shared-number ore+wheat)
        let spotsBrickWoodAdj = 0;      // brick + wood adjacent any number
        let spotsOreWheatAdj = 0;       // ore + wheat adjacent any number

        // Per-spot in top-20 by total
        let top20Spots = 0;
        let top20RoadCombo = 0;
        let top20CityCombo = 0;
        let top20BrickWoodAdj = 0;
        let top20OreWheatAdj = 0;

        // Per-spot in top-1 by total
        let top1RoadCombo = 0;
        let top1CityCombo = 0;
        let top1BrickWoodAdj = 0;
        let top1OreWheatAdj = 0;

        // Synergy bonus contribution
        const synergyBonuses: number[] = [];

        for (let i = 0; i < N; i++) {
          let mapResult;
          try {
            mapResult = generateMap({ playerCount: pc, variants: cfg.variants });
          } catch { continue; }
          succeeded++;
          const scored = scoreMap(mapResult.map.hexes, mapResult.map.ports, pc);
          const hexById = new Map(mapResult.map.hexes.map(h => [h.id, h] as const));

          // Per-spot stats
          const sortedSpots = Array.from(scored.spots.values()).sort((a, b) => b.total - a.total);
          for (const spot of sortedSpots) {
            totalSpots++;
            if (spot.hasRoadCombo) spotsWithRoadCombo++;
            if (spot.hasCityCombo) spotsWithCityCombo++;
            synergyBonuses.push(spot.synergyBonus);
            // Check adjacency
            const inter = scored.graph.intersections.get(spot.intersectionId)!;
            const adj = new Set<string>();
            for (const hexId of inter.hexIds) {
              const h = hexById.get(hexId);
              if (h && h.resource !== 'desert') adj.add(h.resource);
            }
            const brickWoodAdj = adj.has('brick') && adj.has('wood');
            const oreWheatAdj = adj.has('ore') && adj.has('wheat');
            if (brickWoodAdj) spotsBrickWoodAdj++;
            if (oreWheatAdj) spotsOreWheatAdj++;
          }

          // Top-20 + top-1 stats
          for (let r = 0; r < Math.min(20, sortedSpots.length); r++) {
            const spot = sortedSpots[r];
            top20Spots++;
            if (spot.hasRoadCombo) top20RoadCombo++;
            if (spot.hasCityCombo) top20CityCombo++;
            const inter = scored.graph.intersections.get(spot.intersectionId)!;
            const adj = new Set<string>();
            for (const hexId of inter.hexIds) {
              const h = hexById.get(hexId);
              if (h && h.resource !== 'desert') adj.add(h.resource);
            }
            if (adj.has('brick') && adj.has('wood')) top20BrickWoodAdj++;
            if (adj.has('ore') && adj.has('wheat')) top20OreWheatAdj++;
            if (r === 0) {
              if (spot.hasRoadCombo) top1RoadCombo++;
              if (spot.hasCityCombo) top1CityCombo++;
              if (adj.has('brick') && adj.has('wood')) top1BrickWoodAdj++;
              if (adj.has('ore') && adj.has('wheat')) top1OreWheatAdj++;
            }
          }
        }
        const elapsed = (Date.now() - t0) / 1000;

        console.log(`\n  ${cfg.name}    (${succeeded} maps in ${elapsed.toFixed(1)}s)`);
        console.log('  All-spots prevalence:');
        console.log(`    hasRoadCombo (br+wo shared #): ${spotsWithRoadCombo}/${totalSpots} (${(spotsWithRoadCombo / totalSpots * 100).toFixed(2)}%)`);
        console.log(`    hasCityCombo (or+wh shared #): ${spotsWithCityCombo}/${totalSpots} (${(spotsWithCityCombo / totalSpots * 100).toFixed(2)}%)`);
        console.log(`    brick+wood adjacent (any #):   ${spotsBrickWoodAdj}/${totalSpots} (${(spotsBrickWoodAdj / totalSpots * 100).toFixed(2)}%)`);
        console.log(`    ore+wheat adjacent (any #):    ${spotsOreWheatAdj}/${totalSpots} (${(spotsOreWheatAdj / totalSpots * 100).toFixed(2)}%)`);
        console.log(`    avg synergyBonus over all spots: ${mean(synergyBonuses).toFixed(3)}`);

        console.log('  Top-20 prevalence (n=' + top20Spots + ' spot-slots):');
        console.log(`    hasRoadCombo: ${top20RoadCombo} (${(top20RoadCombo / top20Spots * 100).toFixed(2)}%)`);
        console.log(`    hasCityCombo: ${top20CityCombo} (${(top20CityCombo / top20Spots * 100).toFixed(2)}%)`);
        console.log(`    brick+wood adj: ${top20BrickWoodAdj} (${(top20BrickWoodAdj / top20Spots * 100).toFixed(2)}%)`);
        console.log(`    ore+wheat adj:  ${top20OreWheatAdj} (${(top20OreWheatAdj / top20Spots * 100).toFixed(2)}%)`);

        console.log('  Top-1 prevalence (n=' + succeeded + ' maps):');
        console.log(`    hasRoadCombo: ${top1RoadCombo} (${(top1RoadCombo / succeeded * 100).toFixed(2)}%)`);
        console.log(`    hasCityCombo: ${top1CityCombo} (${(top1CityCombo / succeeded * 100).toFixed(2)}%)`);
        console.log(`    brick+wood adj: ${top1BrickWoodAdj} (${(top1BrickWoodAdj / succeeded * 100).toFixed(2)}%)`);
        console.log(`    ore+wheat adj:  ${top1OreWheatAdj} (${(top1OreWheatAdj / succeeded * 100).toFixed(2)}%)`);
      }
    }
  }, 30 * 60 * 1000);
});
