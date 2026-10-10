// @ts-check
/**
 * The combat engine (GDD §3, docs/TECHNICAL_DESIGN.md §3.3).
 *
 * All combat state is a plain, JSON-serializable object (`CombatState`).
 * `Combat` wraps it with the rules. Commands (`playCard`, `endTurn`) resolve
 * synchronously and depth-first: an effect that triggers another effect (a
 * kill triggering an on-death effect) resolves fully before the next one.
 * Every change is reported on the event bus for the renderer to animate.
 *
 * Previews run the real command on a deep clone of the state, so a preview
 * can never disagree with the outcome.
 */
import { Rng, RngStreams } from '../core/rng.js';
import { deriveCard } from '../model/card.js';
import { evaluateCondition } from '../model/conditions.js';
import { CHARGE_THRESHOLD, STATUS_DEFS } from '../model/statuses.js';
import { OPS, applyRider, attackAmount } from './ops.js';

/**
 * @typedef {import('../model/card.js').CardInstance} CardInstance
 * @typedef {import('../model/card.js').DerivedCard} DerivedCard
 * @typedef {import('./ops.js').OpContext} OpContext
 *
 * @typedef {{ hp: number, maxHp: number, block: number, statuses: Record<string, number> }} Entity
 * @typedef {Entity & { uid: string, defId: string, name: string, patternIndex: number, alive: boolean }} EnemyState
 * @typedef {(CardInstance & { kind: 'card' }) | { uid: string, kind: 'slag', defId: string }} CombatCard
 *
 * @typedef {object} CombatState
 * @property {number} version
 * @property {string} encounterId
 * @property {number} turn
 * @property {'player' | 'enemy' | 'won' | 'lost'} phase
 * @property {number} energy
 * @property {number} energyPerTurn
 * @property {number} drawPerTurn
 * @property {number} maxHand
 * @property {Record<string, import('../core/rng.js').RngState>} rng
 * @property {number} nextId
 * @property {Record<string, CombatCard>} cards
 * @property {{ draw: string[], hand: string[], discard: string[], exhaust: string[] }} piles
 * @property {Entity} player
 * @property {EnemyState[]} enemies
 * @property {{ slot: string, source: string | null, untilTurn: number }[]} suppression
 * @property {Record<string, number>} timesPlayed
 * @property {number} bonusLoot  Extra loot rolls earned this combat (Scavenger's Hook).
 *
 * @typedef {object} CombatEnv
 * @property {import('../core/registry.js').Registry} registry
 * @property {import('../core/events.js').EventBus | null} [bus]
 *
 * @typedef {object} IntentView
 * @property {string} moveId
 * @property {string} name
 * @property {string} intent
 * @property {number} [damage]   Per hit, after the enemy's Strength/Chill and the player's Shock.
 * @property {number} [hits]
 * @property {number} [block]
 * @property {string} [status]
 * @property {number} [stacks]
 * @property {string} [slot]
 * @property {string} [slag]
 * @property {number} [count]
 */

export const STATE_VERSION = 1;

export class CombatError extends Error {}

export class Combat {
  /**
   * @param {CombatState} state
   * @param {CombatEnv} env
   */
  constructor(state, env) {
    this.state = state;
    this.registry = env.registry;
    this.bus = env.bus ?? null;
  }

  /**
   * Builds a new combat. Call `start()` to deal the opening hand.
   * @param {object} opts
   * @param {import('../core/registry.js').Registry} opts.registry
   * @param {import('../core/events.js').EventBus | null} [opts.bus]
   * @param {string} opts.encounterId
   * @param {CardInstance[]} opts.deck
   * @param {{ hp: number, maxHp: number }} opts.player
   * @param {string} opts.seed  Seeds this combat's shuffle, ai, and combat streams.
   * @param {number} [opts.energyPerTurn]
   * @param {number} [opts.drawPerTurn]
   */
  static create({
    registry,
    bus,
    encounterId,
    deck,
    player,
    seed,
    energyPerTurn = 3,
    drawPerTurn = 5,
  }) {
    const streams = RngStreams.fromSeed(seed);
    const encounter = registry.get(encounterId);
    /** @type {CombatState} */
    const state = {
      version: STATE_VERSION,
      encounterId,
      turn: 0,
      phase: 'player',
      energy: 0,
      energyPerTurn,
      drawPerTurn,
      maxHand: 10,
      rng: {
        shuffle: streams.get('shuffle').serialize(),
        ai: streams.get('ai').serialize(),
        combat: streams.get('combat').serialize(),
      },
      nextId: 1,
      cards: {},
      piles: { draw: [], hand: [], discard: [], exhaust: [] },
      player: { hp: player.hp, maxHp: player.maxHp, block: 0, statuses: {} },
      enemies: [],
      suppression: [],
      timesPlayed: {},
      bonusLoot: 0,
    };
    for (const card of deck) {
      state.cards[card.uid] = /** @type {CombatCard} */ ({
        ...structuredClone(card),
        kind: 'card',
      });
      state.piles.draw.push(card.uid);
    }
    const combat = new Combat(state, { registry, bus });
    encounter.enemies.forEach((/** @type {string} */ defId, /** @type {number} */ i) => {
      const def = registry.get(defId);
      const hp = combat.rng('ai', (r) => r.int(def.hp[0], def.hp[1]));
      const patternIndex =
        def.start === 'random' ? combat.rng('ai', (r) => r.int(0, def.pattern.length - 1)) : 0;
      state.enemies.push({
        uid: `e${i + 1}`,
        defId,
        name: def.name,
        hp,
        maxHp: hp,
        block: 0,
        statuses: { ...(def.statuses ?? {}) },
        patternIndex,
        alive: true,
      });
    });
    return combat;
  }

  /** Shuffles the deck (Innate cards on top) and starts turn 1. */
  start() {
    if (this.state.turn !== 0) throw new CombatError('Combat already started');
    const { draw } = this.state.piles;
    this.rng('shuffle', (r) => r.shuffle(draw));
    // Innate cards go on top of the draw pile (the end of the array).
    const innate = draw.filter((uid) => this.keywordsOf(uid).includes('innate'));
    this.state.piles.draw = [...draw.filter((uid) => !innate.includes(uid)), ...innate];
    this.emit({ type: 'combatStarted', encounterId: this.state.encounterId });
    this.startPlayerTurn();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Runs `fn` with a live RNG for `stream` and writes the advanced state back.
   * @template T
   * @param {'shuffle' | 'ai' | 'combat'} stream
   * @param {(rng: Rng) => T} fn
   * @returns {T}
   */
  rng(stream, fn) {
    const rng = new Rng(this.state.rng[stream]);
    const result = fn(rng);
    this.state.rng[stream] = rng.serialize();
    return result;
  }

  get over() {
    return this.state.phase === 'won' || this.state.phase === 'lost';
  }

  /** @param {string} uid */
  enemy(uid) {
    return this.state.enemies.find((e) => e.uid === uid) ?? null;
  }

  aliveEnemies() {
    return this.state.enemies.filter((e) => e.alive);
  }

  /**
   * @param {string} id 'player' or an enemy uid
   * @returns {Entity}
   */
  entity(id) {
    if (id === 'player') return this.state.player;
    const e = this.enemy(id);
    if (!e) throw new CombatError(`Unknown entity "${id}"`);
    return e;
  }

  /** @param {string} uid */
  card(uid) {
    const card = this.state.cards[uid];
    if (!card) throw new CombatError(`Unknown card "${uid}"`);
    return card;
  }

  /** @param {string} slot */
  isSuppressed(slot) {
    return this.state.suppression.some((s) => s.slot === slot);
  }

  /** Total Capacity penalty from Slag in hand (Rust Slag). */
  rustCount() {
    let total = 0;
    for (const uid of this.state.piles.hand) {
      const c = this.state.cards[uid];
      if (c.kind === 'slag') total -= this.registry.get(c.defId).capacityInHand ?? 0;
    }
    return total;
  }

  /**
   * Derives a card's current stats. With `targetUid`, target-dependent
   * modifiers (Kindling, Executioner) are included.
   * @param {string} uid
   * @param {string | null} [targetUid]
   * @returns {DerivedCard}
   */
  derive(uid, targetUid = null) {
    const card = this.card(uid);
    if (card.kind !== 'card') throw new CombatError(`"${uid}" is Slag, not a composite card`);
    const target = targetUid ? this.enemy(targetUid) : null;
    return deriveCard(card, {
      registry: this.registry,
      suppression: { mod: this.isSuppressed('mod'), coreRider: this.isSuppressed('coreRider') },
      rustCount: this.rustCount(),
      player: this.state.player,
      otherHandElements: this.state.piles.hand
        .filter((h) => h !== uid)
        .map((h) => this.state.cards[h])
        .filter((c) => c.kind === 'card')
        .map((c) => this.registry.get(/** @type {CardInstance} */ (c).core.defId).element),
      timesPlayed: this.state.timesPlayed[uid] ?? 0,
      target: target && target.alive ? target : null,
    });
  }

  /** @param {string} uid */
  keywordsOf(uid) {
    const card = this.card(uid);
    if (card.kind === 'slag')
      return /** @type {string[]} */ (this.registry.get(card.defId).keywords);
    return this.derive(uid).keywords;
  }

  /**
   * Energy cost of a card in hand, or null if it is unplayable.
   * @param {string} uid
   */
  costOf(uid) {
    const card = this.card(uid);
    if (card.kind === 'slag') {
      const cost = this.registry.get(card.defId).cost;
      if (cost === null) return null;
      return cost + ((this.state.player.statuses.jammed ?? 0) > 0 ? 1 : 0);
    }
    return this.derive(uid).cost;
  }

  /** @param {string} uid */
  needsTarget(uid) {
    const card = this.card(uid);
    return card.kind === 'card' && this.derive(uid).target === 'single';
  }

  /**
   * @param {string} uid
   * @param {string | null} [targetUid]
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  canPlay(uid, targetUid = null) {
    if (this.state.phase !== 'player') return { ok: false, reason: 'Not your turn' };
    if (!this.state.piles.hand.includes(uid)) return { ok: false, reason: 'Card is not in hand' };
    const cost = this.costOf(uid);
    if (cost === null) return { ok: false, reason: 'Unplayable' };
    if (cost > this.state.energy) return { ok: false, reason: 'Not enough Energy' };
    if (this.needsTarget(uid)) {
      if (targetUid === null) return { ok: true }; // target chosen later
      if (!this.enemy(targetUid)?.alive) return { ok: false, reason: 'Invalid target' };
    }
    return { ok: true };
  }

  /**
   * What an enemy will do on its next turn, with exact numbers.
   * @param {string} uid
   * @returns {IntentView | null}
   */
  intentOf(uid) {
    const enemy = this.enemy(uid);
    if (!enemy?.alive) return null;
    const def = this.registry.get(enemy.defId);
    const moveId = def.pattern[enemy.patternIndex % def.pattern.length];
    const move = def.moves.find((/** @type {any} */ m) => m.id === moveId);
    /** @type {IntentView} */
    const view = { moveId, name: move.name, intent: move.intent };
    for (const op of move.ops) {
      if (op.op === 'damage' && view.damage === undefined) {
        view.damage = attackAmount(enemy, this.state.player, op.amount);
        view.hits = op.hits ?? 1;
      } else if (op.op === 'block' && view.block === undefined) {
        view.block = op.amount;
      } else if (op.op === 'applyStatus' && view.status === undefined) {
        view.status = op.status;
        view.stacks = op.stacks;
      } else if (op.op === 'suppress') {
        view.slot = op.slot;
      } else if (op.op === 'addSlag') {
        view.slag = op.slag;
        view.count = op.count;
      }
    }
    return view;
  }

  /**
   * Exact outcome of playing a card, computed by playing it on a clone.
   * Draws and other hidden information are not exposed.
   * @param {string} uid
   * @param {string | null} [targetUid]
   */
  preview(uid, targetUid = null) {
    const check = this.canPlay(uid, targetUid);
    if (!check.ok || (this.needsTarget(uid) && targetUid === null)) return null;
    const clone = new Combat(structuredClone(this.state), { registry: this.registry, bus: null });
    clone.playCard(uid, targetUid);
    const card = this.card(uid);
    const random = card.kind === 'card' && this.derive(uid).target === 'random';
    return {
      /** Random-target outcomes are not revealed. */
      random,
      player: diffEntity(this.state.player, clone.state.player),
      enemies: this.state.enemies.map((e, i) => ({
        uid: e.uid,
        ...diffEntity(e, clone.state.enemies[i]),
      })),
      energyAfter: clone.state.energy,
    };
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  /**
   * @param {string} uid
   * @param {string | null} [targetUid]
   */
  playCard(uid, targetUid = null) {
    const check = this.canPlay(uid, targetUid);
    if (!check.ok) throw new CombatError(`Cannot play ${uid}: ${check.reason}`);
    const card = this.card(uid);
    const needsTarget = this.needsTarget(uid);
    if (needsTarget && targetUid === null) throw new CombatError(`Card ${uid} needs a target`);
    if (!needsTarget) targetUid = null;

    // Pay the cost (Jammed is part of it, then consumed).
    const cost = /** @type {number} */ (this.costOf(uid));
    const derivedBefore = card.kind === 'card' ? this.derive(uid) : null;
    this.state.energy -= cost;
    if ((this.state.player.statuses.jammed ?? 0) > 0) this.setStatus('player', 'jammed', 0);
    this.emit({ type: 'energyChanged', energy: this.state.energy });

    this.removeFromPile('hand', uid);
    this.emit({ type: 'cardPlayed', uid, targetUid, cost });

    if (card.kind === 'card' && derivedBefore) {
      this.triggerSlagInHand(derivedBefore.element);
      if (!this.over) this.resolveCard(uid, targetUid);
      this.state.timesPlayed[uid] = (this.state.timesPlayed[uid] ?? 0) + 1;
    }

    // The card leaves play. Exhaust is evaluated now, with only active components.
    const exhaust = this.keywordsOf(uid).includes('exhaust');
    if (exhaust) {
      this.state.piles.exhaust.push(uid);
      const overclock = card.kind === 'card' ? this.derive(uid).overclock : 0;
      this.emit({ type: 'cardExhausted', uid, overclock });
    } else {
      this.state.piles.discard.push(uid);
      this.emit({ type: 'cardDiscarded', uid });
    }
    this.checkEnd();
  }

  endTurn() {
    if (this.state.phase !== 'player') throw new CombatError('Not the player turn');
    const { hand } = this.state.piles;

    // End-of-turn effects of Slag in hand.
    for (const uid of [...hand]) {
      const c = this.state.cards[uid];
      if (c.kind !== 'slag') continue;
      const ops = this.registry.get(c.defId).endOfTurnInHand;
      if (ops) this.resolve(ops, { source: null });
      if (this.over) return;
    }

    this.tickEndOfTurn('player');
    if (this.checkEnd()) return;

    // Discard the hand, keeping Retain cards; Ethereal cards Exhaust.
    for (const uid of [...hand]) {
      const keywords = this.keywordsOf(uid);
      if (keywords.includes('retain')) continue;
      this.removeFromPile('hand', uid);
      if (keywords.includes('ethereal')) {
        this.state.piles.exhaust.push(uid);
        this.emit({ type: 'cardExhausted', uid, overclock: 0 });
      } else {
        this.state.piles.discard.push(uid);
        this.emit({ type: 'cardDiscarded', uid });
      }
    }

    // Suppression lasts through the player's turn it was aimed at.
    const expired = this.state.suppression.filter((s) => s.untilTurn <= this.state.turn);
    this.state.suppression = this.state.suppression.filter((s) => s.untilTurn > this.state.turn);
    for (const s of expired) this.emit({ type: 'suppressionExpired', slot: s.slot });

    this.emit({ type: 'turnEnded', turn: this.state.turn });
    this.runEnemyTurn();
    if (!this.over) this.startPlayerTurn();
  }

  // ---------------------------------------------------------------------------
  // Turn flow
  // ---------------------------------------------------------------------------

  startPlayerTurn() {
    const s = this.state;
    s.turn += 1;
    s.phase = 'player';
    s.player.block = 0;
    // Searing and Ward last until the start of your next turn.
    this.setStatus('player', 'searing', 0);
    this.setStatus('player', 'ward', 0);
    s.energy = s.energyPerTurn;
    this.emit({ type: 'turnStarted', turn: s.turn });
    this.emit({ type: 'energyChanged', energy: s.energy });
    this.draw(s.drawPerTurn);
    // The turn is fully set up (hand drawn): a safe point to autosave.
    this.emit({ type: 'turnReady', turn: s.turn });
  }

  runEnemyTurn() {
    this.state.phase = 'enemy';
    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      enemy.block = 0;
      const fortified = enemy.statuses.fortified ?? 0;
      if (fortified > 0) this.gainBlock(enemy.uid, fortified);

      const def = this.registry.get(enemy.defId);
      const moveId = def.pattern[enemy.patternIndex % def.pattern.length];
      const move = def.moves.find((/** @type {any} */ m) => m.id === moveId);
      this.emit({
        type: 'enemyMove',
        uid: enemy.uid,
        moveId,
        name: move.name,
        intent: move.intent,
      });
      this.resolve(move.ops, { source: enemy.uid });
      enemy.patternIndex = (enemy.patternIndex + 1) % def.pattern.length;
      if (this.over) return;

      if (enemy.alive) this.tickEndOfTurn(enemy.uid);
      if (this.checkEnd()) return;
    }
  }

  /**
   * Burn ticks (ignoring Block) and Chill decays at the end of an entity's turn.
   * @param {string} id
   */
  tickEndOfTurn(id) {
    const e = this.entity(id);
    const burn = e.statuses.burn ?? 0;
    if (burn > 0) {
      this.dealDamage(null, id, burn, { pierce: true, kind: 'burn' });
      this.setStatus(id, 'burn', burn - 1);
    }
    const chill = e.statuses.chill ?? 0;
    if (chill > 0) this.setStatus(id, 'chill', chill - 1);
  }

  /** @returns {boolean} true if the combat is over */
  checkEnd() {
    if (this.over) return true;
    if (this.state.player.hp <= 0) {
      this.state.phase = 'lost';
      this.emit({ type: 'combatLost' });
      return true;
    }
    if (this.aliveEnemies().length === 0) {
      this.state.phase = 'won';
      this.emit({ type: 'combatWon' });
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Card resolution
  // ---------------------------------------------------------------------------

  /**
   * Slag in hand that reacts to the element of the card being played.
   * @param {string} element
   */
  triggerSlagInHand(element) {
    for (const uid of [...this.state.piles.hand]) {
      const c = this.state.cards[uid];
      if (c.kind !== 'slag') continue;
      for (const trigger of this.registry.get(c.defId).onCardPlayedInHand ?? []) {
        const scope = {
          target: null,
          player: this.state.player,
          coreElement: element,
          componentSuppressed: false,
          handCount: this.state.piles.hand.length,
        };
        if (evaluateCondition(trigger.when, scope)) this.resolve(trigger.ops, { source: null });
        if (this.over) return;
      }
    }
  }

  /**
   * @param {string} uid
   * @param {string | null} targetUid
   */
  resolveCard(uid, targetUid) {
    const d = this.derive(uid, targetUid);
    /** @type {OpContext} */
    const ctx = { source: 'player', target: targetUid, cardUid: uid, dealt: 0, hitTargets: [] };

    if (d.verb === 'attack') {
      const pierce = d.rider?.kind === 'pierce';
      const crush = d.rider?.kind === 'crush';
      /** @type {Set<string>} */
      const hit = new Set();
      for (let i = 0; i < d.hits; i++) {
        /** @type {string[]} */
        let targets = [];
        if (d.target === 'single') targets = targetUid ? [targetUid] : [];
        else if (d.target === 'all') targets = this.aliveEnemies().map((e) => e.uid);
        else if (d.target === 'random') {
          const alive = this.aliveEnemies();
          targets = alive.length ? [this.rng('combat', (r) => r.pick(alive)).uid] : [];
        }
        for (const t of targets) {
          if (!this.enemy(t)?.alive) continue;
          // Re-derive per target so conditional Mods see that target's state.
          const dt = this.derive(uid, t);
          ctx.lastValue = dt.valuePerHit;
          this.dealDamage('player', t, dt.valuePerHit, { pierce, crush, mult: dt.damageMult, ctx });
          hit.add(t);
          if (this.over) return;
        }
      }
      ctx.hitTargets = [...hit];
      if (d.rider) for (const t of hit) if (this.enemy(t)?.alive) applyRider(this, d.rider, t);
    } else if (d.verb === 'defend') {
      let total = d.valuePerHit * d.hits;
      if (d.rider?.kind === 'reinforce' && this.state.player.block > 0) total += d.rider.stacks;
      this.gainBlock('player', total);
      if (d.rider) applyRider(this, d.rider, 'player');
    } else if (d.utility === 'conduit') {
      if (d.rider && targetUid) applyRider(this, d.rider, targetUid);
    } else if (d.utility === 'relay') {
      if (d.rider) applyRider(this, d.rider, 'player');
      this.draw(d.draw);
    }

    if (!this.over && d.onPlay.length) this.resolve(d.onPlay, ctx);
  }

  /**
   * Resolves ops in order, depth-first. Stops if the combat ends.
   * @param {any[]} ops
   * @param {OpContext} ctx
   */
  resolve(ops, ctx) {
    for (const op of ops) {
      if (this.over) return;
      const fn = OPS[op.op];
      if (!fn) throw new CombatError(`Unknown op "${op.op}"`);
      fn(this, op, ctx);
    }
  }

  // ---------------------------------------------------------------------------
  // Primitive effects (called by ops)
  // ---------------------------------------------------------------------------

  /**
   * @param {string | null} sourceId  null for Slag/Burn (no attacker statuses apply)
   * @param {string} targetId
   * @param {number} base
   * @param {{ pierce?: boolean, crush?: boolean, mult?: number, ctx?: OpContext, kind?: string }} [opts]
   */
  dealDamage(sourceId, targetId, base, opts = {}) {
    const target = this.entity(targetId);
    if (targetId !== 'player' && !(/** @type {EnemyState} */ (target).alive)) return;
    const attacker = sourceId ? this.entity(sourceId) : null;
    let amount = attackAmount(attacker, target, base, opts.mult ?? 1);
    if (sourceId) this.setStatus(targetId, 'shock', 0); // Shock is consumed by any attack hit

    if (sourceId) {
      const plated = target.statuses.plated ?? 0;
      if (plated > 0) {
        amount = Math.max(0, amount - plated);
        this.setStatus(targetId, 'plated', plated - 1);
      }
    }

    let blocked = 0;
    if (!opts.pierce && target.block > 0) {
      if (opts.crush) {
        // Crush: each point of damage removes 2 Block.
        const toBlock = Math.min(amount, Math.ceil(target.block / 2));
        blocked = Math.min(target.block, toBlock * 2);
        target.block -= blocked;
        amount -= toBlock;
      } else {
        blocked = Math.min(target.block, amount);
        target.block -= blocked;
        amount -= blocked;
      }
    }
    target.hp = Math.max(0, target.hp - amount);
    if (opts.ctx && sourceId === 'player') opts.ctx.dealt = (opts.ctx.dealt ?? 0) + amount;
    this.emit({
      type: 'damage',
      sourceId,
      targetId,
      amount,
      blocked,
      kind: opts.kind ?? (sourceId ? 'attack' : 'raw'),
    });

    // Searing: the first enemy to attack you gains Burn.
    if (targetId === 'player' && sourceId && sourceId !== 'player') {
      const searing = this.state.player.statuses.searing ?? 0;
      if (searing > 0) {
        this.setStatus('player', 'searing', 0);
        this.applyStatus(sourceId, 'burn', searing);
      }
    }

    if (targetId !== 'player' && target.hp <= 0) this.killEnemy(targetId, opts.ctx);
    else if (targetId === 'player' && target.hp <= 0) this.checkEnd();
  }

  /**
   * @param {string} uid
   * @param {OpContext} [ctx] the card effect that dealt the killing blow, if any
   */
  killEnemy(uid, ctx) {
    const enemy = /** @type {EnemyState} */ (this.enemy(uid));
    if (!enemy.alive) return;
    enemy.alive = false;
    enemy.block = 0;
    enemy.statuses = {};
    this.emit({ type: 'enemyDied', uid });
    const onDeath = this.registry.get(enemy.defId).onDeath;
    if (onDeath) this.resolve(onDeath, { source: uid });
    // On-kill hooks of the card that landed the blow (Scavenger's Hook).
    if (ctx?.cardUid && ctx.source === 'player' && !this.over) {
      const onKill = this.derive(ctx.cardUid).onKill;
      if (onKill.length) this.resolve(onKill, { ...ctx, target: uid });
    }
  }

  /**
   * @param {string} id
   * @param {number} amount
   */
  gainBlock(id, amount) {
    if (amount <= 0) return;
    this.entity(id).block += amount;
    this.emit({ type: 'blockGained', targetId: id, amount });
  }

  /**
   * @param {string} id
   * @param {number} amount
   */
  heal(id, amount) {
    const e = this.entity(id);
    const healed = Math.min(amount, e.maxHp - e.hp);
    if (healed <= 0) return;
    e.hp += healed;
    this.emit({ type: 'heal', targetId: id, amount: healed });
  }

  /**
   * Adds stacks of a status. Ward on the player blocks the next debuff.
   * @param {string} id
   * @param {string} status
   * @param {number} stacks
   */
  applyStatus(id, status, stacks) {
    const e = this.entity(id);
    if (id !== 'player' && !(/** @type {EnemyState} */ (e).alive)) return;
    if (id === 'player' && STATUS_DEFS[status]?.debuff && (e.statuses.ward ?? 0) > 0) {
      this.setStatus('player', 'ward', 0);
      this.emit({ type: 'statusBlocked', targetId: id, status });
      return;
    }
    this.setStatus(id, status, (e.statuses[status] ?? 0) + stacks);
    this.emit({ type: 'statusApplied', targetId: id, status, stacks });
  }

  /**
   * Sets a status value, removing the key at 0 so state stays tidy.
   * @param {string} id
   * @param {string} status
   * @param {number} value
   */
  setStatus(id, status, value) {
    const e = this.entity(id);
    if (value > 0) e.statuses[status] = value;
    else delete e.statuses[status];
  }

  /** @param {number} n */
  gainEnergy(n) {
    this.state.energy += n;
    this.emit({ type: 'energyChanged', energy: this.state.energy });
  }

  /** @param {number} stacks */
  gainCharge(stacks) {
    let charge = (this.state.player.statuses.charge ?? 0) + stacks;
    this.emit({ type: 'statusApplied', targetId: 'player', status: 'charge', stacks });
    while (charge >= CHARGE_THRESHOLD) {
      charge -= CHARGE_THRESHOLD;
      this.gainEnergy(1);
    }
    this.setStatus('player', 'charge', charge);
  }

  /** @param {number} n */
  draw(n) {
    const { piles } = this.state;
    for (let i = 0; i < n; i++) {
      if (piles.draw.length === 0) {
        if (piles.discard.length === 0) return;
        piles.draw = this.rng('shuffle', (r) => r.shuffle([...piles.discard]));
        piles.discard = [];
        this.emit({ type: 'shuffled', count: piles.draw.length });
      }
      const uid = /** @type {string} */ (piles.draw.pop());
      if (piles.hand.length >= this.state.maxHand) {
        piles.discard.push(uid);
        this.emit({ type: 'cardDiscarded', uid, overdraw: true });
        continue;
      }
      piles.hand.push(uid);
      this.emit({ type: 'cardDrawn', uid });
    }
  }

  /**
   * @param {string} slagId
   * @param {number} count
   * @param {'draw' | 'hand' | 'discard'} pile
   * @param {string | null} source
   */
  addSlag(slagId, count, pile, source) {
    const { piles } = this.state;
    for (let i = 0; i < count; i++) {
      const uid = `s${this.state.nextId++}`;
      this.state.cards[uid] = { uid, kind: 'slag', defId: slagId };
      if (pile === 'draw') {
        const at = this.rng('shuffle', (r) => r.int(0, piles.draw.length));
        piles.draw.splice(at, 0, uid);
      } else if (pile === 'hand' && piles.hand.length < this.state.maxHand) {
        piles.hand.push(uid);
      } else {
        piles.discard.push(uid);
      }
      this.emit({ type: 'slagAdded', uid, defId: slagId, pile, source });
    }
  }

  /** @param {number} count */
  exhaustSlagFromHand(count) {
    let left = count;
    for (const uid of [...this.state.piles.hand]) {
      if (left <= 0) return;
      if (this.state.cards[uid].kind !== 'slag') continue;
      this.removeFromPile('hand', uid);
      this.state.piles.exhaust.push(uid);
      this.emit({ type: 'cardExhausted', uid, overclock: 0 });
      left--;
    }
  }

  /**
   * Suppresses a slot type through the player's next `duration` turns.
   * @param {string} slot
   * @param {number} duration
   * @param {string | null} source
   */
  suppress(slot, duration, source) {
    const untilTurn = this.state.turn + duration;
    const existing = this.state.suppression.find((s) => s.slot === slot);
    if (existing) existing.untilTurn = Math.max(existing.untilTurn, untilTurn);
    else this.state.suppression.push({ slot, source, untilTurn });
    this.emit({ type: 'componentSuppressed', slot, source, untilTurn });
  }

  /**
   * @param {'draw' | 'hand' | 'discard' | 'exhaust'} pile
   * @param {string} uid
   */
  removeFromPile(pile, uid) {
    const list = this.state.piles[pile];
    const i = list.indexOf(uid);
    if (i === -1) throw new CombatError(`Card ${uid} is not in ${pile}`);
    list.splice(i, 1);
  }

  /** @param {import('../core/events.js').GameEvent} event */
  emit(event) {
    this.bus?.emit(event);
  }
}

/**
 * @param {Entity} before
 * @param {Entity} after
 */
function diffEntity(before, after) {
  return {
    hpBefore: before.hp,
    hpAfter: after.hp,
    blockBefore: before.block,
    blockAfter: after.block,
    dies: before.hp > 0 && after.hp <= 0,
  };
}
