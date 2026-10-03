// @ts-check
import { CONTENT_KINDS, validateContent } from './content.js';

/** @typedef {import('./content.js').ContentBundle} ContentBundle */
/** @typedef {import('./content.js').ContentDef} ContentDef */
/** @typedef {import('./content.js').ContentKind} ContentKind */

export class ContentError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(`Invalid content (${problems.length} problem(s)):\n  - ${problems.join('\n  - ')}`);
    this.name = 'ContentError';
    this.problems = problems;
  }
}

/**
 * Read-only lookup over validated game content. Definitions are deep-frozen
 * so game logic can never mutate shared data by accident.
 */
export class Registry {
  /** @param {ContentBundle} bundle */
  constructor(bundle) {
    const problems = validateContent(bundle);
    if (problems.length > 0) throw new ContentError(problems);

    /** @type {Map<string, ContentDef>} */
    this.byId = new Map();
    /** @type {Map<string, readonly ContentDef[]>} */
    this.byKind = new Map();
    for (const kind of Object.keys(CONTENT_KINDS)) {
      const defs = bundle[kind].map((def) => deepFreeze(structuredClone(def)));
      this.byKind.set(kind, Object.freeze(defs));
      for (const def of defs) this.byId.set(def.id, def);
    }
  }

  /** @param {string} id */
  has(id) {
    return this.byId.has(id);
  }

  /**
   * @param {string} id
   * @returns {ContentDef}
   */
  get(id) {
    const def = this.byId.get(id);
    if (!def) throw new Error(`Registry: unknown content id "${id}"`);
    return def;
  }

  /**
   * The content kind an id belongs to (e.g. "core"), or null.
   * @param {string} id
   * @returns {ContentKind | null}
   */
  kindOf(id) {
    for (const [kind, defs] of this.byKind) {
      if (defs.some((d) => d.id === id)) return /** @type {ContentKind} */ (kind);
    }
    return null;
  }

  /**
   * @param {ContentKind} kind
   * @returns {readonly ContentDef[]}
   */
  all(kind) {
    const defs = this.byKind.get(kind);
    if (!defs) throw new Error(`Registry: unknown content kind "${kind}"`);
    return defs;
  }
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
