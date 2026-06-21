// Seeded deterministic PRNG (mulberry32). The whole point: a run is fully
// reproducible from its seed, so a "random" map is also a shareable, replayable
// map — and the basis for daily challenges / verifiable leaderboards later.
export class RNG {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(arr.length)];
  }
}

// Hash an arbitrary string into a uint32 seed (FNV-1a) so seeds can be words.
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A fresh nondeterministic seed (only the seed *pick* is random; everything the
// seed drives is deterministic). Browser-only — never used by the sim.
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// Short shareable code <-> seed. Codes round-trip; non-code words are hashed.
export function seedToCode(seed: number): string {
  return (seed >>> 0).toString(36);
}
export function codeToSeed(code: string): number {
  const n = parseInt(code, 36);
  if (!Number.isNaN(n) && (n >>> 0).toString(36) === code.toLowerCase()) return n >>> 0;
  return hashSeed(code);
}
