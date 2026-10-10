// @ts-check
/**
 * Status definitions (GDD §2.5). Behavior lives in the combat engine; this
 * table holds the metadata both the engine and the UI need.
 */

/**
 * @typedef {object} StatusDef
 * @property {string} name
 * @property {boolean} debuff  Debuffs can be blocked by Ward.
 * @property {string} text
 */

/** @type {Readonly<Record<string, StatusDef>>} */
export const STATUS_DEFS = Object.freeze({
  burn: {
    name: 'Burn',
    debuff: true,
    text: 'Takes X damage (ignoring Block) at the end of its turn, then X decreases by 1.',
  },
  shock: {
    name: 'Shock',
    debuff: true,
    text: 'The next attack hit taken deals +3 damage per stack. Consumed on hit.',
  },
  chill: {
    name: 'Chill',
    debuff: true,
    text: 'Deals 25% less attack damage. Decreases by 1 each turn.',
  },
  strength: { name: 'Strength', debuff: false, text: 'Attack hits deal +X damage.' },
  charge: { name: 'Charge', debuff: false, text: 'At 3 Charge, consume 3 and gain 1 Energy.' },
  jammed: { name: 'Jammed', debuff: true, text: 'Your next card played costs +1.' },
  searing: { name: 'Searing', debuff: false, text: 'The next enemy to attack you gains Burn X.' },
  ward: { name: 'Ward', debuff: false, text: 'Prevents the next debuff applied to you.' },
  plated: {
    name: 'Plated',
    debuff: false,
    text: 'Attack damage taken is reduced by X per hit; -1 per hit received.',
  },
  crucible: {
    name: 'Crucible Heat',
    debuff: false,
    text: 'At the end of your turn, you take X damage for each Slag in your hand.',
  },
  fortified: {
    name: 'Fortified',
    debuff: false,
    text: 'Gains X Block at the start of each of its turns.',
  },
});

export const STATUS_IDS = Object.freeze(Object.keys(STATUS_DEFS));

/** Bonus damage per Shock stack (GDD §2.5). */
export const SHOCK_BONUS_PER_STACK = 3;
/** Chill damage multiplier. */
export const CHILL_MULTIPLIER = 0.75;
/** Charge needed to convert into 1 Energy. */
export const CHARGE_THRESHOLD = 3;
/** Kinetic Defend rider bonus. */
export const REINFORCE_BONUS = 2;
