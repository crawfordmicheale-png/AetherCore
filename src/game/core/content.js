// @ts-check
/**
 * Content kinds, their data files, and the validation rules for each
 * (docs/TECHNICAL_DESIGN.md §4). Pure functions only: loading files from disk
 * or over fetch is the caller's job (tools/ in Node, src/main.js in the app).
 */
import { checkCondition } from '../model/conditions.js';
import { PER_KEYS } from '../model/card.js';
import { STATUS_IDS } from '../model/statuses.js';

/**
 * Each kind maps to a JSON file in src/data/ and its allowed ID prefixes.
 * @type {Readonly<Record<string, { file: string, prefix: string[] }>>}
 */
export const CONTENT_KINDS = Object.freeze({
  frame: { file: 'frames.json', prefix: ['frame_'] },
  core: { file: 'cores.json', prefix: ['core_'] },
  mod: { file: 'mods.json', prefix: ['mod_'] },
  slag: { file: 'slag.json', prefix: ['slag_'] },
  chassis: { file: 'chassis.json', prefix: ['chassis_'] },
  enemy: { file: 'enemies.json', prefix: ['en_', 'el_', 'boss_'] },
  encounter: { file: 'encounters.json', prefix: ['enc_'] },
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
export const UTILITY_RULES = ['conduit', 'relay'];
export const ENEMY_TIERS = ['normal', 'elite', 'boss'];
export const ENCOUNTER_KINDS = ['easy', 'normal', 'elite', 'boss'];
export const INTENTS = ['attack', 'defend', 'buff', 'debuff', 'suppress', 'slag'];
export const MODIFIER_STATS = ['cost', 'power', 'value', 'hits', 'damageMult'];
export const OP_TARGETS = ['player', 'self', 'target', 'allEnemies', 'randomEnemy'];
export const SUPPRESSION_SLOTS = ['mod', 'coreRider'];
export const SLAG_PILES = ['draw', 'hand', 'discard'];
/** Elements whose riders are status stacks (and so need a numeric `rider`). */
export const STACKING_ELEMENTS = ['thermal', 'voltaic', 'cryo'];

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
    utility: is.optional(is.oneOf(UTILITY_RULES)),
    modifiers: is.optional(is.array),
    hooks: is.optional(is.object),
    unlock: is.oneOf(UNLOCKS),
  },
  core: {
    id: is.string,
    name: is.string,
    adjective: is.string,
    tier: is.oneOf(TIERS),
    element: is.oneOf(ELEMENTS),
    power: is.int(0, 99),
    rider: is.nullable(is.int(1, 99)),
    weight: is.int(0, 3),
    riderless: is.optional(is.bool),
    modifiers: is.optional(is.array),
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
    keywords: is.optional(is.listOf(KEYWORDS)),
    unsuppressable: is.optional(is.bool),
    modifiers: is.optional(is.array),
    hooks: is.optional(is.object),
    unlock: is.oneOf(UNLOCKS),
  },
  slag: {
    id: is.string,
    name: is.string,
    cost: is.nullable(is.int(0, 3)),
    keywords: is.listOf(KEYWORDS),
    text: is.string,
    onCardPlayedInHand: is.optional(is.array),
    endOfTurnInHand: is.optional(is.array),
    capacityInHand: is.optional(is.int(-3, 0)),
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
  enemy: {
    id: is.string,
    name: is.string,
    tier: is.oneOf(ENEMY_TIERS),
    hp: is.array,
    start: is.oneOf(['first', 'random']),
    moves: is.array,
    pattern: is.array,
    onDeath: is.optional(is.array),
    statuses: is.optional(is.object),
  },
  encounter: {
    id: is.string,
    name: is.string,
    kind: is.oneOf(ENCOUNTER_KINDS),
    enemies: is.array,
  },
};

const posInt = is.int(1, 999);
/** Parameter checkers per op (docs/TECHNICAL_DESIGN.md §4.3). `?` marks optional params. */
/** @type {Record<string, Record<string, (v: unknown) => string | null>>} */
export const OP_SCHEMAS = {
  damage: {
    amount: is.int(0, 999),
    'hits?': posInt,
    'target?': is.oneOf(OP_TARGETS),
    'pierce?': is.bool,
  },
  block: { amount: is.int(0, 999), 'target?': is.oneOf(OP_TARGETS) },
  applyStatus: { status: is.oneOf(STATUS_IDS), stacks: posInt, 'target?': is.oneOf(OP_TARGETS) },
  draw: { n: posInt },
  gainEnergy: { n: posInt },
  heal: { amount: posInt, 'target?': is.oneOf(OP_TARGETS) },
  addSlag: { slag: is.string, count: posInt, pile: is.oneOf(SLAG_PILES) },
  suppress: { slot: is.oneOf(SUPPRESSION_SLOTS), duration: posInt },
  exhaustSlag: { count: posInt },
  ricochet: { pct: is.int(1, 100) },
  siphon: { per: posInt, max: posInt },
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
        if (!prefix.some((p) => def.id.startsWith(p))) {
          errors.push(`${where}: id must start with ${prefix.map((p) => `"${p}"`).join(' or ')}`);
        }
        if (ids.has(def.id)) errors.push(`${where}: duplicate id "${def.id}"`);
        ids.set(def.id, kind);
      }
    });
  }

  validateFrames(bundle.frame ?? [], errors);
  validateCores(bundle.core ?? [], errors);
  validateBehavior(bundle, ids, errors);
  validateChassis(bundle, ids, errors);
  validateEnemies(bundle, ids, errors);
  return errors;
}

/**
 * @param {ContentDef[]} cores
 * @param {string[]} errors
 */
function validateCores(cores, errors) {
  for (const c of cores) {
    const stacking = STACKING_ELEMENTS.includes(c.element);
    if (stacking && !c.riderless && c.rider === null) {
      errors.push(`core ${c.id}: ${c.element} cores need a numeric rider`);
    }
    if (!stacking && c.rider !== null) {
      errors.push(`core ${c.id}: ${c.element} riders are fixed effects; rider must be null`);
    }
  }
}

/**
 * @param {unknown} list
 * @param {string} where
 * @param {string[]} errors
 */
function validateModifiers(list, where, errors) {
  if (list === undefined) return;
  if (!Array.isArray(list)) return; // field rule already reported it
  list.forEach((m, i) => {
    const at = `${where}.modifiers[${i}]`;
    if (!MODIFIER_STATS.includes(m.stat))
      errors.push(`${at}.stat must be one of: ${MODIFIER_STATS.join(', ')}`);
    const isMult = m.stat === 'damageMult';
    if (isMult && typeof m.mul !== 'number') errors.push(`${at}: damageMult needs a numeric "mul"`);
    if (!isMult && !Number.isInteger(m.add)) errors.push(`${at}: needs an integer "add"`);
    if (m.per !== undefined && !PER_KEYS.includes(m.per))
      errors.push(`${at}.per must be one of: ${PER_KEYS.join(', ')}`);
    if (m.when !== undefined) {
      const problem = checkCondition(m.when);
      if (problem) errors.push(`${at}.when: ${problem}`);
    }
    for (const key of Object.keys(m)) {
      if (!['stat', 'add', 'mul', 'per', 'when'].includes(key))
        errors.push(`${at}: unknown field "${key}"`);
    }
  });
}

/**
 * @param {unknown} list
 * @param {string} where
 * @param {Map<string, string>} ids
 * @param {string[]} errors
 */
export function validateOps(list, where, ids, errors) {
  if (!Array.isArray(list)) {
    errors.push(`${where} must be an array of ops`);
    return;
  }
  list.forEach((op, i) => {
    const at = `${where}[${i}]`;
    const schema = op && OP_SCHEMAS[op.op];
    if (!schema) {
      errors.push(`${at}: unknown op "${op?.op}"`);
      return;
    }
    for (const [rawKey, check] of Object.entries(schema)) {
      const optional = rawKey.endsWith('?');
      const key = optional ? rawKey.slice(0, -1) : rawKey;
      if (optional && op[key] === undefined) continue;
      const problem = check(op[key]);
      if (problem) errors.push(`${at}.${key} ${problem}`);
    }
    const allowed = new Set(['op', ...Object.keys(schema).map((k) => k.replace('?', ''))]);
    for (const key of Object.keys(op)) {
      if (!allowed.has(key)) errors.push(`${at}: unknown param "${key}" for ${op.op}`);
    }
    if (op.op === 'addSlag' && typeof op.slag === 'string' && ids.get(op.slag) !== 'slag') {
      errors.push(`${at}: unknown slag "${op.slag}"`);
    }
  });
}

/**
 * @param {unknown} hooks
 * @param {string} where
 * @param {Map<string, string>} ids
 * @param {string[]} errors
 */
function validateHooks(hooks, where, ids, errors) {
  if (hooks === undefined || hooks === null || typeof hooks !== 'object') return;
  for (const [name, ops] of Object.entries(hooks)) {
    if (name !== 'cardPlayed') errors.push(`${where}.hooks: unknown hook "${name}"`);
    else validateOps(ops, `${where}.hooks.${name}`, ids, errors);
  }
}

/**
 * @param {ContentBundle} bundle
 * @param {Map<string, string>} ids
 * @param {string[]} errors
 */
function validateBehavior(bundle, ids, errors) {
  for (const kind of ['frame', 'core', 'mod']) {
    for (const def of bundle[kind] ?? []) {
      validateModifiers(def.modifiers, `${kind} ${def.id}`, errors);
      validateHooks(def.hooks, `${kind} ${def.id}`, ids, errors);
    }
  }
  for (const def of bundle.slag ?? []) {
    const where = `slag ${def.id}`;
    if (Array.isArray(def.onCardPlayedInHand)) {
      def.onCardPlayedInHand.forEach((/** @type {any} */ trigger, /** @type {number} */ i) => {
        const at = `${where}.onCardPlayedInHand[${i}]`;
        if (trigger.when !== undefined) {
          const problem = checkCondition(trigger.when);
          if (problem) errors.push(`${at}.when: ${problem}`);
        }
        validateOps(trigger.ops, `${at}.ops`, ids, errors);
      });
    }
    if (def.endOfTurnInHand !== undefined)
      validateOps(def.endOfTurnInHand, `${where}.endOfTurnInHand`, ids, errors);
  }
}

/**
 * @param {ContentBundle} bundle
 * @param {Map<string, string>} ids
 * @param {string[]} errors
 */
function validateEnemies(bundle, ids, errors) {
  for (const e of bundle.enemy ?? []) {
    const where = `enemy ${e.id}`;
    if (
      !Array.isArray(e.hp) ||
      e.hp.length !== 2 ||
      !e.hp.every((n) => Number.isInteger(n) && n > 0) ||
      e.hp[0] > e.hp[1]
    ) {
      errors.push(`${where}.hp must be [min, max] positive integers with min <= max`);
    }
    if (!Array.isArray(e.moves) || !Array.isArray(e.pattern)) continue;
    const moveIds = new Set();
    e.moves.forEach((/** @type {any} */ m, /** @type {number} */ i) => {
      const at = `${where}.moves[${i}]`;
      if (typeof m.id !== 'string') errors.push(`${at}.id must be a string`);
      else if (moveIds.has(m.id)) errors.push(`${at}: duplicate move id "${m.id}"`);
      moveIds.add(m.id);
      if (typeof m.name !== 'string') errors.push(`${at}.name must be a string`);
      if (!INTENTS.includes(m.intent))
        errors.push(`${at}.intent must be one of: ${INTENTS.join(', ')}`);
      validateOps(m.ops, `${at}.ops`, ids, errors);
    });
    if (e.pattern.length === 0) errors.push(`${where}.pattern must not be empty`);
    for (const id of e.pattern) {
      if (!moveIds.has(id)) errors.push(`${where}.pattern: unknown move "${id}"`);
    }
    if (e.onDeath !== undefined) validateOps(e.onDeath, `${where}.onDeath`, ids, errors);
    // Every Elite must interact with the player's architecture (GDD §3.5).
    if (e.tier === 'elite') {
      const wrench = e.moves.some((/** @type {any} */ m) =>
        (m.ops ?? []).some((/** @type {any} */ op) => op.op === 'suppress' || op.op === 'addSlag'),
      );
      if (!wrench) errors.push(`${where}: elites need at least one suppress or addSlag move`);
    }
  }
  for (const enc of bundle.encounter ?? []) {
    const where = `encounter ${enc.id}`;
    if (!Array.isArray(enc.enemies)) continue;
    if (enc.enemies.length < 1 || enc.enemies.length > 5)
      errors.push(`${where}: needs 1-5 enemies`);
    for (const id of enc.enemies) {
      if (ids.get(id) !== 'enemy') errors.push(`${where}: unknown enemy "${id}"`);
    }
  }
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
