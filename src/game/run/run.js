// @ts-check
/**
 * Run state and the crafting loop (GDD §2.6, §4.4, §4.6, §4.7).
 *
 * Like combat, all run state is a plain JSON object (`RunState`) wrapped by
 * a class holding the rules. Every operation validates first and throws a
 * `RunError` with a player-facing reason, so the UI can show exactly why an
 * action is refused (and can ask `check*` helpers before offering it).
 */
import { Combat } from '../combat/combat.js';
import { OVERCLOCK_LIMIT } from '../core/content.js';
import { RngStreams, Rng } from '../core/rng.js';
import { deriveCard } from '../model/card.js';
import { buildSandboxDeck, buildStarterDeck } from '../model/deck.js';
import {
  CARGO_SLOTS,
  CRUSH_VALUE,
  FIELD_REPAIR_PCT,
  MIN_DECK_SIZE,
  RUSTED_CRUSH_VALUE,
  TOOL_CHARGES,
} from './economy.js';
import { GAUNTLET } from './gauntlet.js';
import { rollComponent, rollLoot } from './loot.js';

/**
 * @typedef {import('../model/card.js').CardInstance} CardInstance
 * @typedef {import('../model/card.js').ComponentInstance} ComponentInstance
 * @typedef {'frame' | 'core' | 'mod'} Slot
 *
 * @typedef {object} RunState
 * @property {number} version
 * @property {string} seed
 * @property {string} chassisId
 * @property {Record<string, import('../core/rng.js').RngState>} rng
 * @property {number} hp
 * @property {number} maxHp
 * @property {number} aether
 * @property {number} nextId
 * @property {CardInstance[]} deck
 * @property {{ slots: number, items: ComponentInstance[] }} cargo
 * @property {number} step              Index into the Gauntlet.
 * @property {'combat' | 'loot' | 'workbench' | 'won' | 'lost'} phase
 * @property {string | null} encounterId
 * @property {import('../combat/combat.js').CombatState | null} combat  Live combat, for save/resume.
 * @property {{ items: ComponentInstance[], aether: number } | null} loot  Unclaimed loot tray.
 * @property {{ charges: number, used: number, repaired: boolean } | null} workbench
 * @property {{ fieldKitUsed: boolean }} flags
 * @property {{ combatsWon: number, aetherEarned: number, partsCrushed: number, cardsAssembled: number }} stats
 */

export const RUN_VERSION = 1;

export class RunError extends Error {}

export class Run {
  /**
   * @param {RunState} state
   * @param {{ registry: import('../core/registry.js').Registry }} env
   */
  constructor(state, env) {
    this.state = state;
    this.registry = env.registry;
  }

  /**
   * @param {object} opts
   * @param {import('../core/registry.js').Registry} opts.registry
   * @param {string} opts.chassisId
   * @param {string} opts.seed
   * @param {'starter' | 'sandbox'} [opts.deck]
   */
  static create({ registry, chassisId, seed, deck = 'starter' }) {
    const chassis = registry.get(chassisId);
    const cards =
      deck === 'sandbox' ? buildSandboxDeck(registry) : buildStarterDeck(registry, chassisId);
    /** @type {RunState} */
    const state = {
      version: RUN_VERSION,
      seed,
      chassisId,
      rng: RngStreams.fromSeed(seed).serialize(),
      hp: chassis.hp,
      maxHp: chassis.hp,
      aether: 0,
      nextId: 1,
      deck: cards,
      cargo: { slots: CARGO_SLOTS, items: [] },
      step: 0,
      phase: 'combat',
      encounterId: null,
      combat: null,
      loot: null,
      workbench: null,
      flags: { fieldKitUsed: false },
      stats: { combatsWon: 0, aetherEarned: 0, partsCrushed: 0, cardsAssembled: 0 },
    };
    const run = new Run(state, { registry });
    // Card uids continue after the starter deck's.
    state.nextId = cards.length + 1;
    for (const entry of chassis.cargo) {
      const defId =
        entry.id ??
        run.rng('loot', (r) =>
          rollComponent(registry, r, {
            kind: entry.random.kind,
            tiers: [entry.random.tier],
            bias: { elements: new Set(), favor: new Set() },
          }),
        );
      state.cargo.items.push({ uid: run.newId('p'), defId });
    }
    run.enterStep();
    return run;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * @template T
   * @param {string} stream
   * @param {(rng: Rng) => T} fn
   * @returns {T}
   */
  rng(stream, fn) {
    const rng = new Rng(this.state.rng[stream]);
    const result = fn(rng);
    this.state.rng[stream] = rng.serialize();
    return result;
  }

  /** @param {string} prefix */
  newId(prefix) {
    return `${prefix}${this.state.nextId++}`;
  }

  get chassis() {
    return this.registry.get(this.state.chassisId);
  }

  get currentStep() {
    return GAUNTLET[this.state.step] ?? null;
  }

  get over() {
    return this.state.phase === 'won' || this.state.phase === 'lost';
  }

  get cargoFree() {
    return this.state.cargo.slots - this.state.cargo.items.length;
  }

  /** @param {ComponentInstance} part */
  crushValue(part) {
    if (part.rusted) return RUSTED_CRUSH_VALUE;
    const tier = /** @type {keyof typeof CRUSH_VALUE} */ (this.registry.get(part.defId).tier);
    return CRUSH_VALUE[tier];
  }

  /** @param {string} uid */
  card(uid) {
    const card = this.state.deck.find((c) => c.uid === uid);
    if (!card) throw new RunError('That card is not in your deck');
    return card;
  }

  /** @param {string} uid */
  cargoItem(uid) {
    const item = this.state.cargo.items.find((c) => c.uid === uid);
    if (!item) throw new RunError('That part is not in your Cargo Hold');
    return item;
  }

  /** @param {string} phase */
  requirePhase(phase) {
    if (this.state.phase !== phase) throw new RunError(`Not available during ${this.state.phase}`);
  }

  /** @param {number} amount */
  gainAether(amount) {
    this.state.aether += amount;
    this.state.stats.aetherEarned += amount;
  }

  /**
   * Strips Cargo-only fields when a part is socketed into a card.
   * @param {ComponentInstance} item
   * @returns {ComponentInstance}
   */
  static socketed(item) {
    const { uid: _uid, ...rest } = item;
    return rest;
  }

  // ---------------------------------------------------------------------------
  // Gauntlet flow
  // ---------------------------------------------------------------------------

  enterStep() {
    const step = this.currentStep;
    const s = this.state;
    if (!step) {
      s.phase = 'won';
      return;
    }
    if (step.type === 'combat') {
      const pool = this.registry.all('encounter').filter((e) => e.kind === step.pool);
      const choices = pool.length > 1 ? pool.filter((e) => e.id !== s.encounterId) : pool;
      s.encounterId = this.rng('map', (r) => r.pick(choices)).id;
      s.phase = 'combat';
    } else {
      // Field Kit (Tinker): the first Workbench of the Stratum grants +1 Tool Charge.
      const fieldKit = this.chassis.passive?.id === 'field_kit' && !s.flags.fieldKitUsed;
      if (fieldKit) s.flags.fieldKitUsed = true;
      s.workbench = { charges: TOOL_CHARGES + (fieldKit ? 1 : 0), used: 0, repaired: false };
      s.phase = 'workbench';
    }
  }

  advance() {
    if (this.over) throw new RunError('The run is over');
    this.state.step += 1;
    this.enterStep();
  }

  // ---------------------------------------------------------------------------
  // Combat
  // ---------------------------------------------------------------------------

  /**
   * Starts (or resumes) the current combat. The returned Combat shares its
   * state object with the run, so saving the run saves the fight.
   * @param {import('../core/events.js').EventBus | null} [bus]
   */
  startCombat(bus = null) {
    this.requirePhase('combat');
    const s = this.state;
    if (s.combat) return new Combat(s.combat, { registry: this.registry, bus });
    const chassis = this.chassis;
    const combat = Combat.create({
      registry: this.registry,
      bus,
      encounterId: /** @type {string} */ (s.encounterId),
      deck: s.deck,
      player: { hp: s.hp, maxHp: s.maxHp },
      seed: `${s.seed}:combat:${s.step}`,
      energyPerTurn: chassis.energy,
      drawPerTurn: chassis.draw,
    });
    combat.start();
    s.combat = combat.state;
    return combat;
  }

  /**
   * Resolves a finished combat: HP carries over, loot is rolled into the tray.
   * @returns {{ won: boolean, loot: { items: ComponentInstance[], aether: number } | null }}
   */
  finishCombat() {
    this.requirePhase('combat');
    const s = this.state;
    const combat = s.combat;
    if (!combat || (combat.phase !== 'won' && combat.phase !== 'lost'))
      throw new RunError('The combat is not over');
    s.combat = null;
    if (combat.phase === 'lost') {
      s.hp = 0;
      s.phase = 'lost';
      return { won: false, loot: null };
    }
    s.hp = combat.player.hp;
    s.stats.combatsWon += 1;
    const encounter = this.registry.get(combat.encounterId);
    const roll = this.rng('loot', (r) =>
      rollLoot(this.registry, r, {
        encounterKind: encounter.kind,
        enemyDefIds: combat.enemies.map((e) => e.defId),
        bonusRolls: combat.bonusLoot ?? 0,
      }),
    );
    s.loot = {
      items: roll.defIds.map((defId) => ({ uid: this.newId('p'), defId })),
      aether: roll.aether,
    };
    this.gainAether(roll.aether);
    s.phase = 'loot';
    return { won: true, loot: s.loot };
  }

  // ---------------------------------------------------------------------------
  // Loot tray and Cargo
  // ---------------------------------------------------------------------------

  /** @param {string} uid */
  takeLoot(uid) {
    this.requirePhase('loot');
    const loot = /** @type {NonNullable<RunState['loot']>} */ (this.state.loot);
    const i = loot.items.findIndex((p) => p.uid === uid);
    if (i === -1) throw new RunError('That part is not in the loot tray');
    if (this.cargoFree <= 0) throw new RunError('Cargo Hold is full: crush something first');
    this.state.cargo.items.push(...loot.items.splice(i, 1));
  }

  /**
   * Crushes a part from the loot tray or the Cargo Hold into Aether.
   * @param {string} uid
   * @returns {number} Aether gained
   */
  crush(uid) {
    if (this.over || this.state.phase === 'combat')
      throw new RunError('You can only crush parts outside combat');
    const s = this.state;
    for (const list of [s.cargo.items, s.loot?.items ?? []]) {
      const i = list.findIndex((p) => p.uid === uid);
      if (i === -1) continue;
      const [part] = list.splice(i, 1);
      const value = this.crushValue(part);
      this.gainAether(value);
      s.stats.partsCrushed += 1;
      return value;
    }
    throw new RunError('Nothing to crush');
  }

  /** Leaves the loot tray (unclaimed parts are lost) and moves on. */
  leaveLoot() {
    this.requirePhase('loot');
    this.state.loot = null;
    this.advance();
  }

  /**
   * Returns a part removed from a card to the Cargo Hold. Rusted parts, or
   * any part when the hold is full, are crushed instead.
   * @param {ComponentInstance} part
   * @returns {{ toCargo: boolean, aether: number }}
   */
  stow(part) {
    if (part.rusted || this.cargoFree <= 0) {
      const value = this.crushValue(part);
      this.gainAether(value);
      this.state.stats.partsCrushed += 1;
      return { toCargo: false, aether: value };
    }
    this.state.cargo.items.push({ ...part, uid: this.newId('p') });
    return { toCargo: true, aether: 0 };
  }

  // ---------------------------------------------------------------------------
  // Workbench
  // ---------------------------------------------------------------------------

  get chargesLeft() {
    const wb = this.state.workbench;
    return wb ? wb.charges - wb.used : 0;
  }

  /** @param {number} cost */
  requireCharges(cost) {
    this.requirePhase('workbench');
    if (this.chargesLeft < cost) {
      throw new RunError(
        `Needs ${cost} Tool Charge${cost === 1 ? '' : 's'} (${this.chargesLeft} left)`,
      );
    }
  }

  /** @param {number} cost */
  spendCharges(cost) {
    /** @type {NonNullable<RunState['workbench']>} */ (this.state.workbench).used += cost;
  }

  /**
   * Checks a would-be card: slot kinds, and the +2 Overclock limit (GDD §2.3).
   * @param {CardInstance} card
   */
  checkCard(card) {
    for (const slot of /** @type {Slot[]} */ (['frame', 'core', 'mod'])) {
      const part = card[slot];
      if (!part) {
        if (slot !== 'mod')
          throw new RunError(`A card needs a ${slot === 'frame' ? 'Frame' : 'Core'}`);
        continue;
      }
      if (this.registry.kindOf(part.defId) !== slot)
        throw new RunError(`That part does not fit the ${slot} socket`);
    }
    const derived = deriveCard(card, { registry: this.registry });
    if (derived.overclock > OVERCLOCK_LIMIT) {
      throw new RunError(
        `Too heavy: ${derived.weight} weight on capacity ${derived.capacity} (Overclock limit is +${OVERCLOCK_LIMIT})`,
      );
    }
    return derived;
  }

  /**
   * Builds a new card from Cargo parts. 1 Tool Charge.
   * @param {{ frame: string, core: string, mod?: string | null }} parts Cargo uids
   */
  assemble(parts) {
    this.requireCharges(1);
    const frame = this.cargoItem(parts.frame);
    const core = this.cargoItem(parts.core);
    const mod = parts.mod ? this.cargoItem(parts.mod) : null;
    /** @type {CardInstance} */
    const card = {
      uid: `c${this.state.nextId}`,
      frame: Run.socketed(frame),
      core: Run.socketed(core),
      ...(mod ? { mod: Run.socketed(mod) } : {}),
    };
    const derived = this.checkCard(card);
    this.state.nextId += 1;
    const used = new Set([parts.frame, parts.core, parts.mod].filter(Boolean));
    this.state.cargo.items = this.state.cargo.items.filter(
      (p) => !used.has(/** @type {string} */ (p.uid)),
    );
    this.state.deck.push(card);
    this.spendCharges(1);
    this.state.stats.cardsAssembled += 1;
    return { card, derived };
  }

  /**
   * Replaces components on an existing card in one weld. Each changed slot
   * costs 1 Tool Charge (GDD §4.4 Swap). `mod: null` removes the Mod.
   * Removed parts return to Cargo (Rusted parts are crushed).
   * @param {string} cardUid
   * @param {{ frame?: string, core?: string, mod?: string | null }} changes Cargo uids
   */
  modify(cardUid, changes) {
    const card = this.card(cardUid);
    const slots = /** @type {Slot[]} */ (Object.keys(changes)).filter(
      (slot) => changes[slot] !== undefined,
    );
    if (slots.length === 0) throw new RunError('Nothing to change');
    if (slots.includes('mod') && changes.mod === null && !card.mod)
      throw new RunError('That card has no Mod to remove');
    this.requireCharges(slots.length);

    /** @type {CardInstance} */
    const next = structuredClone(card);
    for (const slot of slots) {
      const uid = changes[slot];
      if (uid === null) delete next.mod;
      else next[slot] = Run.socketed(this.cargoItem(/** @type {string} */ (uid)));
    }
    const derived = this.checkCard(next);

    const incoming = new Set(slots.map((slot) => changes[slot]).filter(Boolean));
    this.state.cargo.items = this.state.cargo.items.filter((p) => !incoming.has(p.uid));
    const removed = slots.map((slot) => card[slot]).filter((p) => p !== undefined);
    Object.assign(card, next);
    if (!next.mod) delete card.mod;
    const stowed = removed.map((part) => ({ defId: part.defId, ...this.stow(part) }));
    this.spendCharges(slots.length);
    return { card, derived, stowed };
  }

  /**
   * Breaks a card into its parts. 1 Tool Charge. The deck cannot drop below 8.
   * @param {string} cardUid
   */
  dismantle(cardUid) {
    this.requireCharges(1);
    const card = this.card(cardUid);
    if (this.state.deck.length - 1 < MIN_DECK_SIZE)
      throw new RunError(`Your deck can't go below ${MIN_DECK_SIZE} cards`);
    this.state.deck = this.state.deck.filter((c) => c !== card);
    const parts = [card.frame, card.core, ...(card.mod ? [card.mod] : [])];
    const stowed = parts.map((part) => ({ defId: part.defId, ...this.stow(part) }));
    this.spendCharges(1);
    return { stowed };
  }

  /**
   * Permanently reduces a Core's or Mod's weight by 1. Once per part. 1 Tool Charge.
   * @param {{ cargoUid: string } | { cardUid: string, slot: 'core' | 'mod' }} target
   */
  tune(target) {
    this.requireCharges(1);
    const part =
      'cargoUid' in target
        ? this.cargoItem(target.cargoUid)
        : this.card(target.cardUid)[target.slot];
    if (!part) throw new RunError('There is no part in that socket');
    const kind = this.registry.kindOf(part.defId);
    if (kind !== 'core' && kind !== 'mod') throw new RunError('Only Cores and Mods can be tuned');
    if (part.tuned) throw new RunError('That part is already tuned');
    if (this.registry.get(part.defId).weight === 0)
      throw new RunError('That part already weighs nothing');
    part.tuned = true;
    this.spendCharges(1);
    return { part };
  }

  /** Heals 30% max HP instead of crafting; uses the whole visit (GDD §4.4). */
  fieldRepair() {
    this.requirePhase('workbench');
    const wb = /** @type {NonNullable<RunState['workbench']>} */ (this.state.workbench);
    if (wb.used > 0)
      throw new RunError('Field Repair must be the only thing you do at this Workbench');
    if (this.state.hp >= this.state.maxHp) throw new RunError('Already at full HP');
    const amount = Math.floor((this.state.maxHp * FIELD_REPAIR_PCT) / 100);
    const healed = Math.min(amount, this.state.maxHp - this.state.hp);
    this.state.hp += healed;
    wb.used = wb.charges;
    wb.repaired = true;
    return { healed };
  }

  leaveWorkbench() {
    this.requirePhase('workbench');
    this.state.workbench = null;
    this.advance();
  }
}
