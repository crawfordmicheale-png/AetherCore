// @ts-check
/**
 * Seeded, serializable randomness (docs/TECHNICAL_DESIGN.md §3.2).
 *
 * All randomness in the game flows through an `Rng` instance. Each system
 * draws from its own named stream so that, e.g., shuffling extra cards never
 * changes what the map generator produces for the same seed.
 */

/** Stream names used by the run. Order matters only for documentation. */
export const STREAMS = /** @type {const} */ (['map', 'loot', 'shuffle', 'ai', 'events', 'smelter']);

/**
 * cyrb128: hashes a string into four 32-bit seeds.
 * @param {string} str
 * @returns {[number, number, number, number]}
 */
export function cyrb128(str) {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** @typedef {[number, number, number, number]} RngState */

/** A single sfc32 generator whose full state can be saved and restored. */
export class Rng {
  /** @param {RngState} state */
  constructor(state) {
    /** @type {RngState} */
    this.s = [state[0] >>> 0, state[1] >>> 0, state[2] >>> 0, state[3] >>> 0];
  }

  /** @param {string} seed */
  static fromSeed(seed) {
    const rng = new Rng(cyrb128(seed));
    // Discard the first outputs; sfc32 is weak right after seeding.
    for (let i = 0; i < 15; i++) rng.nextUint32();
    return rng;
  }

  /** @returns {number} uniform integer in [0, 2^32) */
  nextUint32() {
    let [a, b, c, d] = this.s;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.s = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
    return t >>> 0;
  }

  /** @returns {number} uniform float in [0, 1) */
  next() {
    return this.nextUint32() / 4294967296;
  }

  /**
   * Uniform integer in [min, max] (inclusive).
   * @param {number} min
   * @param {number} max
   */
  int(min, max) {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`Rng.int: invalid range [${min}, ${max}]`);
    }
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** @param {number} probability chance in [0, 1] */
  chance(probability) {
    return this.next() < probability;
  }

  /**
   * @template T
   * @param {readonly T[]} items
   * @returns {T}
   */
  pick(items) {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)];
  }

  /**
   * Picks an item using relative weights.
   * @template T
   * @param {readonly T[]} items
   * @param {(item: T) => number} weightOf
   * @returns {T}
   */
  weighted(items, weightOf) {
    let total = 0;
    for (const item of items) total += Math.max(0, weightOf(item));
    if (total <= 0) throw new RangeError('Rng.weighted: total weight must be positive');
    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weightOf(item));
      if (roll < 0) return item;
    }
    return items[items.length - 1];
  }

  /**
   * Fisher-Yates shuffle in place.
   * @template T
   * @param {T[]} items
   * @returns {T[]} the same array
   */
  shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  /** @returns {RngState} */
  serialize() {
    return [...this.s];
  }
}

/** The set of independent RNG streams for one run. */
export class RngStreams {
  /** @param {Record<string, Rng>} streams */
  constructor(streams) {
    /** @type {Record<string, Rng>} */
    this.streams = streams;
  }

  /** @param {string} runSeed */
  static fromSeed(runSeed) {
    /** @type {Record<string, Rng>} */
    const streams = {};
    for (const name of STREAMS) streams[name] = Rng.fromSeed(`${runSeed}::${name}`);
    return new RngStreams(streams);
  }

  /** @param {Record<string, RngState>} data */
  static deserialize(data) {
    /** @type {Record<string, Rng>} */
    const streams = {};
    for (const name of STREAMS) {
      if (!data[name]) throw new Error(`RngStreams: missing stream "${name}"`);
      streams[name] = new Rng(data[name]);
    }
    return new RngStreams(streams);
  }

  /** @param {typeof STREAMS[number]} name */
  get(name) {
    const rng = this.streams[name];
    if (!rng) throw new Error(`RngStreams: unknown stream "${name}"`);
    return rng;
  }

  /** @returns {Record<string, RngState>} */
  serialize() {
    /** @type {Record<string, RngState>} */
    const out = {};
    for (const name of STREAMS) out[name] = this.streams[name].serialize();
    return out;
  }
}

/**
 * Generates a human-shareable run seed like "K7QF-2MXA".
 * Uses an RNG seeded from `entropy` so the caller controls the source.
 * @param {string} entropy
 */
export function makeRunSeed(entropy) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const rng = Rng.fromSeed(entropy);
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += alphabet[rng.int(0, alphabet.length - 1)];
  }
  return out;
}
