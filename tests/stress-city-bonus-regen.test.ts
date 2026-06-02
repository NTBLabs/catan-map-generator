/** Full regeneration validation for cityPotentialBonus = +0.4.
 *
 *  Same-seed controlled comparison: BASELINE (city bonus disabled via
 *  scoreMap override — not available, so we instead compare to documented
 *  pre-change numbers) and TREATMENT (production code with +0.4 city bonus).
 *
 *  Since cityPotentialBonus is now baked into score.ts and we can't toggle
 *  it via GenerateOptions, this run measures TREATMENT in isolation against
 *  the previously-recorded baseline numbers from prior regen runs.
 *
 *  Metrics tracked per pc ∈ {4, 6}:
 *    - Acceptance rate (% maps not fallback)
 *    - Mean attempts per accepted map
 *    - Fairness stdev (mean and p90)
 *    - Top-1 archetype distribution
 *    - Top-20 archetype distribution
 *    - viableArchetypeCounts mean per archetype
 *    - balanced top-1 share + top-20 share (regression watch)
 *    - Top-1 / Top-20 archetype entropy (Shannon, base 2)
 */
import { describe, it, expect } from 'vitest';
import { generateMap } from '../src/generator/generate';
import { scoreMap } from '../src/generator/score';
import type { PlayerCount, Variants, Archetype } from '../src/game/types';

const RUN = process.env.RUN_CITY_REGEN === '1';

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

const ARCH_KEYS: Archetype[] = ['expansion', 'cityRush', 'balanced', 'portEconomy', 'devCards'];

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)));
  return s[i];
}
function entropy(counts: Map<Archetype, number>, total: number): number {
  if (total === 0) return 0;
  let h = 0;
  for (const v of counts.values()) {
    if (v <= 0) continue;
    const p = v / total;
    h -= p * Math.log2(p);
  }
  return h;
}

describe('city bonus regen validation', () => {
  it.runIf(RUN)('regenerates and reports full metric panel', () => {
    const N = Number(process.env.SAMPLES ?? 300);
    const SEED0 = 100000;

    for (const pc of [4, 6] as PlayerCount[]) {
      console.log(`\n=========================== pc=${pc} (n=${N}) ===========================`);
      const t0 = Date.now();

      const attemptsList: number[] = [];
      const fairnessList: number[] = [];
      let succeeded = 0, fellBack = 0;

      const top1Counts = new Map<Archetype, number>();
      const top20Counts = new Map<Archetype, number>();
      const viableSums: Record<Archetype, number> = {
        expansion: 0, cityRush: 0, balanced: 0, portEconomy: 0, devCards: 0,
      };

      // Top-1 resource pair tracking for asymmetry check
      let top1OreWheat = 0, top1BrickWood = 0, top1BrickOre = 0;

      for (let i = 0; i < N; i++) {
        let r;
        try {
          r = generateMap({ playerCount: pc, variants: baseVariants(), seed: SEED0 + i });
        } catch { continue; }
        succeeded++;
        if (r.fellBack) fellBack++;
        attemptsList.push(r.attempts);

        const scored = scoreMap(r.map.hexes, r.map.ports, pc);
        fairnessList.push(scored.fairness.stdev);

        for (const a of ARCH_KEYS) viableSums[a] += scored.viableArchetypeCounts[a];

        const sorted = Array.from(scored.spots.values()).sort((a, b) => b.total - a.total);
        const apex = sorted[0];
        top1Counts.set(apex.archetype, (top1Counts.get(apex.archetype) ?? 0) + 1);

        // Resource-pair check
        const hexById = new Map(r.map.hexes.map(h => [h.id, h] as const));
        const apexInter = scored.graph.intersections.get(apex.intersectionId)!;
        const apexAdj = new Set<string>();
        for (const hexId of apexInter.hexIds) {
          const h = hexById.get(hexId);
          if (h && h.resource !== 'desert') apexAdj.add(h.resource);
        }
        if (apexAdj.has('ore') && apexAdj.has('wheat')) top1OreWheat++;
        if (apexAdj.has('brick') && apexAdj.has('wood')) top1BrickWood++;
        if (apexAdj.has('brick') && apexAdj.has('ore')) top1BrickOre++;

        for (let k = 0; k < Math.min(20, sorted.length); k++) {
          top20Counts.set(sorted[k].archetype, (top20Counts.get(sorted[k].archetype) ?? 0) + 1);
        }
      }
      const elapsed = (Date.now() - t0) / 1000;

      const top20Slots = succeeded * 20;
      const h1 = entropy(top1Counts, succeeded);
      const h20 = entropy(top20Counts, top20Slots);

      console.log(`  Generated ${succeeded}/${N} maps in ${elapsed.toFixed(1)}s. Fell back: ${fellBack} (${(fellBack / succeeded * 100).toFixed(2)}%)`);
      console.log(`  Attempts/map: mean=${mean(attemptsList).toFixed(2)}, p90=${quantile(attemptsList, 0.9)}, max=${Math.max(...attemptsList)}`);
      console.log(`  Fairness stdev: mean=${mean(fairnessList).toFixed(3)}, p90=${quantile(fairnessList, 0.9).toFixed(3)}, max=${Math.max(...fairnessList).toFixed(3)}`);

      console.log(`  Top-1 archetype distribution (entropy H=${h1.toFixed(3)} bits, max=${Math.log2(ARCH_KEYS.length).toFixed(3)}):`);
      for (const a of ARCH_KEYS) {
        const v = top1Counts.get(a) ?? 0;
        console.log(`    ${a.padStart(12)}: ${v}/${succeeded} (${(v / succeeded * 100).toFixed(2)}%)`);
      }

      console.log(`  Top-20 archetype distribution (entropy H=${h20.toFixed(3)} bits):`);
      for (const a of ARCH_KEYS) {
        const v = top20Counts.get(a) ?? 0;
        console.log(`    ${a.padStart(12)}: ${v}/${top20Slots} (${(v / top20Slots * 100).toFixed(2)}%)`);
      }

      console.log(`  viableArchetypeCounts (mean per map, k=5 gate):`);
      for (const a of ARCH_KEYS) {
        console.log(`    ${a.padStart(12)}: mean=${(viableSums[a] / succeeded).toFixed(2)}`);
      }

      console.log(`  Top-1 resource-pair rates:`);
      console.log(`    ore+wheat:  ${top1OreWheat}/${succeeded} (${(top1OreWheat / succeeded * 100).toFixed(2)}%)`);
      console.log(`    brick+wood: ${top1BrickWood}/${succeeded} (${(top1BrickWood / succeeded * 100).toFixed(2)}%)`);
      console.log(`    brick+ore:  ${top1BrickOre}/${succeeded} (${(top1BrickOre / succeeded * 100).toFixed(2)}%)`);
    }

    expect(true).toBe(true);
  }, 30 * 60 * 1000);
});
