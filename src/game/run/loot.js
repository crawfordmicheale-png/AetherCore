// @ts-check
/**
 * Post-combat loot (GDD §4.6). Pure: takes content and an RNG, returns
 * component definition ids and Aether. The run assigns instance uids.
 */
import { LOOT } from './economy.js';

/**
 * @typedef {'frame' | 'core' | 'mod'} ComponentKind
 * @typedef {{ defIds: string[], aether: number }} LootRoll
 */

/**
 * Components that can drop: unlocked, and never starter-tier parts.
 * @param {import('../core/registry.js').Registry} registry
 * @param {ComponentKind} kind
 * @param {string[]} tiers
 */
export function lootPool(registry, kind, tiers) {
  return registry.all(kind).filter((d) => d.unlock === 'base' && tiers.includes(d.tier));
}

/**
 * Combined loot bias of the defeated enemies.
 * @param {import('../core/registry.js').Registry} registry
 * @param {string[]} enemyDefIds
 */
export function lootBias(registry, enemyDefIds) {
  /** @type {Set<string>} */
  const elements = new Set();
  /** @type {Set<string>} */
  const favor = new Set();
  for (const id of enemyDefIds) {
    const loot = registry.get(id).loot;
    for (const el of loot?.elements ?? []) elements.add(el);
    if (loot?.favor) favor.add(loot.favor);
  }
  return { elements, favor };
}

/**
 * Rolls one random component.
 * @param {import('../core/registry.js').Registry} registry
 * @param {import('../core/rng.js').Rng} rng
 * @param {{ kind?: ComponentKind, tiers: string[], bias: ReturnType<typeof lootBias> }} opts
 * @returns {string} a component defId
 */
export function rollComponent(registry, rng, { kind, tiers, bias }) {
  const kinds = /** @type {ComponentKind[]} */ (['frame', 'core', 'mod']);
  const chosenKind =
    kind ??
    rng.weighted(
      kinds.filter((k) => lootPool(registry, k, tiers).length > 0),
      (k) => LOOT.kindWeights[k] * (bias.favor.has(k) ? LOOT.favorMultiplier : 1),
    );
  let pool = lootPool(registry, chosenKind, tiers);
  if (pool.length === 0) pool = lootPool(registry, chosenKind, ['salvage', 'refined', 'prototype']);
  const def = rng.weighted(pool, (d) =>
    chosenKind === 'core' && bias.elements.has(d.element) ? LOOT.elementMultiplier : 1,
  );
  return def.id;
}

/**
 * @param {import('../core/registry.js').Registry} registry
 * @param {import('../core/rng.js').Rng} rng
 * @param {{ encounterKind: string, enemyDefIds: string[], bonusRolls?: number }} opts
 * @returns {LootRoll}
 */
export function rollLoot(registry, rng, { encounterKind, enemyDefIds, bonusRolls = 0 }) {
  const bias = lootBias(registry, enemyDefIds);
  /** @type {string[]} */
  const defIds = [];
  const normalTier = () => (rng.chance(LOOT.normal.refinedChance) ? ['refined'] : ['salvage']);

  let aether;
  if (encounterKind === 'elite' || encounterKind === 'boss') {
    // Guaranteed Refined+ Mod, plus one Salvage+ component (GDD §4.6).
    defIds.push(
      rollComponent(registry, rng, { kind: 'mod', tiers: ['refined', 'prototype'], bias }),
    );
    const tiers = rng.chance(LOOT.elite.refinedPlusChance) ? ['refined', 'prototype'] : ['salvage'];
    defIds.push(rollComponent(registry, rng, { tiers, bias }));
    aether = rng.int(LOOT.elite.aether[0], LOOT.elite.aether[1]);
  } else {
    for (let i = 0; i < LOOT.normal.drops; i++) {
      defIds.push(rollComponent(registry, rng, { tiers: normalTier(), bias }));
    }
    aether = rng.int(LOOT.normal.aether[0], LOOT.normal.aether[1]);
  }
  for (let i = 0; i < bonusRolls; i++)
    defIds.push(rollComponent(registry, rng, { tiers: normalTier(), bias }));
  return { defIds, aether };
}
