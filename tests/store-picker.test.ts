import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../src/state/store';
import type { Variants } from '../src/game/types';

// Picker restriction: the scarcity target and the desert-replacement
// resource can never be the same, in either selection order. The
// combination is contradictory (add a tile of the resource, then starve
// it) and was the one cell the 2026-08-27 feasibility probe showed missing
// the 5000-attempt budget (23% fallback). The most recent selection wins.

function freshVariants(): Variants {
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

describe('scarcity target vs desert replacement picker restriction', () => {
  beforeEach(() => {
    useAppStore.setState({ variants: freshVariants(), playerCount: 4 });
  });

  it('picking the conflicting scarcity target moves the replacement to ore', () => {
    const s = useAppStore.getState();
    s.setVariants({ includeDesert: false, desertReplacement: 'wood' });
    s.setChallenge('scarcity', 'wood');
    const v = useAppStore.getState().variants;
    expect(v.challenge.targetResource).toBe('wood');
    expect(v.desertReplacement).toBe('ore');
  });

  it('picking ore as scarcity target moves an ore replacement to wheat', () => {
    const s = useAppStore.getState();
    s.setVariants({ includeDesert: false, desertReplacement: 'ore' });
    s.setChallenge('scarcity', 'ore');
    const v = useAppStore.getState().variants;
    expect(v.challenge.targetResource).toBe('ore');
    expect(v.desertReplacement).toBe('wheat');
  });

  it('picking the conflicting replacement releases the target to any', () => {
    const s = useAppStore.getState();
    s.setChallenge('scarcity', 'wood');
    s.setVariants({ includeDesert: false });
    expect(useAppStore.getState().variants.challenge.targetResource).toBe('wood');
    s.setVariants({ desertReplacement: 'wood' });
    const v = useAppStore.getState().variants;
    expect(v.desertReplacement).toBe('wood');
    expect(v.challenge.targetResource).toBe('any');
  });

  it('turning the desert off with a latent conflict releases the target to any', () => {
    const s = useAppStore.getState();
    s.setChallenge('scarcity', 'ore');
    s.setVariants({ includeDesert: false });
    // desertReplacement defaults to ore, so removing the desert creates the
    // conflict; the board change wins and the target yields.
    const v = useAppStore.getState().variants;
    expect(v.desertReplacement).toBe('ore');
    expect(v.challenge.targetResource).toBe('any');
  });

  it('switching flavor to scarcity with a latent conflict releases the target to any', () => {
    const s = useAppStore.getState();
    s.setVariants({ includeDesert: false, desertReplacement: 'wood' });
    s.setChallenge('boomOrBust', 'wood');
    // Allowed for boom-or-bust: no reconciliation.
    expect(useAppStore.getState().variants.challenge.targetResource).toBe('wood');
    s.setChallenge('scarcity');
    const v = useAppStore.getState().variants;
    expect(v.challenge.flavor).toBe('scarcity');
    expect(v.desertReplacement).toBe('wood');
    expect(v.challenge.targetResource).toBe('any');
  });

  it('does not touch non-conflicting combinations', () => {
    const s = useAppStore.getState();
    s.setVariants({ includeDesert: false, desertReplacement: 'sheep' });
    s.setChallenge('scarcity', 'wood');
    let v = useAppStore.getState().variants;
    expect(v.desertReplacement).toBe('sheep');
    expect(v.challenge.targetResource).toBe('wood');
    // With the desert included the replacement is inert, so a matching
    // target is fine.
    s.setVariants({ includeDesert: true, desertReplacement: 'wood' });
    v = useAppStore.getState().variants;
    expect(v.challenge.targetResource).toBe('wood');
    expect(v.desertReplacement).toBe('wood');
  });
});
