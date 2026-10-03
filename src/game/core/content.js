// @ts-check
/**
 * Content kinds, their data files, and the validation rules for each
 * (docs/TECHNICAL_DESIGN.md §4). Pure functions only: loading files from disk
 * or over fetch is the caller's job (tools/ in Node, src/main.js in the app).
 */

/**
 * Each kind maps to a JSON file in src/data/ and an ID prefix.
 * @type {Readonly<Record<string, { file: string, prefix: string }>>}
 */
export const CONTENT_KINDS = Object.freeze({
  frame: { file: 'frames.json', prefix: 'frame_' },
  core: { file: 'cores.json', prefix: 'core_' },
  mod: { file: 'mods.json', prefix: 'mod_' },
  slag: { file: 'slag.json', prefix: 'slag_' },
  chassis: { file: 'chassis.json', prefix: 'chassis_' },
});

/** @typedef {keyof typeof CONTENT_KINDS} ContentKind */
/** @typedef {Record<string, any>} ContentDef */
/** @typedef {Record<string, ContentDef[]>} ContentBundle  keyed by kind */

export const TIERS = ['starter', 'salvage', 'refined', 'prototype'];
export const VERBS = ['attack', 'defend', 'utility'];
export const TARGETS = ['single', 'all', 'random', 'self'];
export const ELEMENTS = ['kinetic', 'thermal', 'voltaic', 'aether', 'cryo'];
export const KEYWORDS = ['exhaust', 'retain', 'innate', 'ethereal'];
export const UNLOCKS = ['base', 'rnd'];

/** Overclocking may exceed capacity by at most this much weight (GDD §2.3). */
export const OVERCLOCK_LIMIT = 2;

/** Field checkers. Each returns an error message or null. */
const is = {
  /** @param {unknown} v */
  string: (v) => (typeof v === 'string' && v.length > 0 ? null : 'must be a non-empty string'),
  /** @param {number} min @param {number} max */
  int: (min, max) => /** @param {unknown} v */ (v) =>
    Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max
      ? null
      : `must be an integer in [${min}, ${max}]`,
  /** @param {readonly string[]} values */
  oneOf: (values) => /** @param {unknown} v */ (v) =>
    typeof v === 'string' && values.includes(v) ? null : `must be one of: ${values.join(', ')}`,
  /** @param {readonly string[]} values */
  listOf: (values) => /** @param {unknown} v */ (v) =>
    Array.isArray(v) && v.every((x) => values.includes(x))
      ? null
      : `must be an array of: ${values.join(', ')}`,
  /** @param {(v: unknown) => string | null} check */
  nullable: (check) => /** @param {unknown} v */ (v) => (v === null ? null : check(v)),
  /** @param {(v: unknown) => string | null} check */
  optional: (check) => /** @param {unknown} v */ (v) => (v === undefined ? null : check(v)),
  /** @param {unknown} v */
  positiveNumber: (v) => (typeof v === 'number' && v > 0 ? null : 'must be a positive number'),
  /** @param {unknown} v */
  bool: (v) => (typeof v === 'boolean' ? null : 'must be a boolean'),
  /** @param {unknown} v */
  object: (v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v) ? null : 'must be an object',
  /** @param {unknown} v */
  array: (v) => (Array.isArray(v) ? null : 'must be an array'),
};

/** @type {Record<string, Record<string, (v: unknown) => string | null>>} */
const FIELD_RULES = {
  frame: {
    id: is.string,
    name: is.string,
    tier: is.oneOf(TIERS),
    verb: is.oneOf(VERBS),
    cost: is.int(0, 3),
    capacity: is.int(0, 4),
    target: is.oneOf(TARGETS),
    base: is.nullable(is.int(0, 99)),
    hits: is.nullable(is.int(1, 10)),
    coreScaling: is.nullable(is.positiveNumber),
    keywords: is.listOf(KEYWORDS),
    text: is.optional(is.string),
    unlock: is.oneOf(UNLOCKS),
  },
  core: {
    id: is.string,
    name: is.string,
    tier: is.oneOf(TIERS),
    element: is.oneOf(ELEMENTS),
    power: is.int(0, 99),
    rider: is.nullable(is.int(1, 99)),
    weight: is.int(0, 3),
    text: is.optional(is.string),
    unlock: is.oneOf(UNLOCKS),
  },
  mod: {
    id: is.string,
    name: is.string,
    tier: is.oneOf(TIERS),
    weight: is.int(0, 2),
    stateCheck: is.optional(is.bool),
    text: is.string,
    unlock: is.oneOf(UNLOCKS),
  },
  slag: {
    id: is.string,
    name: is.string,
    cost: is.nullable(is.int(0, 3)),
    keywords: is.listOf(KEYWORDS),
    text: is.string,
  },
  chassis: {
    id: is.string,
    name: is.string,
    hp: is.int(1, 999),
    energy: is.int(1, 10),
    draw: is.int(1, 10),
    unlock: is.object,
    passive: is.object,
    deck: is.array,
    cargo: is.array,
  },
};

/**
 * Validates a content bundle: per-field rules, unique and correctly-prefixed
 * IDs, cross-references, and design rules (e.g. Overclock-safe starter decks).
 *
 * @param {ContentBundle} bundle
 * @returns {string[]} human-readable errors (empty when valid)
 */
export function validateContent(bundle) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, string>} id -> kind */
  const ids = new Map();

  for (const [kind, { prefix }] of Object.entries(CONTENT_KINDS)) {
    const defs = bundle[kind];
    if (!Array.isArray(defs)) {
      errors.push(`${kind}: expected an array of definitions`);
      continue;
    }
    const rules = FIELD_RULES[kind];
    defs.forEach((def, i) => {
      const where = `${kind}[${i}]${def && typeof def.id === 'string' ? ` (${def.id})` : ''}`;
      if (!def || typeof def !== 'object') {
        errors.push(`${where}: must be an object`);
        return;
      }
      for (const [field, check] of Object.entries(rules)) {
        const problem = check(def[field]);
        if (problem) errors.push(`${where}.${field} ${problem}`);
      }
      for (const field of Object.keys(def)) {
        if (!(field in rules)) errors.push(`${where}: unknown field "${field}"`);
      }
      if (typeof def.id === 'string') {
        if (!def.id.startsWith(prefix)) errors.push(`${where}: id must start with "${prefix}"`);
        if (ids.has(def.id)) errors.push(`${where}: duplicate id "${def.id}"`);
        ids.set(def.id, kind);
      }
    });
  }

  validateFrames(bundle.frame ?? [], errors);
  validateChassis(bundle, ids, errors);
  return errors;
}

/**
 * @param {ContentDef[]} frames
 * @param {string[]} errors
 */
function validateFrames(frames, errors) {
  for (const f of frames) {
    const isUtility = f.verb === 'utility';
    const numeric = [f.base, f.hits, f.coreScaling];
    if (isUtility && numeric.some((v) => v !== null)) {
      errors.push(`frame ${f.id}: utility frames must have null base/hits/coreScaling`);
    }
    if (isUtility && !f.text)
      errors.push(`frame ${f.id}: utility frames must describe their rule in "text"`);
    if (!isUtility && numeric.some((v) => v === null)) {
      errors.push(`frame ${f.id}: attack/defend frames need base, hits, and coreScaling`);
    }
    if (f.verb === 'defend' && f.target !== 'self') {
      errors.push(`frame ${f.id}: defend frames must target "self"`);
    }
  }
}

/**
 * @param {ContentBundle} bundle
 * @param {Map<string, string>} ids
 * @param {string[]} errors
 */
function validateChassis(bundle, ids, errors) {
  const byId = (/** @type {ContentKind} */ kind) =>
    new Map((bundle[kind] ?? []).map((d) => [d.id, d]));
  const frames = byId('frame');
  const cores = byId('core');
  const mods = byId('mod');

  /**
   * @param {string} where
   * @param {unknown} id
   * @param {ContentKind} kind
   */
  const ref = (where, id, kind) => {
    if (typeof id !== 'string') errors.push(`${where}: must reference a ${kind} id`);
    else if (ids.get(id) !== kind) errors.push(`${where}: unknown ${kind} "${id}"`);
  };

  for (const chassis of bundle.chassis ?? []) {
    if (!Array.isArray(chassis.deck) || !Array.isArray(chassis.cargo)) continue;
    let size = 0;
    chassis.deck.forEach((/** @type {ContentDef} */ entry, /** @type {number} */ i) => {
      const where = `chassis ${chassis.id}.deck[${i}]`;
      if (!Number.isInteger(entry.count) || entry.count < 1)
        errors.push(`${where}.count must be >= 1`);
      else size += entry.count;
      ref(`${where}.frame`, entry.frame, 'frame');
      ref(`${where}.core`, entry.core, 'core');
      if (entry.mod !== undefined) ref(`${where}.mod`, entry.mod, 'mod');

      const frame = frames.get(entry.frame);
      const core = cores.get(entry.core);
      const mod = entry.mod ? mods.get(entry.mod) : undefined;
      if (frame && core) {
        const weight = core.weight + (mod?.weight ?? 0);
        // Starter cards should never begin Overclocked (they would Exhaust every fight).
        if (weight > frame.capacity) {
          errors.push(`${where}: weight ${weight} exceeds ${frame.id} capacity ${frame.capacity}`);
        }
      }
    });
    if (size < 8)
      errors.push(`chassis ${chassis.id}: deck has ${size} cards; minimum is 8 (GDD §2.6)`);

    chassis.cargo.forEach((/** @type {ContentDef} */ entry, /** @type {number} */ i) => {
      const where = `chassis ${chassis.id}.cargo[${i}]`;
      if (entry.id !== undefined) {
        const kind = ids.get(entry.id);
        if (kind !== 'frame' && kind !== 'core' && kind !== 'mod') {
          errors.push(`${where}: "${entry.id}" is not a component id`);
        }
      } else if (entry.random) {
        if (!['frame', 'core', 'mod'].includes(entry.random.kind)) {
          errors.push(`${where}.random.kind must be frame, core, or mod`);
        }
        if (!TIERS.includes(entry.random.tier)) errors.push(`${where}.random.tier is invalid`);
      } else {
        errors.push(`${where}: must have "id" or "random"`);
      }
    });
    if (chassis.cargo.length > 10) errors.push(`chassis ${chassis.id}: cargo exceeds 10 slots`);
  }
}
