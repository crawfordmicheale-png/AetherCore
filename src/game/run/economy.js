// @ts-check
/**
 * Run economy constants (GDD §4.4–4.7). One place to tune them.
 */

/** Cargo Hold size (GDD §4.7). */
export const CARGO_SLOTS = 10;

/** Aether gained by crushing a component, by tier (≈25% of its buy price). */
export const CRUSH_VALUE = Object.freeze({ starter: 5, salvage: 8, refined: 18, prototype: 40 });
/** Rusted (starter) parts always crush for this, whatever their tier. */
export const RUSTED_CRUSH_VALUE = 5;

/** Workbench (GDD §4.4). */
export const TOOL_CHARGES = 3;
export const FIELD_REPAIR_PCT = 30;

/** Deck floor (GDD §2.6). */
export const MIN_DECK_SIZE = 8;

/** Loot tables (GDD §4.6). */
export const LOOT = Object.freeze({
  normal: { drops: 2, refinedChance: 0.25, aether: [12, 20] },
  elite: { refinedPlusChance: 0.4, aether: [30, 40] },
  /** Relative weights of component kinds in random drops. */
  kindWeights: { frame: 2, core: 2, mod: 1 },
  /** Multiplier for a component kind an enemy favors (e.g. Jammer Bots drop Mods). */
  favorMultiplier: 2,
  /** Multiplier for Cores matching a defeated enemy's element bias. */
  elementMultiplier: 3,
});

/** Smelter (GDD §4.5). */
export const SMELTER = Object.freeze({
  prices: { salvage: [30, 45], refined: [70, 90], prototype: [140, 170] },
  tierWeights: { salvage: 60, refined: 30, prototype: 10 },
  saleDiscountPct: 30,
  capacityBase: 50,
  capacityStep: 25,
  maxCapacityBonus: 2,
  fusionCost: 20,
  removalBase: 40,
  removalStep: 15,
});

/** Next tier up, for Fusion and the Conveyor Lottery. */
export const NEXT_TIER = Object.freeze({ salvage: 'refined', refined: 'prototype' });
/** Next tier down. */
export const PREV_TIER = Object.freeze({ prototype: 'refined', refined: 'salvage' });
