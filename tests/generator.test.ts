import { describe, it, expect } from 'vitest';
import { generateMap } from '../src/generator/generate';
import { checkHardConstraints } from '../src/generator/constraints';
import { computeHealth, hasDroughtCluster, scoreMap } from '../src/generator/score';
import type { PlayerCount, Variants } from '../src/game/types';
import { HIGH_YIELD_NUMBERS } from '../src/game/constants';

function baseVariants(): Variants {
  return {
    includeDesert: true,
    desertReplacement: 'ore',
    shufflePorts: true,
    noSameNumberAdjacent: false,
    noSameNumberOnResource: false,
    noMultipleRedsOnResource: false,
    challenge: { flavor: 'none', targetResource: 'any' },
  };
}

describe('generator hard constraints', () => {
  for (const playerCount of [3, 4, 5, 6] as PlayerCount[]) {
    it(`produces a map satisfying hard constraints for ${playerCount} players`, () => {
      const { map } = generateMap({ playerCount, variants: baseVariants() });
      const check = checkHardConstraints(map.hexes, map.ports);
      expect(check.ok, check.reason).toBe(true);
    });
  }

  it('no intersection has 3 high-yield hexes (default constraint)', () => {
    const { map } = generateMap({ playerCount: 4, variants: baseVariants() });
    const scored = scoreMap(map.hexes, map.ports, 4);
    const hexById = new Map(map.hexes.map(h => [h.id, h] as const));
    for (const inter of scored.graph.intersections.values()) {
      if (inter.hexIds.length < 3) continue;
      const highCount = inter.hexIds
        .map(id => hexById.get(id)!)
        .filter(h => h.number !== null && HIGH_YIELD_NUMBERS.has(h.number)).length;
      expect(highCount, `intersection ${inter.id} has too many high-yield hexes`).toBeLessThanOrEqual(2);
    }
  });
});

describe('no same number on same resource', () => {
  it('enforces strict uniqueness when toggled on', () => {
    const variants = baseVariants();
    variants.noSameNumberOnResource = true;
    for (let trial = 0; trial < 5; trial++) {
      const { map } = generateMap({ playerCount: 4, variants });
      const numbersByResource = new Map<string, number[]>();
      for (const h of map.hexes) {
        if (h.resource === 'desert' || h.number === null) continue;
        if (!numbersByResource.has(h.resource)) numbersByResource.set(h.resource, []);
        numbersByResource.get(h.resource)!.push(h.number);
      }
      for (const [resource, nums] of numbersByResource) {
        expect(new Set(nums).size, `trial ${trial}: ${resource} has duplicates: ${nums.join(',')}`).toBe(nums.length);
      }
    }
  });
});

describe('spread reds across resources', () => {
  it('base game places at most one red number per resource when toggled on', () => {
    const variants = baseVariants();
    variants.noMultipleRedsOnResource = true;
    const RED = new Set([6, 8]);
    for (let trial = 0; trial < 5; trial++) {
      const { map } = generateMap({ playerCount: 4, variants });
      const redsPerResource = new Map<string, number>();
      for (const h of map.hexes) {
        if (h.resource === 'desert' || h.number === null) continue;
        if (RED.has(h.number)) redsPerResource.set(h.resource, (redsPerResource.get(h.resource) ?? 0) + 1);
      }
      for (const [resource, count] of redsPerResource) {
        expect(count, `trial ${trial}: ${resource} has ${count} reds`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('no same number adjacency', () => {
  it('enforces no two same numbers adjacent when toggled on', () => {
    const variants = baseVariants();
    variants.noSameNumberAdjacent = true;
    for (let trial = 0; trial < 3; trial++) {
      const { map } = generateMap({ playerCount: 4, variants });
      // Walk every neighbor pair and assert no shared numbers.
      const byKey = new Map(map.hexes.map(h => [`${h.q},${h.r}`, h] as const));
      for (const hex of map.hexes) {
        if (hex.number === null) continue;
        const neighbors = [
          [hex.q + 1, hex.r], [hex.q + 1, hex.r - 1],
          [hex.q, hex.r - 1], [hex.q - 1, hex.r],
          [hex.q - 1, hex.r + 1], [hex.q, hex.r + 1],
        ];
        for (const [nq, nr] of neighbors) {
          const n = byKey.get(`${nq},${nr}`);
          if (!n || n.number === null) continue;
          expect(n.number, `trial ${trial}: ${hex.id} and ${n.id} both have ${hex.number}`).not.toBe(hex.number);
        }
      }
    }
  });
});

describe('desert variant', () => {
  it('no desert tiles when includeDesert=false', () => {
    const variants = baseVariants();
    variants.includeDesert = false;
    variants.desertReplacement = 'ore';
    const { map } = generateMap({ playerCount: 4, variants });
    expect(map.hexes.find(h => h.resource === 'desert')).toBeUndefined();
    expect(map.hexes.every(h => h.number !== null)).toBe(true);
  });

  it('exactly one desert in base game with includeDesert=true', () => {
    for (let trial = 0; trial < 5; trial++) {
      const { map } = generateMap({ playerCount: 4, variants: baseVariants() });
      const deserts = map.hexes.filter(h => h.resource === 'desert');
      expect(deserts.length, `trial ${trial} produced ${deserts.length} deserts`).toBe(1);
    }
  });

  it('exactly two deserts in 5-6 expansion with includeDesert=true', () => {
    for (let trial = 0; trial < 3; trial++) {
      const { map } = generateMap({ playerCount: 6, variants: baseVariants() });
      const deserts = map.hexes.filter(h => h.resource === 'desert');
      expect(deserts.length, `trial ${trial} produced ${deserts.length} deserts`).toBe(2);
    }
  });

  it('resource counts always match the expected bag', () => {
    for (let trial = 0; trial < 5; trial++) {
      const { map } = generateMap({ playerCount: 4, variants: baseVariants() });
      const counts: Record<string, number> = {};
      for (const h of map.hexes) counts[h.resource] = (counts[h.resource] ?? 0) + 1;
      expect(counts).toEqual({ wood: 4, brick: 3, wheat: 4, sheep: 4, ore: 3, desert: 1 });
    }
  });
});

describe('snake-draft fairness', () => {
  it('player totals are roughly balanced (within 2*threshold) for 4 players', () => {
    const { map } = generateMap({ playerCount: 4, variants: baseVariants() });
    const scored = scoreMap(map.hexes, map.ports, 4);
    expect(scored.fairness.stdev).toBeLessThan(3.5);
    expect(scored.fairness.playerTotals).toHaveLength(4);
  });
});

describe('challenge flavors', () => {
  it('scarcity produces a target resource with low total pips', () => {
    const variants = baseVariants();
    variants.challenge = { flavor: 'scarcity', targetResource: 'ore' };
    const { map } = generateMap({ playerCount: 4, variants, maxAttempts: 2000 });
    const health = computeHealth(map.hexes);
    const ore = health.find(h => h.resource === 'ore')!;
    expect(ore.totalPips).toBeLessThanOrEqual(4);
  });

  it('drought produces a triple cluster of low-yield hexes', () => {
    const variants = baseVariants();
    variants.challenge = { flavor: 'drought', targetResource: 'any' };
    const { map } = generateMap({ playerCount: 4, variants, maxAttempts: 2000 });
    expect(hasDroughtCluster(map.hexes)).toBe(true);
  });

  it('boom-or-bust produces a resource with high concentration', () => {
    const variants = baseVariants();
    variants.challenge = { flavor: 'boomOrBust', targetResource: 'wheat' };
    const { map } = generateMap({ playerCount: 4, variants, maxAttempts: 2000 });
    const health = computeHealth(map.hexes);
    const wheat = health.find(h => h.resource === 'wheat')!;
    expect(wheat.concentration).toBeGreaterThanOrEqual(0.6);
  });

  it('random rolls a real flavor that is recorded on the map', () => {
    const variants = baseVariants();
    variants.challenge = { flavor: 'random', targetResource: 'any' };
    const { map } = generateMap({ playerCount: 4, variants, maxAttempts: 2000 });
    expect(map.variants.challenge.rolledFlavor).toBeDefined();
    expect(['scarcity', 'boomOrBust', 'drought', 'wealthGap', 'hotZone']).toContain(map.variants.challenge.rolledFlavor);
  });
});

describe('scarcity bonus', () => {
  it('spot adjacent to a scarcer resource scores higher than equivalent spot adjacent to abundant ones', () => {
    // Synthetic two-hex layouts sharing one intersection: one hex carries
    // a resource we declare scarce (count 3) vs abundant (count 4).
    // Both hexes have the same number, so pip value is identical — the
    // delta is purely the scarcity bonus.
    const scarceHex = { id: 'h0', q: 0, r: 0, resource: 'brick' as const, number: 6 };
    const otherHex = { id: 'h1', q: 1, r: 0, resource: 'wood' as const, number: 6 };
    // Fake context: brick 3 tiles, wood 4. Need to inflate counts so the
    // tilesPerResource map reflects scarcity. We rely on scoreMap to compute
    // tilesPerResource from the passed hexes.
    const scarceMap = scoreMap(
      [
        scarceHex,
        otherHex,
        { id: 'h2', q: 0, r: 1, resource: 'wood', number: 8 },
        { id: 'h3', q: 1, r: 1, resource: 'wood', number: 5 },
        { id: 'h4', q: -1, r: 1, resource: 'wood', number: 9 },
        { id: 'h5', q: 2, r: 0, resource: 'brick', number: 3 },
        { id: 'h6', q: 2, r: 1, resource: 'brick', number: 4 },
      ],
      [],
      4,
    );
    // The intersection that touches the brick hex should have a positive
    // scarcityBonus; one that touches only wood should have zero.
    const spotsWithBrickAdj = Array.from(scarceMap.spots.values()).filter(s =>
      s.scarcityBonus > 0,
    );
    expect(spotsWithBrickAdj.length).toBeGreaterThan(0);
    for (const s of spotsWithBrickAdj) {
      expect(s.total).toBeGreaterThan(s.pipValue + s.diversityBonus + s.portBonus + s.synergyBonus + s.sameNumberPenalty);
    }
  });
});

describe('resource-number uniqueness', () => {
  it('strongly prefers unique numbers per resource (avg <0.5 duplicates/trial)', () => {
    // Uniqueness is a soft preference — the placer falls back to a duplicate
    // when no unique-resource candidate is available for the current number.
    // Across many trials the average should be very close to zero.
    const trials = 20;
    let totalDuplicates = 0;
    for (let trial = 0; trial < trials; trial++) {
      const { map } = generateMap({ playerCount: 4, variants: baseVariants() });
      const numbersByResource = new Map<string, number[]>();
      for (const h of map.hexes) {
        if (h.resource === 'desert' || h.number === null) continue;
        if (!numbersByResource.has(h.resource)) numbersByResource.set(h.resource, []);
        numbersByResource.get(h.resource)!.push(h.number);
      }
      for (const nums of numbersByResource.values()) {
        totalDuplicates += nums.length - new Set(nums).size;
      }
    }
    expect(totalDuplicates / trials).toBeLessThan(0.5);
  });
});

describe('snake-draft picks respect distance rule', () => {
  it('no two simulated picks share an intersection or a neighboring intersection', () => {
    for (let trial = 0; trial < 5; trial++) {
      const { map } = generateMap({ playerCount: 4, variants: baseVariants() });
      const scored = scoreMap(map.hexes, map.ports, 4);
      const picks = scored.fairness.picks;
      const pickedIds = new Set(picks.map(p => p.intersectionId));
      for (const pick of picks) {
        const inter = scored.graph.intersections.get(pick.intersectionId)!;
        for (const nb of inter.neighbors) {
          expect(pickedIds.has(nb), `trial ${trial}: pick ${pick.intersectionId} has a neighbor ${nb} that is also picked`).toBe(false);
        }
      }
    }
  });
});

describe('number distribution', () => {
  it('every resource gets at least one high-yield number (5/6/8/9) in balanced mode', () => {
    for (let trial = 0; trial < 3; trial++) {
      const { map } = generateMap({ playerCount: 4, variants: baseVariants() });
      const tilesByResource = new Map<string, typeof map.hexes>();
      for (const h of map.hexes) {
        if (h.resource === 'desert') continue;
        if (!tilesByResource.has(h.resource)) tilesByResource.set(h.resource, []);
        tilesByResource.get(h.resource)!.push(h);
      }
      for (const [resource, tiles] of tilesByResource) {
        const hasHigh = tiles.some(t => t.number !== null && HIGH_YIELD_NUMBERS.has(t.number));
        expect(hasHigh, `${resource} has no high-yield number on trial ${trial}`).toBe(true);
      }
    }
  });

  it('high-yield numbers are spread across resource types (no more than 2 per resource)', () => {
    for (let trial = 0; trial < 3; trial++) {
      const { map } = generateMap({ playerCount: 4, variants: baseVariants() });
      const highCountByResource = new Map<string, number>();
      for (const h of map.hexes) {
        if (h.number !== null && HIGH_YIELD_NUMBERS.has(h.number)) {
          highCountByResource.set(h.resource, (highCountByResource.get(h.resource) ?? 0) + 1);
        }
      }
      for (const [resource, count] of highCountByResource) {
        expect(count, `${resource} carries ${count} high-yield numbers on trial ${trial}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('ports', () => {
  it('default (shufflePorts=false) places all 9 ports in canonical order', () => {
    const variants = baseVariants();
    variants.shufflePorts = false;
    const { map } = generateMap({ playerCount: 4, variants });
    // All 9 port slots must be filled (regression test for the missing-sheep
    // bug where slot 8 referenced an off-board hex and got silently dropped).
    expect(map.ports).toHaveLength(9);
    // Canonical layout, starting bottom-left and walking CCW up the left:
    // 3:1, brick, wood, 3:1, wheat, ore, 3:1, sheep, 3:1.
    // Slot index → type (slots stored CW from top-left):
    //   0: generic, 1: wheat, 2: ore, 3: generic, 4: sheep,
    //   5: generic, 6: generic, 7: brick, 8: wood
    expect(map.ports.map(p => p.type)).toEqual([
      'generic', 'wheat', 'ore', 'generic', 'sheep',
      'generic', 'generic', 'brick', 'wood',
    ]);
    // Exactly one of each specific 2:1.
    const specificCounts = new Map<string, number>();
    for (const p of map.ports) {
      if (p.type !== 'generic') specificCounts.set(p.type, (specificCounts.get(p.type) ?? 0) + 1);
    }
    for (const resource of ['sheep', 'wheat', 'ore', 'brick', 'wood']) {
      expect(specificCounts.get(resource), `expected exactly one ${resource} 2:1 port`).toBe(1);
    }
  });
});

describe('synergy bonuses', () => {
  it('detects road combo when same number is on brick and wood at an intersection', () => {
    // Build a tiny synthetic 2-hex layout: brick at (0,0) with number 5, wood at (1,0) with number 5
    const hexes = [
      { id: 'h0', q: 0, r: 0, resource: 'brick' as const, number: 5 },
      { id: 'h1', q: 1, r: 0, resource: 'wood' as const, number: 5 },
    ];
    const scored = scoreMap(hexes, [], 4);
    const road = Array.from(scored.spots.values()).find(s => s.hasRoadCombo);
    expect(road, 'expected at least one intersection with road combo').toBeDefined();
  });
});
