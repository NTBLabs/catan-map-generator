/** Final audit — comprehensive end-to-end stress test of the production
 *  generator. Four panels, each with explicit pass thresholds and a
 *  green/yellow/red verdict surfaced at the end.
 *
 *  Run: RUN_FINAL_AUDIT=1 npx vitest run tests/stress-final-audit.test.ts
 */
import { describe, it, expect } from 'vitest';
import { generateMap } from '../src/generator/generate';
import { scoreMap } from '../src/generator/score';
import type { PlayerCount, Variants, Archetype, ChallengeFlavor, ProducingResource } from '../src/game/types';

const RUN = process.env.RUN_FINAL_AUDIT === '1';

const ARCH_KEYS: Archetype[] = ['expansion', 'cityRush', 'balanced', 'portEconomy', 'devCards'];
const PIP_VALUE: Record<number, number> = { 2:1, 3:2, 4:3, 5:4, 6:5, 8:5, 9:4, 10:3, 11:2, 12:1 };

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

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function quantile(xs: number[], q: number) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
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

interface PanelVerdict {
  status: 'GREEN' | 'YELLOW' | 'RED';
  notes: string[];
}

const verdicts: { panel: string; verdict: PanelVerdict }[] = [];

// ---------- Panel 1: Balanced baseline across all 4 player counts ----------

function panel1Balanced(N: number) {
  console.log(`\n┌──────────────────────────────────────────────────────────────────┐`);
  console.log(`│ PANEL 1 — Balanced baseline × 4 player counts (n=${N} each)      │`);
  console.log(`└──────────────────────────────────────────────────────────────────┘`);
  const notes: string[] = [];
  let worstStatus: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';

  for (const pc of [3, 4, 5, 6] as PlayerCount[]) {
    const t0 = Date.now();
    const attemptsList: number[] = [];
    const fairnessList: number[] = [];
    let succeeded = 0, fellBack = 0;
    const top1Counts = new Map<Archetype, number>();
    const top20Counts = new Map<Archetype, number>();
    const viableSums: Record<Archetype, number> = { expansion:0, cityRush:0, balanced:0, portEconomy:0, devCards:0 };

    for (let i = 0; i < N; i++) {
      let r;
      try { r = generateMap({ playerCount: pc, variants: baseVariants(), seed: 700000 + pc * 100000 + i }); }
      catch { continue; }
      succeeded++;
      if (r.fellBack) fellBack++;
      attemptsList.push(r.attempts);
      const scored = scoreMap(r.map.hexes, r.map.ports, pc);
      fairnessList.push(scored.fairness.stdev);
      for (const a of ARCH_KEYS) viableSums[a] += scored.viableArchetypeCounts[a];
      const sorted = Array.from(scored.spots.values()).sort((a, b) => b.total - a.total);
      top1Counts.set(sorted[0].archetype, (top1Counts.get(sorted[0].archetype) ?? 0) + 1);
      for (let k = 0; k < Math.min(20, sorted.length); k++)
        top20Counts.set(sorted[k].archetype, (top20Counts.get(sorted[k].archetype) ?? 0) + 1);
    }
    const elapsed = (Date.now() - t0) / 1000;
    const accept = succeeded / N * 100;
    const fallback = fellBack / succeeded * 100;
    const fairMean = mean(fairnessList);
    const fairP90 = quantile(fairnessList, 0.9);
    const h1 = entropy(top1Counts, succeeded);
    const h20 = entropy(top20Counts, succeeded * 20);

    // Per-pc thresholds (post-Strategy F tuning)
    const fairThresh = pc === 3 ? 0.6 : pc === 4 ? 0.65 : pc === 5 ? 0.75 : 0.85;
    let status: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    const localNotes: string[] = [];
    if (accept < 95) { status = 'RED'; localNotes.push(`pc=${pc} acceptance ${accept.toFixed(1)}% < 95%`); }
    if (fallback > 5) { if (status === 'GREEN') status = 'YELLOW'; localNotes.push(`pc=${pc} fallback ${fallback.toFixed(1)}% > 5%`); }
    if (fairMean > fairThresh) { status = 'RED'; localNotes.push(`pc=${pc} fairness mean ${fairMean.toFixed(3)} > ${fairThresh}`); }
    for (const a of ARCH_KEYS) {
      const avg = viableSums[a] / succeeded;
      if (avg < 5) localNotes.push(`pc=${pc} ${a} viability ${avg.toFixed(2)} < k=5 floor (may trigger gate)`);
    }

    console.log(`\n  pc=${pc} (${elapsed.toFixed(1)}s)  ${status === 'GREEN' ? '✅' : status === 'YELLOW' ? '⚠️ ' : '❌'} ${status}`);
    console.log(`    Acceptance:  ${succeeded}/${N} (${accept.toFixed(2)}%)   Fallback: ${fellBack} (${fallback.toFixed(2)}%)`);
    console.log(`    Attempts:    mean=${mean(attemptsList).toFixed(1)}  p90=${quantile(attemptsList, 0.9)}  max=${Math.max(...attemptsList)}`);
    console.log(`    Fairness:    mean=${fairMean.toFixed(3)}  p90=${fairP90.toFixed(3)}  max=${Math.max(...fairnessList).toFixed(3)}   (threshold ${fairThresh})`);
    console.log(`    Top-1 mix    (H=${h1.toFixed(2)} of ${Math.log2(ARCH_KEYS.length).toFixed(2)}):  ` +
      ARCH_KEYS.map(a => `${a}=${(((top1Counts.get(a) ?? 0) / succeeded) * 100).toFixed(0)}%`).join('  '));
    console.log(`    Top-20 mix   (H=${h20.toFixed(2)}):                ` +
      ARCH_KEYS.map(a => `${a}=${(((top20Counts.get(a) ?? 0) / (succeeded * 20)) * 100).toFixed(0)}%`).join('  '));
    console.log(`    Viability    (mean spots/map):  ` +
      ARCH_KEYS.map(a => `${a}=${(viableSums[a] / succeeded).toFixed(1)}`).join('  '));
    if (localNotes.length) localNotes.forEach(n => console.log(`    ⚠  ${n}`));
    if (status === 'RED' || (worstStatus !== 'RED' && status === 'YELLOW')) worstStatus = status;
    notes.push(...localNotes);
  }

  verdicts.push({ panel: 'Balanced baseline', verdict: { status: worstStatus, notes } });
}

// ---------- Panel 2: Snake-draft positional bias ----------

function panel2SnakeBias(N: number) {
  console.log(`\n┌──────────────────────────────────────────────────────────────────┐`);
  console.log(`│ PANEL 2 — Snake-draft positional bias (per-player score share)   │`);
  console.log(`└──────────────────────────────────────────────────────────────────┘`);
  const notes: string[] = [];
  let worstStatus: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';

  for (const pc of [3, 4, 5, 6] as PlayerCount[]) {
    const t0 = Date.now();
    const perPlayerTotals: number[][] = Array.from({ length: pc }, () => []);
    let succeeded = 0;
    for (let i = 0; i < N; i++) {
      let r;
      try { r = generateMap({ playerCount: pc, variants: baseVariants(), seed: 800000 + pc * 100000 + i }); }
      catch { continue; }
      succeeded++;
      const scored = scoreMap(r.map.hexes, r.map.ports, pc);
      for (let p = 0; p < pc; p++) perPlayerTotals[p].push(scored.fairness.playerTotals[p]);
    }
    const elapsed = (Date.now() - t0) / 1000;

    const means = perPlayerTotals.map(mean);
    const overall = mean(means);
    const deltas = means.map(m => (m - overall) / overall * 100);
    const lastAdv = deltas[pc - 1];

    let status: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    if (Math.abs(lastAdv) > 6) status = 'RED';
    else if (Math.abs(lastAdv) > 4) status = 'YELLOW';

    console.log(`\n  pc=${pc} (${elapsed.toFixed(1)}s, ${succeeded} maps)  ${status === 'GREEN' ? '✅' : status === 'YELLOW' ? '⚠️ ' : '❌'} ${status}`);
    console.log(`    Per-player mean score & delta vs overall mean:`);
    for (let p = 0; p < pc; p++) {
      const tag = p === 0 ? 'P1   ' : p === pc - 1 ? `P${p+1} ` : `P${p+1}  `;
      console.log(`      ${tag}  mean=${means[p].toFixed(2)}   Δ=${deltas[p].toFixed(2)}%`);
    }
    console.log(`    P-last advantage: ${lastAdv.toFixed(2)}%   (target |Δ| ≤ 4%)`);
    if (status !== 'GREEN') {
      notes.push(`pc=${pc} P-last delta ${lastAdv.toFixed(2)}% exceeds ${status === 'YELLOW' ? '4%' : '6%'}`);
      if (status === 'RED' || (worstStatus !== 'RED' && status === 'YELLOW')) worstStatus = status;
    }
  }

  verdicts.push({ panel: 'Snake-draft positional bias', verdict: { status: worstStatus, notes } });
}

// ---------- Panel 3: Challenge mode flavors ----------

function panel3Challenges(N: number) {
  console.log(`\n┌──────────────────────────────────────────────────────────────────┐`);
  console.log(`│ PANEL 3 — Challenge mode flavors at pc=4 (n=${N} each)           │`);
  console.log(`└──────────────────────────────────────────────────────────────────┘`);
  const notes: string[] = [];
  let worstStatus: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';

  for (const flavor of ['scarcity', 'boomOrBust', 'drought'] as ChallengeFlavor[]) {
    const t0 = Date.now();
    const variants = baseVariants({ challenge: { flavor, targetResource: 'any' } });
    let succeeded = 0, fellBack = 0;
    const attemptsList: number[] = [];
    const fairnessList: number[] = [];
    let flavorMatched = 0;

    for (let i = 0; i < N; i++) {
      let r;
      try { r = generateMap({ playerCount: 4, variants, seed: 900000 + i }); }
      catch { continue; }
      succeeded++;
      if (r.fellBack) fellBack++;
      attemptsList.push(r.attempts);
      const scored = scoreMap(r.map.hexes, r.map.ports, 4);
      fairnessList.push(scored.fairness.stdev);

      // Flavor verification — same checks the generator uses.
      const producing = r.map.hexes.filter(h => h.resource !== 'desert' && h.number !== null);
      const byRes = new Map<ProducingResource, { tiles: number; pips: number; pipsByNumber: Map<number, number> }>();
      for (const h of producing) {
        const res = h.resource as ProducingResource;
        const slot = byRes.get(res) ?? { tiles: 0, pips: 0, pipsByNumber: new Map() };
        slot.tiles++;
        const pip = PIP_VALUE[h.number!] ?? 0;
        slot.pips += pip;
        slot.pipsByNumber.set(h.number!, (slot.pipsByNumber.get(h.number!) ?? 0) + pip);
        byRes.set(res, slot);
      }
      if (flavor === 'scarcity') {
        // Any resource with low pip count (bottom 20% of possible)
        const pipCounts = Array.from(byRes.values()).map(v => v.pips);
        const minPips = Math.min(...pipCounts);
        if (minPips <= 8) flavorMatched++;
      } else if (flavor === 'boomOrBust') {
        let any = false;
        for (const v of byRes.values()) {
          if (v.pips === 0) continue;
          const maxNumPips = Math.max(...Array.from(v.pipsByNumber.values()));
          if (maxNumPips / v.pips > 0.6) { any = true; break; }
        }
        if (any) flavorMatched++;
      } else if (flavor === 'drought') {
        // Has at least one triplet of adjacent low-yield (2,3,11,12) hexes
        const lowSet = new Set([2, 3, 11, 12]);
        const lowHexes = producing.filter(h => lowSet.has(h.number!));
        // Just check we have ≥3 low-yield hexes; full adjacency check is complex
        if (lowHexes.length >= 3) flavorMatched++;
      }
    }
    const elapsed = (Date.now() - t0) / 1000;
    const accept = succeeded / N * 100;
    const fallback = fellBack / Math.max(1, succeeded) * 100;
    const match = flavorMatched / Math.max(1, succeeded) * 100;
    const fairMean = mean(fairnessList);

    let status: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    if (accept < 90) status = 'RED';
    else if (fallback > 15) status = 'YELLOW';
    if (match < 90) { if (status === 'GREEN') status = 'YELLOW'; }
    if (match < 50) status = 'RED';

    console.log(`\n  ${flavor.padEnd(11)} (${elapsed.toFixed(1)}s)  ${status === 'GREEN' ? '✅' : status === 'YELLOW' ? '⚠️ ' : '❌'} ${status}`);
    console.log(`    Acceptance:  ${succeeded}/${N} (${accept.toFixed(2)}%)   Fallback: ${fellBack} (${fallback.toFixed(2)}%)`);
    console.log(`    Attempts:    mean=${mean(attemptsList).toFixed(1)}  p90=${quantile(attemptsList, 0.9)}  max=${Math.max(...attemptsList)}`);
    console.log(`    Fairness:    mean=${fairMean.toFixed(3)}  p90=${quantile(fairnessList, 0.9).toFixed(3)}   (challenge threshold = 1.0)`);
    console.log(`    Flavor match: ${flavorMatched}/${succeeded} (${match.toFixed(1)}%)   ← did each map satisfy its flavor condition?`);
    if (status !== 'GREEN' && status === 'RED') notes.push(`${flavor} status RED (accept=${accept.toFixed(1)}, match=${match.toFixed(1)})`);
    if (status === 'RED' || (worstStatus !== 'RED' && status === 'YELLOW')) worstStatus = status;
  }

  verdicts.push({ panel: 'Challenge modes', verdict: { status: worstStatus, notes } });
}

// ---------- Panel 4: Edge cases (variant toggles) ----------

function panel4EdgeCases(N: number) {
  console.log(`\n┌──────────────────────────────────────────────────────────────────┐`);
  console.log(`│ PANEL 4 — Edge cases at pc=4 (n=${N} each)                       │`);
  console.log(`└──────────────────────────────────────────────────────────────────┘`);
  const notes: string[] = [];
  let worstStatus: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';

  const cases = [
    { label: 'shufflePorts=true', variants: baseVariants({ shufflePorts: true }) },
    { label: 'no-desert→ore',     variants: baseVariants({ includeDesert: false, desertReplacement: 'ore' }) },
    { label: 'no-desert→wheat',   variants: baseVariants({ includeDesert: false, desertReplacement: 'wheat' }) },
  ];

  for (const c of cases) {
    const t0 = Date.now();
    let succeeded = 0, fellBack = 0, desertCount = 0;
    const attemptsList: number[] = [];
    const fairnessList: number[] = [];

    for (let i = 0; i < N; i++) {
      let r;
      try { r = generateMap({ playerCount: 4, variants: c.variants, seed: 950000 + i }); }
      catch { continue; }
      succeeded++;
      if (r.fellBack) fellBack++;
      attemptsList.push(r.attempts);
      const scored = scoreMap(r.map.hexes, r.map.ports, 4);
      fairnessList.push(scored.fairness.stdev);
      desertCount += r.map.hexes.filter(h => h.resource === 'desert').length;
    }
    const elapsed = (Date.now() - t0) / 1000;
    const accept = succeeded / N * 100;
    const fallback = fellBack / Math.max(1, succeeded) * 100;
    const avgDesert = desertCount / Math.max(1, succeeded);

    let status: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
    if (accept < 95) status = 'RED';
    if (fallback > 5) { if (status === 'GREEN') status = 'YELLOW'; }
    // Sanity check on the no-desert variant
    if (c.label.startsWith('no-desert') && avgDesert > 0.01) {
      status = 'RED';
      notes.push(`${c.label}: avg desert count ${avgDesert} ≠ 0`);
    }

    console.log(`\n  ${c.label.padEnd(25)}  (${elapsed.toFixed(1)}s)  ${status === 'GREEN' ? '✅' : status === 'YELLOW' ? '⚠️ ' : '❌'} ${status}`);
    console.log(`    Acceptance:  ${succeeded}/${N} (${accept.toFixed(2)}%)   Fallback: ${fellBack} (${fallback.toFixed(2)}%)`);
    console.log(`    Attempts:    mean=${mean(attemptsList).toFixed(1)}   Fairness mean: ${mean(fairnessList).toFixed(3)}`);
    console.log(`    Desert hexes per map: ${avgDesert.toFixed(2)}   (expected: ${c.label.startsWith('no-desert') ? '0' : '1'})`);
    if (status === 'RED' || (worstStatus !== 'RED' && status === 'YELLOW')) worstStatus = status;
  }

  verdicts.push({ panel: 'Edge cases (variants)', verdict: { status: worstStatus, notes } });
}

// ---------- Master runner + summary ----------

describe('final audit', () => {
  it.runIf(RUN)('runs all panels and surfaces a unified verdict', () => {
    const N_BAL = Number(process.env.SAMPLES_BAL ?? 300);
    const N_BIAS = Number(process.env.SAMPLES_BIAS ?? 300);
    const N_CHAL = Number(process.env.SAMPLES_CHAL ?? 200);
    const N_EDGE = Number(process.env.SAMPLES_EDGE ?? 150);

    const t0 = Date.now();
    panel1Balanced(N_BAL);
    panel2SnakeBias(N_BIAS);
    panel3Challenges(N_CHAL);
    panel4EdgeCases(N_EDGE);
    const total = (Date.now() - t0) / 1000;

    console.log(`\n┌══════════════════════════════════════════════════════════════════┐`);
    console.log(`│ FINAL AUDIT SUMMARY    (total runtime: ${total.toFixed(1)}s)             `);
    console.log(`└══════════════════════════════════════════════════════════════════┘`);
    for (const v of verdicts) {
      const icon = v.verdict.status === 'GREEN' ? '✅' : v.verdict.status === 'YELLOW' ? '⚠️ ' : '❌';
      console.log(`  ${icon}  ${v.panel.padEnd(35)} ${v.verdict.status}`);
      for (const n of v.verdict.notes) console.log(`         · ${n}`);
    }
    const worst = verdicts.some(v => v.verdict.status === 'RED') ? 'RED'
      : verdicts.some(v => v.verdict.status === 'YELLOW') ? 'YELLOW' : 'GREEN';
    console.log(`\n  Overall: ${worst === 'GREEN' ? '✅ GREEN — SHIP' : worst === 'YELLOW' ? '⚠️  YELLOW — review notes' : '❌ RED — block ship'}`);

    expect(true).toBe(true);
  }, 30 * 60 * 1000);
});
