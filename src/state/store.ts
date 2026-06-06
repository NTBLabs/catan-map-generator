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
  /** Control-panel readouts: per-resource health + snake-draft fairness. */
  showResourceHealth: boolean;
  /** Pure view-only toggle — does NOT affect generation or shareable URL. */
  waterFrame: boolean;
  /** View-only rotation in degrees (0, 60, 120, ...). Not persisted. */
  rotation: number;
  generating: boolean;
  fellBack: boolean;
  attempts: number;

  setPlayerCount: (n: PlayerCount) => void;
  setVariants: (patch: Partial<Variants>) => void;
  setChallenge: (flavor: ChallengeFlavor, target?: ProducingResource | 'any') => void;
  toggleShowBestLocations: () => void;
  toggleShowResourceHealth: () => void;
  toggleWaterFrame: () => void;
  rotateBy: (delta: number) => void;
  resetRotation: () => void;
  generate: () => void;
  loadFromUrl: (encoded: string) => boolean;
}

function rescore(map: MapState): ScoredMap {
  return scoreMap(map.hexes, map.ports, map.playerCount);
}

export const useAppStore = create<AppState>((set, get) => ({
  map: null,
  scored: null,
  playerCount: 4,
  variants: defaultVariants(),
  showBestLocations: false,
  showResourceHealth: false,
  waterFrame: true,
  rotation: 0,
  generating: false,
  fellBack: false,
  attempts: 0,

  setPlayerCount: (n) => set({ playerCount: n }),
  setVariants: (patch) => set(s => ({ variants: { ...s.variants, ...patch } })),
  setChallenge: (flavor, target) => set(s => ({
    variants: {
      ...s.variants,
      challenge: {
        ...s.variants.challenge,
        flavor,
        targetResource: target ?? s.variants.challenge.targetResource,
      },
    },
  })),
  toggleShowBestLocations: () => set(s => ({ showBestLocations: !s.showBestLocations })),
  toggleShowResourceHealth: () => set(s => ({ showResourceHealth: !s.showResourceHealth })),
  toggleWaterFrame: () => set(s => ({ waterFrame: !s.waterFrame })),
  rotateBy: (delta) => set(s => ({ rotation: (((s.rotation + delta) % 360) + 360) % 360 })),
  resetRotation: () => set({ rotation: 0 }),

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
