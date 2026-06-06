import { generateMap } from '../generator/generate';
import { seedFromString } from '../generator/random';
import type {
  ChallengeFlavor,
  MapState,
  PlayerCount,
  ProducingResource,
  Variants,
} from '../game/types';

// Wire format v3 (current): a 52-bit bit-packed payload — version nibble +
// u32 seed + every variant flag/enum at its minimum bit width. Encoded as
// 7 bytes → 10 chars of base64url. Typical URL hash shrinks to `#m=` + 10.
//
// Wire format v2 (legacy): JSON {v:2, s, p, z:{...non-default flags}} →
// base64url. ~30-50 chars. Decoder still supports it.
//
// Wire format v1 (legacy): full hex/port JSON. Kept for backward compat.

// ---------------------------------------------------------------------------
// v3 packed format
// ---------------------------------------------------------------------------

const V3_VERSION = 3;
const V3_BYTE_LEN = 7;

const DESERT_REPLACEMENTS: ProducingResource[] = ['wood', 'brick', 'wheat', 'sheep', 'ore'];
// Index-stable: old URLs encoded indexes 0-4, so 'wealthGap' and 'hotZone' are
// appended at the end rather than slotted in alphabetical order. Adding more
// flavors past index 7 would overflow the 3-bit field and need a schema bump.
const CHALLENGE_FLAVORS: ChallengeFlavor[] = ['none', 'scarcity', 'boomOrBust', 'drought', 'random', 'wealthGap', 'hotZone'];
const CHALLENGE_TARGETS: Array<ProducingResource | 'any'> = ['any', 'wood', 'brick', 'wheat', 'sheep', 'ore'];

class BitWriter {
  private bytes: Uint8Array;
  private bitPos = 0;
  constructor(byteLen: number) {
    this.bytes = new Uint8Array(byteLen);
  }
  write(value: number, bits: number): void {
    // MSB-first within each byte. value must fit in `bits`.
    for (let i = bits - 1; i >= 0; i--) {
      const bit = (value >>> i) & 1;
      const byteIdx = this.bitPos >>> 3;
      const bitIdx = 7 - (this.bitPos & 7);
      this.bytes[byteIdx] |= bit << bitIdx;
      this.bitPos++;
    }
  }
  toBytes(): Uint8Array {
    return this.bytes;
  }
}

class BitReader {
  private bitPos = 0;
  constructor(private bytes: Uint8Array) {}
  read(bits: number): number {
    let out = 0;
    for (let i = 0; i < bits; i++) {
      const byteIdx = this.bitPos >>> 3;
      const bitIdx = 7 - (this.bitPos & 7);
      const bit = (this.bytes[byteIdx] >>> bitIdx) & 1;
      out = (out << 1) | bit;
      this.bitPos++;
    }
    return out >>> 0;
  }
}

function indexOrThrow<T>(arr: readonly T[], v: T, label: string): number {
  const i = arr.indexOf(v);
  if (i < 0) throw new Error(`Unknown ${label}: ${String(v)}`);
  return i;
}

function packV3(map: MapState): Uint8Array {
  const w = new BitWriter(V3_BYTE_LEN);
  w.write(V3_VERSION, 4);
  // Seed is a u32; split into two 16-bit writes to stay within JS bitwise
  // ops (which treat operands as i32 and would sign-extend bit 31).
  w.write((map.seed >>> 16) & 0xffff, 16);
  w.write(map.seed & 0xffff, 16);
  w.write(map.playerCount - 3, 2);
  w.write(map.variants.includeDesert ? 1 : 0, 1);
  w.write(indexOrThrow(DESERT_REPLACEMENTS, map.variants.desertReplacement, 'desertReplacement'), 3);
  w.write(map.variants.shufflePorts ? 1 : 0, 1);
  w.write(map.variants.noSameNumberAdjacent ? 1 : 0, 1);
  w.write(map.variants.noSameNumberOnResource ? 1 : 0, 1);
  w.write(map.variants.noMultipleRedsOnResource ? 1 : 0, 1);
  w.write(indexOrThrow(CHALLENGE_FLAVORS, map.variants.challenge.flavor, 'challenge.flavor'), 3);
  w.write(indexOrThrow(CHALLENGE_TARGETS, map.variants.challenge.targetResource, 'challenge.targetResource'), 3);
  // 4 bits trailing padding inside byte 7.
  return w.toBytes();
}

function unpackV3(bytes: Uint8Array): MapState {
  if (bytes.length < V3_BYTE_LEN) throw new Error('v3 payload too short');
  const r = new BitReader(bytes);
  const version = r.read(4);
  if (version !== V3_VERSION) throw new Error(`Unexpected v3 version nibble: ${version}`);
  const seedHi = r.read(16);
  const seedLo = r.read(16);
  // (hi << 16) | lo would sign-extend when hi's top bit is set, since JS
  // bitwise ops operate on i32. Use * 0x10000 + lo and force u32 with >>> 0.
  const seed = (seedHi * 0x10000 + seedLo) >>> 0;
  const playerCount = (r.read(2) + 3) as PlayerCount;
  const includeDesert = r.read(1) === 1;
  const desertReplacement = DESERT_REPLACEMENTS[r.read(3)];
  const shufflePorts = r.read(1) === 1;
  const noSameNumberAdjacent = r.read(1) === 1;
  const noSameNumberOnResource = r.read(1) === 1;
  const noMultipleRedsOnResource = r.read(1) === 1;
  const flavor = CHALLENGE_FLAVORS[r.read(3)];
  const targetResource = CHALLENGE_TARGETS[r.read(3)];
  if (!desertReplacement || !flavor || !targetResource) throw new Error('v3 enum out of range');
  const variants: Variants = {
    includeDesert,
    desertReplacement,
    shufflePorts,
    noSameNumberAdjacent,
    noSameNumberOnResource,
    noMultipleRedsOnResource,
    challenge: { flavor, targetResource },
  };
  const result = generateMap({ seed, playerCount, variants });
  return result.map;
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((s.length + 2) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Legacy JSON wire types (v1/v2) — decoder only.
// ---------------------------------------------------------------------------

interface WireZ {
  d?: 0 | 1;
  dr?: string;
  sp?: 0 | 1;
  nn?: 0 | 1;
  nr?: 0 | 1;
  nm?: 0 | 1;
  bp?: 0 | 1;
  c?: { f?: string; t?: string; rf?: string; rt?: string };
}

interface WireV2 {
  v: 2;
  s: string;
  p: number;
  z: WireZ;
}

interface WireV1 {
  v: 1;
  s: string;
  p: number;
  h: Array<[number, number, string, number | null]>;
  o: Array<[string, number, string]>;
  z: WireZ;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function encodeMapState(map: MapState): string {
  return toBase64Url(packV3(map));
}

export function decodeMapState(encoded: string): MapState {
  // v3 packed payloads always start with the version nibble 0011 → base64url
  // first char in {M,N,O,P}. v1/v2 JSON payloads always start with '{' →
  // base64url first char 'e'. Anything else falls back to JSON parsing for
  // forward safety.
  const first = encoded[0];
  const bytes = fromBase64Url(encoded);
  if (first === 'M' || first === 'N' || first === 'O' || first === 'P') {
    return unpackV3(bytes);
  }
  const json = new TextDecoder().decode(bytes);
  const wire = JSON.parse(json) as WireV1 | WireV2;
  if (wire.v === 2) return decodeV2(wire);
  if (wire.v === 1) return decodeV1(wire);
  throw new Error(`Unsupported map version: ${(wire as { v: number }).v}`);
}

function variantsFromZ(z: WireZ): Variants {
  return {
    includeDesert: z.d === undefined ? true : z.d === 1,
    desertReplacement: (z.dr ?? 'ore') as ProducingResource,
    shufflePorts: z.sp === 1,
    noSameNumberAdjacent: z.nn === undefined ? true : z.nn === 1,
    noSameNumberOnResource: z.nr === undefined ? true : z.nr === 1,
    noMultipleRedsOnResource: z.nm === undefined ? true : z.nm === 1,
    challenge: {
      flavor: (z.c?.f ?? 'none') as ChallengeFlavor,
      targetResource: (z.c?.t ?? 'any') as ProducingResource | 'any',
    },
  };
}

function decodeV2(wire: WireV2): MapState {
  const variants = variantsFromZ(wire.z);
  const result = generateMap({
    seed: seedFromString(wire.s),
    playerCount: wire.p as PlayerCount,
    variants,
  });
  return result.map;
}

function decodeV1(wire: WireV1): MapState {
  return {
    seed: seedFromString(wire.s),
    playerCount: wire.p as PlayerCount,
    hexes: wire.h.map(([q, r, resource, number], i) => ({
      id: `h${i}`,
      q,
      r,
      resource: resource as MapState['hexes'][number]['resource'],
      number,
    })),
    ports: wire.o.map(([hexId, side, type]) => ({
      hexId,
      side: side as 0 | 1 | 2 | 3 | 4 | 5,
      type: type as MapState['ports'][number]['type'],
    })),
    variants: {
      includeDesert: wire.z.d === 1,
      desertReplacement: wire.z.dr as ProducingResource,
      shufflePorts: wire.z.sp === 1,
      noSameNumberAdjacent: wire.z.nn === 1,
      noSameNumberOnResource: wire.z.nr === 1,
      noMultipleRedsOnResource: wire.z.nm === 1,
      challenge: {
        flavor: (wire.z.c?.f ?? 'none') as ChallengeFlavor,
        targetResource: (wire.z.c?.t ?? 'any') as ProducingResource | 'any',
        rolledFlavor: wire.z.c?.rf as MapState['variants']['challenge']['rolledFlavor'],
        rolledTarget: wire.z.c?.rt as MapState['variants']['challenge']['rolledTarget'],
      },
    },
  };
}

export function writeMapToUrl(map: MapState): void {
  const enc = encodeMapState(map);
  history.replaceState(null, '', `#m=${enc}`);
}

export function readMapFromUrl(): MapState | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#m=')) return null;
  try {
    return decodeMapState(hash.slice(3));
  } catch {
    return null;
  }
}
