// @ts-check
/**
 * Card stat derivation (GDD §2.2, docs/TECHNICAL_DESIGN.md §5).
 *
 * `deriveCard` is a pure function from (card instance, context) to the card's
 * effective stats. Everything that displays or resolves a card goes through
 * it, so the card face, the Exploded View, the hover preview, and the actual
 * result can never disagree.
 */
import { dependsOnTarget, evaluateCondition } from './conditions.js';
import { REINFORCE_BONUS } from './statuses.js';

/**
 * @typedef {{ defId: string, uid?: string, tuned?: boolean, capacityBonus?: number, rusted?: boolean }} ComponentInstance
 *   `rusted` marks starter parts (crush for 5, never return to Cargo); `uid` identifies a part in Cargo.
 * @typedef {{ uid: string, frame: ComponentInstance, core: ComponentInstance, mod?: ComponentInstance }} CardInstance
 *
 * @typedef {object} DerivationContext
 * @property {import('../core/registry.js').Registry} registry
 * @property {{ mod?: boolean, coreRider?: boolean }} [suppression] Active slot suppression for this card.
 * @property {number} [rustCount]      Rust Slag in hand (-1 Capacity each).
 * @property {{ statuses: Record<string, number> }} [player]
 * @property {string[]} [otherHandElements] Core elements of the *other* cards in hand.
 * @property {number} [timesPlayed]    Times this card was played this combat.
 * @property {{ hp: number, maxHp: number, statuses: Record<string, number> } | null} [target]
 *
 * @typedef {{ kind: string, stacks: number }} Rider
 * @typedef {{ source: 'frame' | 'core' | 'mod' | 'status' | 'slag', label: string, stat?: string, value?: number, note?: string }} BreakdownLine
 *   Lines with `stat: 'value'` sum to `valuePerHit`; other stats (cost, hits, capacity) are adjustments; note-only lines explain state.
 *
 * @typedef {object} DerivedCard
 * @property {string} uid
 * @property {string} name
 * @property {'attack' | 'defend' | 'utility'} verb
 * @property {string | null} utility  Utility frame rule id (e.g. "conduit"), if any.
 * @property {'single' | 'all' | 'random' | 'self'} target
 * @property {string} element
 * @property {number} cost
 * @property {number} valuePerHit
 * @property {number} hits
 * @property {number} damageMult      Target-dependent multiplier (1 when no target is given).
 * @property {Rider | null} rider
 * @property {number} draw            Cards drawn by the frame itself (Relay).
 * @property {string[]} keywords
 * @property {number} weight
 * @property {number} capacity
 * @property {number} overclock       Weight over capacity (0 = stable).
 * @property {{ mod: boolean, coreRider: boolean }} suppressed
 * @property {any[]} onPlay           Ops to run after the card's main effect (from active components).
 * @property {any[]} onKill           Ops to run when this card kills an enemy.
 * @property {string[]} modText       Rules text contributed by the active Mod.
 * @property {boolean} hasTargetConditions True if hovering a target may change the numbers.
 * @property {BreakdownLine[]} breakdown
 * @property {string} hash
 */

/** Attack-verb rider per element (GDD §2.4). */
const ATTACK_RIDERS = {
  kinetic: 'crush',
  thermal: 'burn',
  voltaic: 'shock',
  aether: 'pierce',
  cryo: 'chill',
};
/** Defend-verb rider per element. */
const DEFEND_RIDERS = {
  kinetic: 'reinforce',
  thermal: 'searing',
  voltaic: 'charge',
  aether: 'ward',
  cryo: 'rime',
};

/** Riders that are fixed effects rather than status stacks. */
export const FIXED_RIDERS = Object.freeze(['crush', 'pierce', 'reinforce', 'ward', 'rime']);

/**
 * @param {string} element
 * @param {'attack' | 'defend'} mode
 * @param {number | null} riderValue
 * @returns {Rider | null}
 */
export function riderFor(element, mode, riderValue) {
  const table = mode === 'attack' ? ATTACK_RIDERS : DEFEND_RIDERS;
  const kind = /** @type {Record<string, string>} */ (table)[element];
  if (!kind) return null;
  if (FIXED_RIDERS.includes(kind)) {
    return { kind, stacks: kind === 'reinforce' ? REINFORCE_BONUS : kind === 'ward' ? 1 : 0 };
  }
  if (!riderValue) return null;
  return { kind, stacks: riderValue };
}

/**
 * @param {CardInstance} card
 * @param {DerivationContext} ctx
 * @returns {DerivedCard}
 */
export function deriveCard(card, ctx) {
  const { registry } = ctx;
  const frame = registry.get(card.frame.defId);
  const core = registry.get(card.core.defId);
  const mod = card.mod ? registry.get(card.mod.defId) : null;

  /** @type {BreakdownLine[]} */
  const breakdown = [];

  // 1. Active components. Unsuppressable Mods (Fail-Safe) ignore suppression.
  const modSuppressed = !!mod && !!ctx.suppression?.mod && !mod.unsuppressable;
  const riderSuppressed = !!ctx.suppression?.coreRider;
  const activeMod = mod && !modSuppressed ? mod : null;
  const componentSuppressed = modSuppressed || riderSuppressed;

  const scope = {
    target: ctx.target ?? null,
    player: ctx.player ?? { statuses: {} },
    coreElement: core.element,
    componentSuppressed,
    handCount: (ctx.otherHandElements?.length ?? 0) + 1,
  };

  /** Modifiers from all active components, tagged with their source. */
  const modifiers = [
    ...(frame.modifiers ?? []).map((/** @type {any} */ m) => ({
      ...m,
      source: 'frame',
      label: frame.name,
    })),
    ...(core.modifiers ?? []).map((/** @type {any} */ m) => ({
      ...m,
      source: 'core',
      label: core.name,
    })),
    ...(activeMod?.modifiers ?? []).map((/** @type {any} */ m) => ({
      ...m,
      source: 'mod',
      label: /** @type {any} */ (activeMod).name,
    })),
  ];
  const hasTargetConditions = modifiers.some((m) => dependsOnTarget(m.when));

  /**
   * Sum of additive modifiers for a stat whose conditions pass.
   * @param {string} stat
   * @param {boolean} [record] add a breakdown line per contributing modifier
   */
  const sumMods = (stat, record = true) => {
    let total = 0;
    for (const m of modifiers) {
      if (m.stat !== stat || m.add === undefined) continue;
      if (!evaluateCondition(m.when, scope)) continue;
      const amount = m.add * perMultiplier(m.per, ctx, core.element);
      if (amount !== 0) {
        total += amount;
        if (record) breakdown.push({ source: m.source, label: m.label, stat, value: amount });
      }
    }
    return total;
  };

  // 2. Capacity and weight.
  const rust = ctx.rustCount ?? 0;
  const capacity = Math.max(0, frame.capacity + (card.frame.capacityBonus ?? 0) - rust);
  const coreWeight = Math.max(0, core.weight - (card.core.tuned ? 1 : 0));
  const modWeight = activeMod ? Math.max(0, activeMod.weight - (card.mod?.tuned ? 1 : 0)) : 0;
  const weight = coreWeight + modWeight;
  const overclock = Math.max(0, weight - capacity);

  // 3. Cost. Jammed is previewed on every card because it applies to the next card played.
  const jammed = (ctx.player?.statuses.jammed ?? 0) > 0 ? 1 : 0;
  const cost = Math.max(0, frame.cost + sumMods('cost') + jammed);

  // 4. Value per hit (attack damage or defend block).
  const verb = frame.verb;
  let valuePerHit = 0;
  let hits = 1;
  if (verb !== 'utility') {
    breakdown.unshift({
      source: 'frame',
      label: `${frame.name} base`,
      stat: 'value',
      value: frame.base,
    });
    // Power modifiers are folded into the Core's line so the breakdown sums to the total.
    const powerBonus = sumMods('power', false);
    const corePart = Math.floor((core.power + powerBonus) * frame.coreScaling);
    const notes = [
      powerBonus ? `${powerBonus > 0 ? '+' : ''}${powerBonus} power` : '',
      frame.coreScaling === 1 ? '' : `×${frame.coreScaling}`,
    ].filter(Boolean);
    breakdown.splice(1, 0, {
      source: 'core',
      label: notes.length ? `${core.name} (${notes.join(', ')})` : core.name,
      stat: 'value',
      value: corePart,
    });
    valuePerHit = Math.max(0, frame.base + corePart + sumMods('value'));
    // 5. Hits.
    hits = Math.max(1, frame.hits + sumMods('hits'));
  }

  // Target-dependent multipliers (e.g. Executioner). Only known once a target is.
  let damageMult = 1;
  for (const m of modifiers) {
    if (m.stat === 'damageMult' && m.mul !== undefined && evaluateCondition(m.when, scope)) {
      damageMult *= m.mul;
      breakdown.push({ source: m.source, label: m.label, note: `×${m.mul} damage` });
    }
  }

  // 6. Element rider, interpreted by the verb (or the Utility frame's rule).
  /** @type {Rider | null} */
  let rider = null;
  let draw = 0;
  if (!riderSuppressed && !core.riderless) {
    if (verb === 'attack') rider = riderFor(core.element, 'attack', core.rider);
    else if (verb === 'defend') rider = riderFor(core.element, 'defend', core.rider);
    else if (frame.utility === 'conduit') {
      const r = riderFor(core.element, 'attack', core.rider);
      // Conduit applies the Attack rider twice; fixed riders have nothing to apply.
      rider = r && !FIXED_RIDERS.includes(r.kind) ? { kind: r.kind, stacks: r.stacks * 2 } : null;
    } else if (frame.utility === 'relay') {
      rider = riderFor(core.element, 'defend', core.rider);
    }
  }
  if (frame.utility === 'relay') draw = 1;
  if (riderSuppressed)
    breakdown.push({ source: 'core', label: core.name, note: 'rider suppressed' });

  // 7. Keywords.
  const keywords = new Set(frame.keywords);
  for (const k of activeMod?.keywords ?? []) keywords.add(k);
  if (overclock > 0) keywords.add('exhaust');

  if (mod && modSuppressed) breakdown.push({ source: 'mod', label: mod.name, note: 'suppressed' });
  if (rust > 0)
    breakdown.push({ source: 'slag', label: 'Rust Slag', stat: 'capacity', value: -rust });
  if (jammed) breakdown.push({ source: 'status', label: 'Jammed', stat: 'cost', value: 1 });

  const onPlay = [...(frame.hooks?.cardPlayed ?? []), ...(activeMod?.hooks?.cardPlayed ?? [])];
  const onKill = [...(frame.hooks?.enemyKilled ?? []), ...(activeMod?.hooks?.enemyKilled ?? [])];

  /** @type {Omit<DerivedCard, 'hash'>} */
  const derived = {
    uid: card.uid,
    name: `${core.adjective} ${frame.name}`,
    verb,
    utility: frame.utility ?? null,
    target: frame.target,
    element: core.element,
    cost,
    valuePerHit,
    hits,
    damageMult,
    rider,
    draw,
    keywords: [...keywords].sort(),
    weight,
    capacity,
    overclock,
    suppressed: { mod: modSuppressed, coreRider: riderSuppressed },
    onPlay,
    onKill,
    modText: activeMod ? [activeMod.text] : [],
    hasTargetConditions,
    breakdown,
  };
  return { ...derived, hash: hashDerived(card, derived) };
}

/**
 * @param {string | undefined} per
 * @param {DerivationContext} ctx
 * @param {string} element
 */
function perMultiplier(per, ctx, element) {
  if (!per) return 1;
  if (per === 'otherSameElementInHand') {
    return (ctx.otherHandElements ?? []).filter((e) => e === element).length;
  }
  if (per === 'timesPlayed') return ctx.timesPlayed ?? 0;
  throw new Error(`Unknown modifier "per": ${per}`);
}

export const PER_KEYS = Object.freeze(['otherSameElementInHand', 'timesPlayed']);

/**
 * Stable render-cache key: changes whenever anything visible on the card changes.
 * @param {CardInstance} card
 * @param {Omit<DerivedCard, 'hash'>} d
 */
function hashDerived(card, d) {
  const key = JSON.stringify([
    card.frame.defId,
    card.core.defId,
    card.mod?.defId ?? null,
    d.cost,
    d.valuePerHit,
    d.hits,
    d.damageMult,
    d.rider,
    d.keywords,
    d.weight,
    d.capacity,
    d.suppressed,
  ]);
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
