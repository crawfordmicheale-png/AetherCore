// @ts-check
/**
 * Effect op implementations (docs/TECHNICAL_DESIGN.md §4.3). Every effect in
 * the game, whether from a card, a Mod hook, Slag, or an enemy move, resolves
 * through these functions, so rules live in exactly one place.
 */
import { CHILL_MULTIPLIER, SHOCK_BONUS_PER_STACK } from '../model/statuses.js';

/**
 * @typedef {import('./combat.js').Combat} Combat
 * @typedef {import('./combat.js').Entity} Entity
 *
 * @typedef {object} OpContext
 * @property {string | null} source  'player', an enemy uid, or null (Slag, Burn).
 * @property {string | null} [target] The played card's chosen target.
 * @property {string} [cardUid]      The card being resolved, if any.
 * @property {number} [dealt]        Unblocked damage dealt by this card so far (Siphon).
 * @property {number} [lastValue]    Damage per hit of the card's main effect (Ricochet).
 * @property {string[]} [hitTargets] Enemies hit by the card's main effect.
 */

/**
 * Attack damage before the defender's Plated and Block, applying the
 * attacker's Strength and Chill, the defender's Shock, and multipliers.
 * Shared by resolution and by intent display so they always agree.
 *
 * @param {Entity | null} attacker
 * @param {Entity} defender
 * @param {number} base
 * @param {number} [mult]
 */
export function attackAmount(attacker, defender, base, mult = 1) {
  let amount = base;
  if (attacker) amount += attacker.statuses.strength ?? 0;
  if (attacker) amount += (defender.statuses.shock ?? 0) * SHOCK_BONUS_PER_STACK;
  if (attacker && (attacker.statuses.chill ?? 0) > 0)
    amount = Math.floor(amount * CHILL_MULTIPLIER);
  amount = Math.floor(amount * mult);
  return Math.max(0, amount);
}

/**
 * Resolves the target(s) of an op.
 * @param {Combat} combat
 * @param {any} op
 * @param {OpContext} ctx
 * @param {string} fallback
 * @returns {string[]} entity ids ('player' or enemy uids)
 */
function targetsOf(combat, op, ctx, fallback) {
  const spec = op.target ?? fallback;
  switch (spec) {
    case 'player':
      return ['player'];
    case 'self':
      return ctx.source ? [ctx.source] : [];
    case 'target':
      if (ctx.source && ctx.source !== 'player') return ['player'];
      return ctx.target && combat.enemy(ctx.target)?.alive ? [ctx.target] : [];
    case 'allEnemies':
      return combat.aliveEnemies().map((e) => e.uid);
    case 'randomEnemy': {
      const alive = combat.aliveEnemies();
      return alive.length ? [combat.rng('combat', (r) => r.pick(alive)).uid] : [];
    }
    default:
      throw new Error(`Unknown op target "${spec}"`);
  }
}

/** Default target for "hostile" ops: the player for enemies, the card's target for the player. */
const hostile = (/** @type {OpContext} */ ctx) =>
  ctx.source && ctx.source !== 'player' ? 'player' : 'target';

/** @type {Record<string, (combat: Combat, op: any, ctx: OpContext) => void>} */
export const OPS = {
  damage(combat, op, ctx) {
    const hits = op.hits ?? 1;
    for (let i = 0; i < hits; i++) {
      for (const id of targetsOf(combat, op, ctx, hostile(ctx))) {
        combat.dealDamage(ctx.source, id, op.amount, { pierce: !!op.pierce, ctx });
      }
    }
  },

  block(combat, op, ctx) {
    for (const id of targetsOf(combat, op, ctx, 'self')) combat.gainBlock(id, op.amount);
  },

  applyStatus(combat, op, ctx) {
    for (const id of targetsOf(combat, op, ctx, hostile(ctx))) {
      combat.applyStatus(id, op.status, op.stacks);
    }
  },

  draw(combat, op) {
    combat.draw(op.n);
  },

  gainEnergy(combat, op) {
    combat.gainEnergy(op.n);
  },

  heal(combat, op, ctx) {
    for (const id of targetsOf(combat, op, ctx, 'self')) combat.heal(id, op.amount);
  },

  addSlag(combat, op, ctx) {
    combat.addSlag(op.slag, op.count, op.pile, ctx.source);
  },

  suppress(combat, op, ctx) {
    combat.suppress(op.slot, op.duration, ctx.source);
  },

  exhaustSlag(combat, op) {
    combat.exhaustSlagFromHand(op.count);
  },

  /** Repeat the card's hit once against a random other enemy at a percentage of its value. */
  ricochet(combat, op, ctx) {
    if (!ctx.lastValue) return;
    const hit = new Set(ctx.hitTargets ?? []);
    const others = combat.aliveEnemies().filter((e) => !hit.has(e.uid));
    if (others.length === 0) return;
    const victim = combat.rng('combat', (r) => r.pick(others));
    const amount = Math.floor((ctx.lastValue * op.pct) / 100);
    combat.dealDamage('player', victim.uid, amount, { ctx });
  },

  /** Brings in reinforcements (at most 5 enemies alive). */
  summon(combat, op, ctx) {
    for (let i = 0; i < (op.count ?? 1); i++) {
      if (combat.aliveEnemies().length >= 5) return;
      const enemy = combat.spawnEnemy(op.enemy);
      combat.emit({ type: 'enemySummoned', uid: enemy.uid, defId: op.enemy, source: ctx.source });
    }
  },

  /** Phase change: the source enemy starts cycling a new move pattern. */
  setPattern(combat, op, ctx) {
    const enemy = ctx.source ? combat.enemy(ctx.source) : null;
    if (!enemy) return;
    enemy.pattern = [...op.pattern];
    enemy.patternIndex = 0;
  },

  /** Extra loot rolls for the post-combat reward (Scavenger's Hook). */
  bonusLoot(combat, op) {
    combat.state.bonusLoot = (combat.state.bonusLoot ?? 0) + op.n;
    combat.emit({ type: 'bonusLoot', n: op.n });
  },

  /** Heal 1 per `per` unblocked damage this card dealt, up to `max`. */
  siphon(combat, op, ctx) {
    const amount = Math.min(op.max, Math.floor((ctx.dealt ?? 0) / op.per));
    if (amount > 0) combat.heal('player', amount);
  },
};

/**
 * Status riders from a card (Burn/Shock/Chill on enemies; Searing/Charge/Ward on the player).
 * @param {Combat} combat
 * @param {import('../model/card.js').Rider} rider
 * @param {string} targetId
 */
export function applyRider(combat, rider, targetId) {
  switch (rider.kind) {
    case 'burn':
    case 'shock':
    case 'chill':
      combat.applyStatus(targetId, rider.kind, rider.stacks);
      break;
    case 'searing':
      combat.applyStatus('player', 'searing', rider.stacks);
      break;
    case 'charge':
      combat.gainCharge(rider.stacks);
      break;
    case 'ward':
      combat.applyStatus('player', 'ward', 1);
      break;
    default:
      // crush, pierce, reinforce, rime modify the main effect and are handled there.
      break;
  }
}
