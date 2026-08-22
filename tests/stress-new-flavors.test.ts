/** Validation for the two new challenge flavors: wealthGap + hotZone.
 *  Confirms acceptance rate, attempts profile, flavor-match rate, and --
 *  CRITICALLY -- per-player snake-draft balance. The design contract is
 *  that scenarios mess with resource distribution but NOT with player
 *  balance: regardless of pick order, each player's two-spot total should
 *  land within ~4% of the overall mean.
 */
import { describe, it, expect } from 'vitest';
import { generateMap } from '../src/generator/generate';
import { scoreMap, hasWealthGap, hasHotZone, findWealthGapAxis, computeHealth, isResourceHealthy } from '../src/generator/score';
import type { PlayerCount, Variants } from '../src/game/types';

const RUN = process.env.RUN_NEW_FLAVORS === '1';
const RUN_PLAYER_BALANCE = process.env.RUN_PLAYER_BALANCE === '1';

function variants(flavor: 'wealthGap' | 'hotZone'): Variants {
  return {
    includeDesert: true,
    desertReplacement: 'ore',
    shufflePorts: false,
    noSameNumberAdjacent: true,
    noSameNumberOnResource: true,
    noMultipleRedsOnResource: true,
    challenge: { flavor, targetResource: 'any' },
  };
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

describe('new challenge flavors', () => {
  it.runIf(RUN)('wealthGap + hotZone empirical validation', () => {
    const N = Number(process.env.SAMPLES ?? 200);

    for (const flavor of ['wealthGap', 'hotZone'] as const) {
      console.log(`\n=========================== flavor=${flavor} (n=${N}) ===========================`);
      for (const pc of [4, 6] as const) {
        const t0 = Date.now();
        let succeeded = 0, fellBack = 0, matched = 0;
        const attempts: number[] = [];
        const fairness: number[] = [];
        let redAdjacencies = 0; // hotZone-specific signal
        let wealthConcentrations: number[] = []; // wealthGap-specific signal
        let desertsOnRichTotal = 0, desertsOnDivTotal = 0, desertsOnSparseTotal = 0;
        let mapsWithDesertOnRich = 0;
        let healthyMaps = 0;

        for (let i = 0; i < N; i++) {
          let r;
          try { r = generateMap({ playerCount: pc, variants: variants(flavor), seed: 500000 + pc * 10000 + i }); }
          catch { continue; }
          succeeded++;
          if (r.fellBack) fellBack++;
          attempts.push(r.attempts);
          const scored = scoreMap(r.map.hexes, r.map.ports, pc);
          fairness.push(scored.fairness.stdev);
          if (flavor === 'wealthGap' && hasWealthGap(r.map.hexes)) matched++;
          if (flavor === 'hotZone' && hasHotZone(r.map.hexes)) matched++;
          // Resource health (independent of whether scenario applies the check)
          const health = computeHealth(r.map.hexes);
          if (isResourceHealthy(health, r.map.hexes, pc)) healthyMaps++;
          // Verify red-adjacency actually occurs under hotZone
          if (flavor === 'hotZone') {
            const byKey = new Map(r.map.hexes.map(h => [`${h.q},${h.r}`, h] as const));
            for (const h of r.map.hexes) {
              if (h.number !== 6 && h.number !== 8) continue;
              const nbCoords = [
                { q: h.q + 1, r: h.r }, { q: h.q + 1, r: h.r - 1 },
                { q: h.q, r: h.r - 1 }, { q: h.q - 1, r: h.r },
                { q: h.q - 1, r: h.r + 1 }, { q: h.q, r: h.r + 1 },
              ];
              for (const c of nbCoords) {
                const nb = byKey.get(`${c.q},${c.r}` as const);
                if (nb && (nb.number === 6 || nb.number === 8)) { redAdjacencies++; break; }
              }
            }
          }
          // Compute the max axis-side pip concentration to characterize wealthGap maps
          if (flavor === 'wealthGap') {
            const PIP: Record<number, number> = {2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
            type Axis = (q: number, rr: number) => number;
            const axes: Axis[] = [(q,_) => q, (_,rr) => rr, (q,rr) => -q-rr];
            let maxConc = 0;
            for (const ax of axes) {
              let pos = 0, neg = 0;
              for (const h of r.map.hexes) {
                if (h.resource === 'desert' || h.number === null) continue;
                const c = ax(h.q, h.r);
                const p = PIP[h.number] ?? 0;
                if (c > 0) pos += p; else if (c < 0) neg += p;
              }
              const t = pos + neg;
              if (t > 0) maxConc = Math.max(maxConc, Math.max(pos, neg) / t);
            }
            wealthConcentrations.push(maxConc);
            // Desert placement audit
            const axisInfo = findWealthGapAxis(r.map.hexes);
            if (axisInfo) {
              const axisFn = axisInfo.axis === 'q' ? (h: { q: number; r: number }) => h.q
                : axisInfo.axis === 'r' ? (h: { q: number; r: number }) => h.r
                : (h: { q: number; r: number }) => -h.q - h.r;
              let dRich = 0, dDiv = 0, dSparse = 0;
              for (const h of r.map.hexes) {
                if (h.resource !== 'desert') continue;
                const c = axisFn(h);
                const sign = c > 0 ? 1 : c < 0 ? -1 : 0;
                if (sign === 0) dDiv++;
                else if (sign === axisInfo.richSide) dRich++;
                else dSparse++;
              }
              desertsOnRichTotal += dRich;
              desertsOnDivTotal += dDiv;
              desertsOnSparseTotal += dSparse;
              if (dRich > 0) mapsWithDesertOnRich++;
            }
          }
        }
        const elapsed = (Date.now() - t0) / 1000;

        console.log(`\n  pc=${pc}  (${elapsed.toFixed(1)}s, ${succeeded} maps)`);
        console.log(`    Acceptance: ${succeeded}/${N} (${(succeeded / N * 100).toFixed(1)}%)   Fallback: ${fellBack} (${(fellBack / Math.max(1, succeeded) * 100).toFixed(1)}%)`);
        console.log(`    Attempts:   mean=${mean(attempts).toFixed(1)}  p90=${quantile(attempts, 0.9)}  max=${Math.max(...attempts)}`);
        console.log(`    Fairness:   mean=${mean(fairness).toFixed(3)}  p90=${quantile(fairness, 0.9).toFixed(3)}  max=${Math.max(...fairness).toFixed(3)}  (challenge threshold = 1.0)`);
        console.log(`    Flavor match: ${matched}/${succeeded} (${(matched / Math.max(1, succeeded) * 100).toFixed(1)}%)`);
        console.log(`    Resource health pass: ${healthyMaps}/${succeeded} (${(healthyMaps / Math.max(1, succeeded) * 100).toFixed(1)}%)`);
        if (flavor === 'hotZone') {
          console.log(`    Avg red-with-red-neighbor count per map: ${(redAdjacencies / Math.max(1, succeeded)).toFixed(2)}`);
        }
        if (flavor === 'wealthGap') {
          console.log(`    Wealth concentration (max axis-side fraction): mean=${mean(wealthConcentrations).toFixed(3)}  p90=${quantile(wealthConcentrations, 0.9).toFixed(3)}`);
          console.log(`    Desert placement: rich=${desertsOnRichTotal}  div=${desertsOnDivTotal}  sparse=${desertsOnSparseTotal}   (maps with any desert on rich: ${mapsWithDesertOnRich}/${succeeded} = ${(mapsWithDesertOnRich / Math.max(1, succeeded) * 100).toFixed(1)}%)`);
        }
      }
    }

    expect(true).toBe(true);
  }, 30 * 60 * 1000);

  it.runIf(RUN_PLAYER_BALANCE)('player balance under wealthGap + hotZone (per-pc deltas)', () => {
    const N = Number(process.env.SAMPLES_BAL ?? 200);

    for (const flavor of ['wealthGap', 'hotZone'] as const) {
      console.log(`\n=========================== player balance: ${flavor} (n=${N}) ===========================`);
      for (const pc of [3, 4, 5, 6] as PlayerCount[]) {
        const perPlayerTotals: number[][] = Array.from({ length: pc }, () => []);
        const fairnessList: number[] = [];
        let succeeded = 0;
        const t0 = Date.now();
        for (let i = 0; i < N; i++) {
          let r;
          try { r = generateMap({ playerCount: pc, variants: variants(flavor), seed: 600000 + pc * 10000 + i }); }
          catch { continue; }
          succeeded++;
          const scored = scoreMap(r.map.hexes, r.map.ports, pc);
          fairnessList.push(scored.fairness.stdev);
          for (let p = 0; p < pc; p++) perPlayerTotals[p].push(scored.fairness.playerTotals[p]);
        }
        const elapsed = (Date.now() - t0) / 1000;
        const means = perPlayerTotals.map(xs => xs.reduce((a, b) => a + b, 0) / xs.length);
        const overall = means.reduce((a, b) => a + b, 0) / means.length;
        const deltas = means.map(m => (m - overall) / overall * 100);
        const maxAbsDelta = Math.max(...deltas.map(d => Math.abs(d)));
        const verdict = maxAbsDelta <= 4 ? '✅ GREEN' : maxAbsDelta <= 6 ? '⚠️  YELLOW' : '❌ RED';

        console.log(`\n  pc=${pc}  (${elapsed.toFixed(1)}s, ${succeeded} maps)  ${verdict}  max|Δ| = ${maxAbsDelta.toFixed(2)}%`);
        for (let p = 0; p < pc; p++) {
          const tag = p === 0 ? 'P1   ' : p === pc - 1 ? `P${p+1} ` : `P${p+1}  `;
          console.log(`    ${tag}  mean=${means[p].toFixed(2)}   Δ=${deltas[p].toFixed(2)}%`);
        }
        console.log(`    Fairness stdev mean: ${(fairnessList.reduce((a, b) => a + b, 0) / fairnessList.length).toFixed(3)}`);
      }
    }
    expect(true).toBe(true);
  }, 30 * 60 * 1000);
});
