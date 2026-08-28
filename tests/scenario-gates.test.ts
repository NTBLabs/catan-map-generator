import { describe, it, expect } from 'vitest';
import { challengeMatches, generateMap } from '../src/generator/generate';
import { computeHealth } from '../src/generator/score';
import { RED_NUMBERS } from '../src/game/constants';
import type { Hex, PlayerCount, ProducingResource, Variants } from '../src/game/types';

// Fabricated hex lists for gate arithmetic. challengeMatches reads only
// computeHealth plus the target's tile count for scarcity, and computeHealth
// ignores geometry, so coordinates just need to be unique.
function hexesWith(target: ProducingResource, numbers: number[]): Hex[] {
  return numbers.map((n, i) => ({ id: `t${i}`, q: i * 10, r: 0, resource: target, number: n }));
}

function strictVariants(flavor: 'scarcity' | 'boomOrBust', target: ProducingResource): Variants {
  return {
    includeDesert: true,
    desertReplacement: 'ore',
    shufflePorts: false,
    noSameNumberAdjacent: true,
    noSameNumberOnResource: true,
    noMultipleRedsOnResource: true,
    challenge: { flavor, targetResource: target },
  };
}

// T1a: the scarcity gate is totalPips <= 2 * tiles - 1. These boundary pairs
// pin the shape at every tile count a resource can have: base 3/4, base with
// the desert replaced 5, expansion 5/6. The old constant (<= 4) was
// unreachable for every tile count above 3 because only four low-pip numbers
// exist: with distinct numbers a 4-tile resource floors at 6 pips and a
// 6-tile expansion resource floors at 12 (64% of fair share). Established by
// exhaustive multiset enumeration over both number bags, 2026-08-27.
describe('scarcity gate shape: totalPips <= 2 * tiles - 1', () => {
  const cases: Array<{ k: number; pass: number[]; fail: number[] }> = [
    // pass sums to exactly 2k - 1 (the boundary), fail to 2k.
    { k: 3, pass: [2, 12, 4], fail: [2, 12, 5] },        // 5 vs 6
    { k: 4, pass: [2, 12, 3, 4], fail: [2, 12, 3, 5] },  // 7 vs 8
    { k: 5, pass: [2, 12, 3, 11, 4], fail: [2, 12, 3, 11, 5] },   // 9 vs 10
    { k: 6, pass: [2, 12, 3, 11, 3, 4], fail: [2, 12, 3, 11, 4, 4] }, // 11 vs 12
  ];
  for (const c of cases) {
    it(`accepts ${2 * c.k - 1} pips and rejects ${2 * c.k} pips on a ${c.k}-tile target`, () => {
      const challenge = { kind: 'scarcity' as const, target: 'wood' as const };
      expect(challengeMatches(hexesWith('wood', c.pass), [], 4, challenge)).toBe(true);
      expect(challengeMatches(hexesWith('wood', c.fail), [], 4, challenge)).toBe(false);
    });
  }

  it('floor facts: distinct numbers cannot go below 6 pips on 4 tiles or 12 on 6 tiles', () => {
    // The four low-pip numbers are 2, 3, 11, 12 (pips 1, 2, 2, 1). The
    // cheapest DISTINCT sets are therefore fixed, and both sit above the old
    // <= 4 gate: this is the arithmetic that made the gate change necessary.
    const floor4 = computeHealth(hexesWith('wood', [2, 12, 3, 11])).find(h => h.resource === 'wood')!;
    expect(floor4.totalPips).toBe(6);
    const floor6 = computeHealth(hexesWith('wood', [2, 12, 3, 11, 4, 10])).find(h => h.resource === 'wood')!;
    expect(floor6.totalPips).toBe(12);
  });
});

// T1b: boom-or-bust's concentration >= 0.6 gate against the arithmetic
// ceiling of distinct-number placement. With noSameNumberOnResource enforced
// on the target the gate is unreachable at every tile count above 3; with
// duplicates allowed (the target exemption) it is comfortably reachable.
// The gate constants themselves are unchanged.
describe('boomOrBust concentration ceiling', () => {
  it('distinct numbers ceiling at 5/9 on 4 tiles and 5/14 on 6 tiles, both under 0.6', () => {
    // Best possible distinct-number concentration: one red plus the
    // cheapest distinct leftovers.
    const best4 = computeHealth(hexesWith('wheat', [6, 2, 12, 3])).find(h => h.resource === 'wheat')!;
    expect(best4.concentration).toBeCloseTo(5 / 9, 10);
    expect(best4.concentration).toBeLessThan(0.6);
    const best6 = computeHealth(hexesWith('wheat', [6, 2, 12, 3, 11, 4])).find(h => h.resource === 'wheat')!;
    expect(best6.concentration).toBeCloseTo(5 / 14, 10);
    expect(best6.concentration).toBeLessThan(0.6);
  });

  it('duplicate numbers reach the 0.6 gate that distinct numbers cannot', () => {
    const doubled = computeHealth(hexesWith('wheat', [6, 6, 2, 12])).find(h => h.resource === 'wheat')!;
    expect(doubled.concentration).toBeCloseTo(10 / 12, 10);
    expect(doubled.concentration).toBeGreaterThanOrEqual(0.6);
    // 6-tile expansion shape seen in generation: triple 8 plus junk.
    const tripled = computeHealth(hexesWith('wood', [8, 8, 8, 9, 9, 3])).find(h => h.resource === 'wood')!;
    expect(tripled.concentration).toBeCloseTo(15 / 25, 10);
    expect(tripled.concentration).toBeGreaterThanOrEqual(0.6);
  });
});

// T2: the exemption applies to the TARGET resource only. Non-target
// resources must still obey noSameNumberOnResource and
// noMultipleRedsOnResource on accepted boards. Seeds are fixed and chosen to
// accept quickly so the fast suite stays fast.
describe('scenario target exemption scoping', () => {
  function assertNonTargetsObeyToggles(hexes: Hex[], target: ProducingResource, pc: PlayerCount) {
    const redCap = pc > 4 ? 2 : 1;
    const byResource = new Map<string, number[]>();
    for (const h of hexes) {
      if (h.resource === 'desert' || h.number === null || h.resource === target) continue;
      if (!byResource.has(h.resource)) byResource.set(h.resource, []);
      byResource.get(h.resource)!.push(h.number);
    }
    expect(byResource.size).toBe(4);
    for (const [resource, nums] of byResource) {
      expect(new Set(nums).size, `${resource} has duplicate numbers: ${nums.join(',')}`).toBe(nums.length);
      const reds = nums.filter(n => RED_NUMBERS.has(n)).length;
      expect(reds, `${resource} carries ${reds} reds`).toBeLessThanOrEqual(redCap);
    }
  }

  it('boomOrBust pc4: target beats the distinct-number ceiling, non-targets obey both toggles', () => {
    const res = generateMap({ playerCount: 4, variants: strictVariants('boomOrBust', 'wheat'), seed: 7001 });
    expect(res.fellBack).toBe(false);
    const wheat = computeHealth(res.map.hexes).find(h => h.resource === 'wheat')!;
    expect(wheat.concentration).toBeGreaterThanOrEqual(0.6);
    // Concentration >= 0.6 on a 4-tile resource is unreachable with distinct
    // numbers and at most one red, so the target must be using the exemption.
    assertNonTargetsObeyToggles(res.map.hexes, 'wheat', 4);
  });

  it('scarcity pc4: 3-tile target lands at or under 5 pips, non-targets obey both toggles', () => {
    const res = generateMap({ playerCount: 4, variants: strictVariants('scarcity', 'brick'), seed: 7007 });
    expect(res.fellBack).toBe(false);
    const brick = computeHealth(res.map.hexes).find(h => h.resource === 'brick')!;
    expect(brick.totalPips).toBeLessThanOrEqual(5);
    assertNonTargetsObeyToggles(res.map.hexes, 'brick', 4);
  });

  it('scarcity pc6: 6-tile target lands at or under 11 pips (impossible without the exemption)', () => {
    const res = generateMap({ playerCount: 6, variants: strictVariants('scarcity', 'wood'), seed: 7001 });
    expect(res.fellBack).toBe(false);
    const wood = computeHealth(res.map.hexes).find(h => h.resource === 'wood')!;
    expect(wood.totalPips).toBeLessThanOrEqual(11);
    assertNonTargetsObeyToggles(res.map.hexes, 'wood', 6);
  });

  it('boomOrBust pc6: 6-tile target reaches 0.6 concentration, non-targets obey both toggles', () => {
    const res = generateMap({ playerCount: 6, variants: strictVariants('boomOrBust', 'wood'), seed: 7004 });
    expect(res.fellBack).toBe(false);
    const wood = computeHealth(res.map.hexes).find(h => h.resource === 'wood')!;
    expect(wood.concentration).toBeGreaterThanOrEqual(0.6);
    assertNonTargetsObeyToggles(res.map.hexes, 'wood', 6);
  });
});

// T3: regression lock on the four modes the exemption must not touch.
// Expected hashes were captured at HEAD 32fdf97, immediately BEFORE the
// target-exemption change, with .sweep/post-fix/capture-baseline.ts. The
// exemption is derived from the resolved challenge kind and is undefined for
// these modes, so their boards, attempt counts, and RNG streams must be
// byte-identical. If a FUTURE deliberate generator change breaks this test,
// re-capture the hashes with that script and say so in the commit: this is
// the share-link-invalidation tripwire.
describe('untouched modes produce identical boards at fixed seeds', () => {
  function djb2(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  const EXPECTED: Record<string, string> = {
    'none|pc3|defaults': 'bbed3a9e', 'none|pc3|loose': '50362da1',
    'none|pc4|defaults': 'a7c1c241', 'none|pc4|loose': '026445a7',
    'none|pc5|defaults': '30fdbe16', 'none|pc5|loose': '81ca8f7f',
    'none|pc6|defaults': '02629cd5', 'none|pc6|loose': 'df18369a',
    'drought|pc3|defaults': 'cd9e34eb', 'drought|pc3|loose': 'f26898fa',
    'drought|pc4|defaults': '16f244ae', 'drought|pc4|loose': '001ec49a',
    'drought|pc5|defaults': 'e6faca84', 'drought|pc5|loose': '9c556587',
    'drought|pc6|defaults': 'd8032c21', 'drought|pc6|loose': '1d402004',
    'wealthGap|pc3|defaults': 'c72bd7ab', 'wealthGap|pc3|loose': '941c4ff2',
    'wealthGap|pc4|defaults': 'f71f326d', 'wealthGap|pc4|loose': '03aa1e38',
    'wealthGap|pc5|defaults': 'a8798444', 'wealthGap|pc5|loose': '7a7f4820',
    'wealthGap|pc6|defaults': 'a25f9507', 'wealthGap|pc6|loose': '5b30d0c7',
    'hotZone|pc3|defaults': '1ea8a6c9', 'hotZone|pc3|loose': '86ad97f2',
    'hotZone|pc4|defaults': '55f09478', 'hotZone|pc4|loose': '4326cd1c',
    'hotZone|pc5|defaults': 'd56c0d9e', 'hotZone|pc5|loose': '952bb8ae',
    'hotZone|pc6|defaults': '54be6e7c', 'hotZone|pc6|loose': '8c6930b9',
    'none-noDesert-wheat|pc4|defaults': 'be31edd7',
  };

  function variantsFor(flavor: Variants['challenge']['flavor'], loose: boolean): Variants {
    return {
      includeDesert: true,
      desertReplacement: 'ore',
      shufflePorts: loose,
      noSameNumberAdjacent: !loose,
      noSameNumberOnResource: !loose,
      noMultipleRedsOnResource: !loose,
      challenge: { flavor, targetResource: 'any' },
    };
  }

  function canonicalHash(pc: PlayerCount, variants: Variants, seed: number): string {
    const res = generateMap({ playerCount: pc, variants, seed });
    return djb2(JSON.stringify({
      h: res.map.hexes.map(h => [h.id, h.resource, h.number]),
      p: res.map.ports,
      a: res.attempts,
      f: res.fellBack,
      rf: res.map.variants.challenge.rolledFlavor ?? null,
    }));
  }

  for (const flavor of ['none', 'drought', 'wealthGap', 'hotZone'] as const) {
    it(`${flavor} matches its pre-change boards at every player count`, () => {
      for (const pc of [3, 4, 5, 6] as PlayerCount[]) {
        for (const loose of [false, true]) {
          const seed = (0x5eed0000 + pc * 256 + (loose ? 16 : 0) + flavor.length) >>> 0;
          const key = `${flavor}|pc${pc}|${loose ? 'loose' : 'defaults'}`;
          expect(canonicalHash(pc, variantsFor(flavor, loose), seed), key).toBe(EXPECTED[key]);
        }
      }
    });
  }

  it('desert replacement in balanced mode matches its pre-change board', () => {
    const v = variantsFor('none', false);
    v.includeDesert = false;
    v.desertReplacement = 'wheat';
    expect(canonicalHash(4, v, 0x5eedbeef >>> 0)).toBe(EXPECTED['none-noDesert-wheat|pc4|defaults']);
  });
});
