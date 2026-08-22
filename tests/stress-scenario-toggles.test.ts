/** Scenario × toggle sweep
 *
 *  Investigates whether the three hard-constraint toggles
 *    - noSameNumberAdjacent (NSNA)
 *    - noSameNumberOnResource (NSNoR)
 *    - noMultipleRedsOnResource (NMR)
 *  help or hurt the new wealthGap / hotZone scenarios.
 *
 *  For each scenario × player count × toggle combo, generate N maps and
 *  report: acceptance, fallback, attempts (mean / p90 / max), fairness
 *  (mean / p90), max |per-player delta|, flavor match rate. Verdict logic
 *  at the end flags any combo that clearly beats the default on multiple
 *  axes — those are candidates for forced defaults in scenario mode.
 *
 *  RUN_SCENARIO_TOGGLES=1 npx vitest run tests/stress-scenario-toggles.test.ts
 */
import { describe, it, expect } from 'vitest';
import { generateMap } from '../src/generator/generate';
import { scoreMap, hasWealthGap, hasHotZone } from '../src/generator/score';
import type { PlayerCount, Variants } from '../src/game/types';

const RUN = process.env.RUN_SCENARIO_TOGGLES === '1';

interface ToggleCombo {
  label: string;
  nsna: boolean;
  nsnor: boolean;
  nmr: boolean;
}

const COMBOS: ToggleCombo[] = [
  { label: 'all on (default)',     nsna: true,  nsnor: true,  nmr: true  },
  { label: 'NSNA off',             nsna: false, nsnor: true,  nmr: true  },
  { label: 'NSNoR off',            nsna: true,  nsnor: false, nmr: true  },
  { label: 'NMR off',              nsna: true,  nsnor: true,  nmr: false },
  { label: 'NSNA + NSNoR off',     nsna: false, nsnor: false, nmr: true  },
  { label: 'NSNA + NMR off',       nsna: false, nsnor: true,  nmr: false },
  { label: 'NSNoR + NMR off',      nsna: true,  nsnor: false, nmr: false },
  { label: 'all off',              nsna: false, nsnor: false, nmr: false },
];

function buildVariants(flavor: 'wealthGap' | 'hotZone', combo: ToggleCombo): Variants {
  return {
    includeDesert: true,
    desertReplacement: 'ore',
    shufflePorts: false,
    noSameNumberAdjacent: combo.nsna,
    noSameNumberOnResource: combo.nsnor,
    noMultipleRedsOnResource: combo.nmr,
    challenge: { flavor, targetResource: 'any' },
  };
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

interface CellResult {
  combo: string;
  scenario: 'wealthGap' | 'hotZone';
  pc: PlayerCount;
  succeeded: number;
  fellBack: number;
  attemptsMean: number;
  attemptsP90: number;
  attemptsMax: number;
  fairnessMean: number;
  fairnessP90: number;
  maxAbsDelta: number;
  matchRate: number;
  elapsedSec: number;
}

describe('scenario × toggle sweep', () => {
  it.runIf(RUN)('quantify toggle impact on wealthGap + hotZone', () => {
    const N_PC4 = Number(process.env.SAMPLES_PC4 ?? 100);
    const N_PC6 = Number(process.env.SAMPLES_PC6 ?? 60);
    const results: CellResult[] = [];

    for (const scenario of ['wealthGap', 'hotZone'] as const) {
      for (const pc of [4, 6] as PlayerCount[]) {
        const N = pc === 4 ? N_PC4 : N_PC6;
        console.log(`\n┌─────────────────────────────────────────────────────────────────────────┐`);
        console.log(`│ ${scenario.padEnd(10)}   pc=${pc}   n=${N} per combo                                  │`);
        console.log(`└─────────────────────────────────────────────────────────────────────────┘`);
        console.log(`  ${'combo'.padEnd(22)}  accept  fbck%  attempts(mean/p90/max)  fair(mean/p90)  Δmax%  match%   time`);

        for (const combo of COMBOS) {
          const variants = buildVariants(scenario, combo);
          const t0 = Date.now();
          let succeeded = 0;
          let fellBack = 0;
          let matched = 0;
          const attempts: number[] = [];
          const fairness: number[] = [];
          const perPlayerTotals: number[][] = Array.from({ length: pc }, () => []);

          for (let i = 0; i < N; i++) {
            let r;
            try {
              r = generateMap({ playerCount: pc, variants, seed: 300000 + i });
            } catch { continue; }
            succeeded++;
            if (r.fellBack) fellBack++;
            attempts.push(r.attempts);
            const scored = scoreMap(r.map.hexes, r.map.ports, pc);
            fairness.push(scored.fairness.stdev);
            for (let p = 0; p < pc; p++) perPlayerTotals[p].push(scored.fairness.playerTotals[p]);
            if (scenario === 'wealthGap' && hasWealthGap(r.map.hexes)) matched++;
            if (scenario === 'hotZone' && hasHotZone(r.map.hexes)) matched++;
          }
          const elapsed = (Date.now() - t0) / 1000;

          const means = perPlayerTotals.map(mean);
          const overall = means.length ? means.reduce((a, b) => a + b, 0) / means.length : 0;
          const deltas = overall > 0 ? means.map(m => ((m - overall) / overall) * 100) : means.map(() => 0);
          const maxAbsDelta = deltas.length ? Math.max(...deltas.map(d => Math.abs(d))) : 0;

          const cell: CellResult = {
            combo: combo.label,
            scenario,
            pc,
            succeeded,
            fellBack,
            attemptsMean: mean(attempts),
            attemptsP90: quantile(attempts, 0.9),
            attemptsMax: attempts.length ? Math.max(...attempts) : 0,
            fairnessMean: mean(fairness),
            fairnessP90: quantile(fairness, 0.9),
            maxAbsDelta,
            matchRate: succeeded > 0 ? (matched / succeeded) * 100 : 0,
            elapsedSec: elapsed,
          };
          results.push(cell);

          const acc = `${succeeded}/${N}`.padStart(7);
          const fb = `${(fellBack / Math.max(1, succeeded) * 100).toFixed(0)}%`.padStart(5);
          const att = `${cell.attemptsMean.toFixed(0).padStart(4)}/${String(cell.attemptsP90).padStart(4)}/${String(cell.attemptsMax).padStart(4)}`;
          const fair = `${cell.fairnessMean.toFixed(2)}/${cell.fairnessP90.toFixed(2)}`;
          const dlt = `${cell.maxAbsDelta.toFixed(2)}%`.padStart(6);
          const mat = `${cell.matchRate.toFixed(0)}%`.padStart(5);
          const t = `${elapsed.toFixed(1)}s`.padStart(6);
          console.log(`  ${combo.label.padEnd(22)} ${acc}  ${fb}   ${att}        ${fair}    ${dlt}   ${mat}  ${t}`);
        }
      }
    }

    // Final verdict synthesis
    console.log(`\n┌══════════════════════════════════════════════════════════════════════════┐`);
    console.log(`│ TOGGLE IMPACT SUMMARY                                                    │`);
    console.log(`└══════════════════════════════════════════════════════════════════════════┘`);
    for (const scenario of ['wealthGap', 'hotZone'] as const) {
      for (const pc of [4, 6] as PlayerCount[]) {
        const cells = results.filter(r => r.scenario === scenario && r.pc === pc);
        if (cells.length === 0) continue;
        const baseline = cells.find(c => c.combo === 'all on (default)')!;
        console.log(`\n  ${scenario} pc=${pc} — vs default baseline (attempts ${baseline.attemptsMean.toFixed(0)}, fairness ${baseline.fairnessMean.toFixed(3)}, Δmax ${baseline.maxAbsDelta.toFixed(2)}%):`);
        for (const c of cells) {
          if (c.combo === 'all on (default)') continue;
          const attemptsΔ = ((c.attemptsMean - baseline.attemptsMean) / baseline.attemptsMean) * 100;
          const fairnessΔ = c.fairnessMean - baseline.fairnessMean;
          const deltaΔ = c.maxAbsDelta - baseline.maxAbsDelta;
          const matchΔ = c.matchRate - baseline.matchRate;
          const flags: string[] = [];
          if (attemptsΔ < -20) flags.push(`✓ ${(-attemptsΔ).toFixed(0)}% faster`);
          if (attemptsΔ > 30) flags.push(`✗ ${attemptsΔ.toFixed(0)}% slower`);
          if (fairnessΔ < -0.05) flags.push(`✓ fairness ${fairnessΔ.toFixed(2)}`);
          if (fairnessΔ > 0.05) flags.push(`✗ fairness +${fairnessΔ.toFixed(2)}`);
          if (deltaΔ < -0.5) flags.push(`✓ Δmax ${deltaΔ.toFixed(2)}pp`);
          if (deltaΔ > 0.5) flags.push(`✗ Δmax +${deltaΔ.toFixed(2)}pp`);
          if (matchΔ < -5) flags.push(`✗ match ${matchΔ.toFixed(0)}pp`);
          console.log(`    ${c.combo.padEnd(22)}  attempts ${attemptsΔ >= 0 ? '+' : ''}${attemptsΔ.toFixed(0)}%   ${flags.join('  ')}`);
        }
      }
    }

    expect(true).toBe(true);
  }, 60 * 60 * 1000);
});
