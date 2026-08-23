import { describe, it, expect } from 'vitest';
import { encodeMapState, decodeMapState } from '../src/url/encode';
import { generateMap } from '../src/generator/generate';
import type { Variants } from '../src/game/types';

function vars(overrides: Partial<Variants> = {}): Variants {
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

describe('v3 packed encode/decode', () => {
  it('encodes to exactly 10 base64url chars', () => {
    const { map } = generateMap({ playerCount: 4, variants: vars() });
    const enc = encodeMapState(map);
    expect(enc).toHaveLength(10);
  });

  it('first char identifies v3 (M/N/O/P)', () => {
    const { map } = generateMap({ playerCount: 4, variants: vars() });
    const enc = encodeMapState(map);
    expect(['M', 'N', 'O', 'P']).toContain(enc[0]);
  });

  it('round-trips seed and player count', () => {
    for (const pc of [3, 4, 5, 6] as const) {
      const { map } = generateMap({ playerCount: pc, variants: vars(), seed: 0xdeadbeef });
      const enc = encodeMapState(map);
      const dec = decodeMapState(enc);
      expect(dec.seed).toBe(map.seed);
      expect(dec.playerCount).toBe(pc);
    }
  });

  it('round-trips all variant flags', () => {
    const map = generateMap({
      playerCount: 4,
      variants: vars({
        includeDesert: false,
        desertReplacement: 'wheat',
        shufflePorts: true,
        noSameNumberAdjacent: false,
        noSameNumberOnResource: false,
        noMultipleRedsOnResource: false,
        challenge: { flavor: 'boomOrBust', targetResource: 'brick' },
      }),
      seed: 0x12345678,
    }).map;
    const dec = decodeMapState(encodeMapState(map));
    expect(dec.variants.includeDesert).toBe(false);
    expect(dec.variants.desertReplacement).toBe('wheat');
    expect(dec.variants.shufflePorts).toBe(true);
    expect(dec.variants.noSameNumberAdjacent).toBe(false);
    expect(dec.variants.noSameNumberOnResource).toBe(false);
    expect(dec.variants.noMultipleRedsOnResource).toBe(false);
    expect(dec.variants.challenge.flavor).toBe('boomOrBust');
    expect(dec.variants.challenge.targetResource).toBe('brick');
  });

  it('produces a byte-identical board on round-trip', () => {
    const { map } = generateMap({ playerCount: 4, variants: vars(), seed: 0xabcdef01 });
    const dec = decodeMapState(encodeMapState(map));
    expect(dec.hexes.map(h => [h.q, h.r, h.resource, h.number])).toEqual(
      map.hexes.map(h => [h.q, h.r, h.resource, h.number]),
    );
    expect(dec.ports).toEqual(map.ports);
  });

  it('handles seed with the high bit set (no sign extension)', () => {
    const { map } = generateMap({ playerCount: 4, variants: vars(), seed: 0xffffffff });
    const dec = decodeMapState(encodeMapState(map));
    expect(dec.seed).toBe(0xffffffff);
  });

  it('rejects a legacy v1/v2 JSON payload with an explicit error', () => {
    // Hand-built v2 JSON: the shape encodeMapState produced before v3. Its
    // decoder is gone, so this must fail loudly rather than throw somewhere
    // inside base64 or bit-reader internals.
    const v2Json = JSON.stringify({ v: 2, s: 'abc123', p: 4, z: {} });
    const v2Bytes = new TextEncoder().encode(v2Json);
    let bin = '';
    for (let i = 0; i < v2Bytes.length; i++) bin += String.fromCharCode(v2Bytes[i]);
    const enc = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(enc[0]).toBe('e');
    expect(() => decodeMapState(enc)).toThrow(/Unrecognized map link/);
  });
});
