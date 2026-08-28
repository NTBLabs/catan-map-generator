import { create } from 'zustand';
import { generateMap } from '../generator/generate';
import type { ScoredMap } from '../generator/score';
import { scoreMap } from '../generator/score';
import type {
  ChallengeFlavor,
  MapState,
  PlayerCount,
  ProducingResource,
  Variants,
} from '../game/types';
import { decodeMapState, writeMapToUrl } from '../url/encode';

const defaultVariants = (): Variants => ({
  includeDesert: true,
  desertReplacement: 'ore',
  shufflePorts: false,
  noSameNumberAdjacent: true,
  noSameNumberOnResource: true,
  noMultipleRedsOnResource: true,
  challenge: {
    flavor: 'none',
    targetResource: 'any',
  },
});

interface AppState {
  map: MapState | null;
  scored: ScoredMap | null;
  playerCount: PlayerCount;
  variants: Variants;
  /** Board overlay: top-N picks, spot value badges, synergy icons. */
  showBestLocations: boolean;
  /** Control-panel readouts: per-resource pip totals + snake-draft fairness. */
  showResourceHealth: boolean;
  /** Deeper diagnostic panels: adjacent-resource pairs, strategic viability,
   *  top-20 archetype mix, top port-economy openings, port hinterland support. */
  showAdvancedDiagnostics: boolean;
  /** Pure view-only toggle — does NOT affect generation or shareable URL. */
  waterFrame: boolean;
  /** View-only rotation in degrees (0, 60, 120, ...). Not persisted. */
  rotation: number;
  /** Mobile options drawer open state. In the store rather than local to
   *  Controls because Board reacts to it too: an open drawer covers most
   *  of the board, so Board lifts its container to keep the top tile row
   *  visible (see ui/openLift.ts). Meaningless on desktop, where the
   *  panel is always visible. */
  drawerOpen: boolean;
  generating: boolean;
  fellBack: boolean;
  attempts: number;

  setPlayerCount: (n: PlayerCount) => void;
  setVariants: (patch: Partial<Variants>) => void;
  setChallenge: (flavor: ChallengeFlavor, target?: ProducingResource | 'any') => void;
  toggleShowBestLocations: () => void;
  toggleShowResourceHealth: () => void;
  toggleShowAdvancedDiagnostics: () => void;
  toggleWaterFrame: () => void;
  rotateBy: (delta: number) => void;
  resetRotation: () => void;
  setDrawerOpen: (open: boolean) => void;
  generate: () => void;
  loadFromUrl: (encoded: string) => boolean;
}

function rescore(map: MapState): ScoredMap {
  return scoreMap(map.hexes, map.ports, map.playerCount);
}

/** A scarcity target that is also the desert-replacement resource is
 *  contradictory: the variant adds a tile of the resource and the scenario
 *  then has to starve it. The 2026-08-27 feasibility probe measured that
 *  combination at a 23% fallback rate (the only cell that misses the 5000
 *  attempt budget), so the picker forbids it in both selection orders
 *  rather than the generator papering over it. The most recent selection
 *  wins and the older side yields:
 *    - picking the conflicting scarcity target moves the replacement off it
 *      (to ore, the default, or wheat when ore itself is the target)
 *    - picking the conflicting replacement (or turning the desert off, or
 *      switching flavor to scarcity with the conflict latent) releases the
 *      target back to 'any', which re-rolls per attempt and self-heals.
 *  playerCount is deliberately ignored: at 5-6 players the generator forces
 *  the deserts on and no real conflict exists, but reconciling the stored
 *  variants anyway keeps them valid if the player count drops back to 4. */
function reconcileScarcityTarget(v: Variants, changed: 'target' | 'board'): Variants {
  const conflict =
    v.challenge.flavor === 'scarcity' &&
    !v.includeDesert &&
    v.challenge.targetResource !== 'any' &&
    v.challenge.targetResource === v.desertReplacement;
  if (!conflict) return v;
  if (changed === 'target') {
    const replacement: ProducingResource = v.challenge.targetResource === 'ore' ? 'wheat' : 'ore';
    return { ...v, desertReplacement: replacement };
  }
  return { ...v, challenge: { ...v.challenge, targetResource: 'any' } };
}

export const useAppStore = create<AppState>((set, get) => ({
  map: null,
  scored: null,
  playerCount: 4,
  variants: defaultVariants(),
  showBestLocations: false,
  showResourceHealth: false,
  showAdvancedDiagnostics: false,
  waterFrame: true,
  rotation: 0,
  drawerOpen: false,
  generating: false,
  fellBack: false,
  attempts: 0,

  setPlayerCount: (n) => set({ playerCount: n }),
  setVariants: (patch) => set(s => ({
    variants: reconcileScarcityTarget({ ...s.variants, ...patch }, 'board'),
  })),
  setChallenge: (flavor, target) => set(s => ({
    variants: reconcileScarcityTarget(
      {
        ...s.variants,
        challenge: {
          ...s.variants.challenge,
          flavor,
          targetResource: target ?? s.variants.challenge.targetResource,
        },
      },
      // An explicit target pick wins over the stored replacement; a bare
      // flavor switch that surfaces a latent conflict releases the target.
      target !== undefined && target !== 'any' ? 'target' : 'board',
    ),
  })),
  toggleShowBestLocations: () => set(s => ({ showBestLocations: !s.showBestLocations })),
  toggleShowResourceHealth: () => set(s => ({ showResourceHealth: !s.showResourceHealth })),
  toggleShowAdvancedDiagnostics: () => set(s => ({ showAdvancedDiagnostics: !s.showAdvancedDiagnostics })),
  toggleWaterFrame: () => set(s => ({ waterFrame: !s.waterFrame })),
  rotateBy: (delta) => set(s => ({ rotation: (((s.rotation + delta) % 360) + 360) % 360 })),
  resetRotation: () => set({ rotation: 0 }),
  setDrawerOpen: (open) => set({ drawerOpen: open }),

  generate: () => {
    set({ generating: true });
    // Defer the blocking generation work to the next event-loop tick so
    // React has a chance to PAINT the "generating" state before the main
    // thread freezes. Without this, the spinner is invisible at pc=6
    // hotZone (~1.3s blocking) because `set` + the sync work happen in
    // the same microtask and React batches them into one render. CSS
    // keyframe animations on the spinner keep running on the compositor
    // thread even while JS is blocked, so the indicator actually animates.
    setTimeout(() => {
      const { playerCount, variants } = get();
      try {
        const result = generateMap({ playerCount, variants });
        const scored = rescore(result.map);
        set({
          map: result.map,
          scored,
          attempts: result.attempts,
          fellBack: result.fellBack,
          generating: false,
          variants: result.map.variants,
        });
        writeMapToUrl(result.map);
      } catch (err) {
        console.error(err);
        set({ generating: false });
      }
    }, 0);
  },

  loadFromUrl: (encoded) => {
    try {
      const map = decodeMapState(encoded);
      const scored = rescore(map);
      set({
        map,
        scored,
        playerCount: map.playerCount,
        variants: map.variants,
        attempts: 0,
        fellBack: false,
      });
      return true;
    } catch (err) {
      console.error('Failed to load map from URL', err);
      return false;
    }
  },
}));
