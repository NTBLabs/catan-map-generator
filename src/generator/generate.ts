import { FAIRNESS_THRESHOLD, FAIRNESS_THRESHOLD_BALANCED, MAX_ATTEMPTS, PRODUCING_RESOURCES } from '../game/constants';
import type {
  ChallengeRolled,
  Hex,
  MapState,
  PlayerCount,
  Port,
  ProducingResource,
  Variants,
  WealthGapTarget,
} from '../game/types';
import { checkHardConstraints } from './constraints';
import { mulberry32, makeSeed, pick } from './random';
import { randomizeMap, type SpreadHighYieldMode } from './randomize';
import {
  arePortsBalanced,
  computeHealth,
  DEFAULT_SCARCITY_CONFIG,
  findHotZoneCluster,
  hasBalancedPipDistribution,
  hasDroughtCluster,
  hasStrategicDiversity,
  hasWealthGap,
  isResourceHealthy,
  scoreMap,
  type ScarcityConfig,
} from './score';

export interface GenerateOptions {
  playerCount: PlayerCount;
  variants: Variants;
  seed?: number;
  maxAttempts?: number;
  /** Override the scarcityBonus weights — for controlled experiments only. */
  scarcityConfig?: ScarcityConfig;
  /** Override the high-yield placement strategy — for controlled experiments. */
  spreadHighYieldMode?: SpreadHighYieldMode;
}

export interface GenerateResult {
  map: MapState;
  attempts: number;
  fellBack: boolean;
}

export function generateMap(opts: GenerateOptions): GenerateResult {
  const seed = opts.seed ?? makeSeed();
  const rng = mulberry32(seed);
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  // Balanced mode (no challenge flavor) uses the strict threshold so player
  // picks come out tight. Challenge modes deliberately introduce imbalance,
  // so they keep the looser 1.0 threshold.
  const isBalanced = opts.variants.challenge.flavor === 'none';
  const threshold = (isBalanced ? FAIRNESS_THRESHOLD_BALANCED : FAIRNESS_THRESHOLD)[opts.playerCount];
  let best: { hexes: Hex[]; ports: Port[]; score: number; rolled?: ChallengeRolled; rolledTarget?: ProducingResource } | null = null;
  let hardOnlyFallback: { hexes: Hex[]; ports: Port[] } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Resolve challenge BEFORE placement so hotZone can disable the no-red-
    // adjacency rule and wealthGap can target a specific axis. Each attempt
    // re-resolves so 'random' flavor can roll different kinds per attempt.
    const challenge = resolveChallenge(opts.variants, rng);
    const candidate = randomizeMap(
      opts.playerCount,
      opts.variants,
      rng,
      opts.spreadHighYieldMode,
      challenge.wealthGapTarget,
    );
    const hard = checkHardConstraints(candidate.hexes, candidate.ports, {
      noSameNumberAdjacent: opts.variants.noSameNumberAdjacent,
      noSameNumberOnResource: opts.variants.noSameNumberOnResource,
      noMultipleRedsOnResource: opts.variants.noMultipleRedsOnResource,
      allowRedAdjacency: challenge.kind === 'hotZone',
    });
    if (!hard.ok) continue;
    if (!hardOnlyFallback) hardOnlyFallback = { hexes: candidate.hexes, ports: candidate.ports };

    if (!challengeMatches(candidate.hexes, candidate.ports, opts.playerCount, challenge)) continue;

    const scored = scoreMap(
      candidate.hexes, candidate.ports, opts.playerCount,
      opts.scarcityConfig ?? DEFAULT_SCARCITY_CONFIG,
    );
    // Archetype diversity is checked post-scoring (it needs spot.archetype).
    // Only enforced in balanced mode — challenge modes intentionally bias
    // the strategic landscape (drought = no expansion, scarcity = nothing
    // but city rush, etc.) and shouldn't be rejected for narrowness.
    if (challenge.kind === 'none' && !hasStrategicDiversity(scored)) continue;
    const fairnessOk = scored.fairness.stdev <= threshold;
    const score = scored.fairness.stdev;

    if (!best || score < best.score) {
      best = {
        hexes: candidate.hexes,
        ports: candidate.ports,
        score,
        rolled: challenge.kind === 'none' ? undefined : challenge.kind,
        rolledTarget: challenge.target,
      };
    }
    if (fairnessOk) {
      const variants: Variants = {
        ...opts.variants,
        challenge: {
          ...opts.variants.challenge,
          rolledFlavor: challenge.kind === 'none' ? undefined : challenge.kind,
          rolledTarget: challenge.target,
        },
      };
      return {
        map: { playerCount: opts.playerCount, hexes: candidate.hexes, ports: candidate.ports, variants, seed },
        attempts: attempt,
        fellBack: false,
      };
    }
  }

  if (best) {
    const variants: Variants = {
      ...opts.variants,
      challenge: { ...opts.variants.challenge, rolledFlavor: best.rolled, rolledTarget: best.rolledTarget },
    };
    return {
      map: { playerCount: opts.playerCount, hexes: best.hexes, ports: best.ports, variants, seed },
      attempts: maxAttempts,
      fellBack: true,
    };
  }
  if (hardOnlyFallback) {
    return {
      map: {
        playerCount: opts.playerCount,
        hexes: hardOnlyFallback.hexes,
        ports: hardOnlyFallback.ports,
        variants: opts.variants,
        seed,
      },
      attempts: maxAttempts,
      fellBack: true,
    };
  }
  throw new Error('Generator failed to produce any candidate satisfying hard constraints');
}

interface ResolvedChallenge {
  kind: 'none' | ChallengeRolled;
  target?: ProducingResource;
  /** wealthGap-specific: which axis cuts the board and which side is rich.
   *  Decided at challenge-resolution time so number placement can bias
   *  high-pip tokens to the rich side. */
  wealthGapTarget?: WealthGapTarget;
}

function resolveChallenge(variants: Variants, rng: () => number): ResolvedChallenge {
  const flavor = variants.challenge.flavor;
  if (flavor === 'none') return { kind: 'none' };
  let kind: ChallengeRolled;
  if (flavor === 'random') {
    kind = pick<ChallengeRolled>(['scarcity', 'boomOrBust', 'drought', 'wealthGap', 'hotZone'], rng);
  } else {
    kind = flavor;
  }
  let target: ProducingResource | undefined;
  if (kind === 'scarcity' || kind === 'boomOrBust') {
    const pickedTarget = variants.challenge.targetResource;
    target = pickedTarget === 'any' || flavor === 'random'
      ? pick(PRODUCING_RESOURCES, rng)
      : pickedTarget;
  }
  let wealthGapTarget: WealthGapTarget | undefined;
  if (kind === 'wealthGap') {
    wealthGapTarget = {
      axis: pick<'q' | 'r' | 's'>(['q', 'r', 's'], rng),
      richSide: pick<1 | -1>([1, -1], rng),
    };
  }
  return { kind, target, wealthGapTarget };
}

function challengeMatches(
  hexes: Hex[],
  ports: Port[],
  playerCount: PlayerCount,
  challenge: ResolvedChallenge,
): boolean {
  if (challenge.kind === 'none') {
    const health = computeHealth(hexes);
    if (!isResourceHealthy(health, hexes, playerCount)) return false;
    if (!arePortsBalanced(ports, hexes)) return false;
    if (!hasBalancedPipDistribution(hexes)) return false;
    return true;
  }
  const health = computeHealth(hexes);
  if (challenge.kind === 'scarcity') {
    const targetHealth = health.find(h => h.resource === challenge.target);
    return !!targetHealth && targetHealth.totalPips <= 4;
  }
  if (challenge.kind === 'boomOrBust') {
    const targetHealth = health.find(h => h.resource === challenge.target);
    return !!targetHealth && targetHealth.concentration >= 0.6 && targetHealth.totalPips >= 5;
  }
  if (challenge.kind === 'drought') {
    return hasDroughtCluster(hexes);
  }
  // Rich vs Poor and Hot Zone are "balanced scenarios" — they shape WHERE
  // pip mass clusters geographically (Rich vs Poor) or where reds cluster
  // (Hot Zone), but they're NOT about starving a resource. Apply the
  // absolute resource-health and port-balance checks so a scenario can't
  // accidentally produce a structurally dead resource. SKIP the strict
  // per-resource pip-variance check (hasBalancedPipDistribution), which
  // these scenarios fundamentally bias against by design — Hot Zone
  // concentrates reds onto whatever resources host the cluster, and Rich
  // vs Poor's targeted placement concentrates high-pip numbers on rich-
  // side resources. Including the variance check broke Hot Zone pc=6
  // (77% fallback, 24% match). Scarcity / Boom-or-bust / Drought skip
  // both checks because their whole point is a starved or concentrated
  // resource.
  if (challenge.kind === 'wealthGap') {
    if (!hasWealthGap(hexes)) return false;
    if (!isResourceHealthy(health, hexes, playerCount)) return false;
    // Port-balance check omitted: with fixed (non-shuffled) ports at pc=6
    // it rejects a large fraction of attempts based on resource-vs-port
    // geometry that has nothing to do with the scenario's identity. The
    // resource-health check above already catches the "wood is dead" case,
    // which is the failure that actually matters for this scenario.
    return true;
  }
  if (challenge.kind === 'hotZone') {
    const cluster = findHotZoneCluster(hexes);
    if (!cluster) return false;
    // Cluster resource diversity is the ONLY structural balance check for
    // Hot Zone. The cluster must span at least 3 unique producing resources
    // so reds (and the pip mass that comes with them) spread across resource
    // types instead of dumping onto one or two.
    //
    // Why 3 at pc=6 too (not 4): noMultipleRedsOnResource caps reds at
    // ceil(6/5)=2 per resource on the expansion board. With a 5-red cluster
    // drawn from those 6 reds, the most common distribution is 2+2+1 = 3
    // distinct cluster resources. Requiring 4 forces a rare edge case
    // (one 2-red resource split half-in-half-out of cluster) and broke
    // generation (79% fallback). 3 is the practical floor that still
    // guarantees meaningful spread.
    //
    // The absolute resource-health checks (pip floor, every-resource-has-
    // a-high-yield, production-share variance) all break Hot Zone pc=6
    // because the cluster structurally steals high-yield numbers. Cluster
    // diversity is a softer guarantee.
    const minDiversity = 3;
    const clusterResources = new Set<string>();
    for (const id of cluster) {
      const hex = hexes.find(h => h.id === id);
      if (hex && hex.resource !== 'desert') clusterResources.add(hex.resource);
    }
    if (clusterResources.size < minDiversity) return false;
    // Port-balance check is intentionally omitted here: with fixed (non-
    // shuffled) port positions at pc=6, random resource placement leaves
    // a 2:1 port with no matching-resource neighbour in most attempts.
    // The cluster diversity check is sufficient as a resource-spread
    // guarantee for this scenario.
    return true;
  }
  return false;
}
