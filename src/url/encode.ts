import { generateMap } from '../generator/generate';
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
// Formats v1 and v2 were JSON payloads carrying either a full board (v1) or
// a seed plus non-default flags (v2). Their decoders were removed once it was
// confirmed no link in either format was ever published. Anything that is not
// a v3 payload is now rejected with an explicit error rather than guessed at.

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
// Public API
// ---------------------------------------------------------------------------

export function encodeMapState(map: MapState): string {
  return toBase64Url(packV3(map));
}

export function decodeMapState(encoded: string): MapState {
  // v3 packed payloads always start with the version nibble 0011, which
  // base64url-encodes to a first character in {M, N, O, P}. The legacy v1 and
  // v2 JSON payloads started with '{' (first character 'e'); their decoders
  // are gone, so anything that is not v3 is reported rather than guessed at.
  const first = encoded[0];
  if (first !== 'M' && first !== 'N' && first !== 'O' && first !== 'P') {
    throw new Error(
      'Unrecognized map link: expected a v3 payload starting with M, N, O or P, ' +
        `got ${JSON.stringify(first ?? '')}. Links in the pre-v3 JSON format are ` +
        'no longer supported.',
    );
  }
  return unpackV3(fromBase64Url(encoded));
}

export function writeMapToUrl(map: MapState): void {
  const enc = encodeMapState(map);
  history.replaceState(null, '', `#m=${enc}`);
}
