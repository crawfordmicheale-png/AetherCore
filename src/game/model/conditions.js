// @ts-check
/**
 * The closed set of state-check predicates used by `when` clauses in content
 * (docs/TECHNICAL_DESIGN.md §4.3). Keeping the set closed keeps content
 * analyzable and every predicate unit-testable.
 */

/**
 * @typedef {object} ConditionScope
 * @property {{ hp: number, maxHp: number, statuses: Record<string, number> } | null} target
 * @property {{ statuses: Record<string, number> }} player
 * @property {string | null} coreElement   Element of the card being evaluated (or played).
 * @property {boolean} componentSuppressed Any component on the evaluated card is suppressed.
 * @property {number} handCount
 */

export const CONDITION_KEYS = Object.freeze([
  'targetHas',
  'targetHpBelowPct',
  'playerHas',
  'coreElement',
  'componentSuppressed',
  'handCountAtLeast',
  'all',
  'any',
  'not',
]);

/**
 * Validates a condition's shape. Returns an error message or null.
 * @param {unknown} cond
 * @returns {string | null}
 */
export function checkCondition(cond) {
  if (!cond || typeof cond !== 'object' || Array.isArray(cond))
    return 'condition must be an object';
  const keys = Object.keys(cond);
  if (keys.length !== 1) return 'condition must have exactly one key';
  const [key] = keys;
  const value = /** @type {Record<string, unknown>} */ (cond)[key];
  switch (key) {
    case 'targetHas':
    case 'playerHas':
    case 'coreElement':
      return typeof value === 'string' ? null : `${key} must be a string`;
    case 'targetHpBelowPct':
    case 'handCountAtLeast':
      return typeof value === 'number' ? null : `${key} must be a number`;
    case 'componentSuppressed':
      return value === true ? null : 'componentSuppressed must be true';
    case 'all':
    case 'any':
      if (!Array.isArray(value)) return `${key} must be an array`;
      for (const c of value) {
        const problem = checkCondition(c);
        if (problem) return problem;
      }
      return null;
    case 'not':
      return checkCondition(value);
    default:
      return `unknown condition "${key}"`;
  }
}

/**
 * True when the condition depends on the target, so it can only be evaluated
 * once a target is known (hover preview or resolution).
 * @param {any} cond
 * @returns {boolean}
 */
export function dependsOnTarget(cond) {
  if (!cond) return false;
  if ('targetHas' in cond || 'targetHpBelowPct' in cond) return true;
  if (cond.all) return cond.all.some(dependsOnTarget);
  if (cond.any) return cond.any.some(dependsOnTarget);
  if (cond.not) return dependsOnTarget(cond.not);
  return false;
}

/**
 * @param {any} cond
 * @param {ConditionScope} scope
 * @returns {boolean}
 */
export function evaluateCondition(cond, scope) {
  if (cond === undefined || cond === null) return true;
  if ('targetHas' in cond) return (scope.target?.statuses[cond.targetHas] ?? 0) > 0;
  if ('targetHpBelowPct' in cond) {
    const t = scope.target;
    return !!t && t.hp > 0 && (t.hp / t.maxHp) * 100 < cond.targetHpBelowPct;
  }
  if ('playerHas' in cond) return (scope.player.statuses[cond.playerHas] ?? 0) > 0;
  if ('coreElement' in cond) return scope.coreElement === cond.coreElement;
  if ('componentSuppressed' in cond) return scope.componentSuppressed;
  if ('handCountAtLeast' in cond) return scope.handCount >= cond.handCountAtLeast;
  if ('all' in cond) return cond.all.every((/** @type {any} */ c) => evaluateCondition(c, scope));
  if ('any' in cond) return cond.any.some((/** @type {any} */ c) => evaluateCondition(c, scope));
  if ('not' in cond) return !evaluateCondition(cond.not, scope);
  throw new Error(`Unknown condition: ${JSON.stringify(cond)}`);
}
