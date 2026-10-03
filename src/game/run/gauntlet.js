// @ts-check
/**
 * The M2 Gauntlet: a fixed sequence of nodes that chains combats and
 * Workbenches so the crafting loop can be played before the map exists.
 * The procedural map (M3) replaces it.
 */

/** @typedef {{ type: 'combat', pool: 'easy' | 'normal' | 'elite' } | { type: 'workbench' }} GauntletStep */

/** @type {ReadonlyArray<GauntletStep>} */
export const GAUNTLET = Object.freeze([
  { type: 'combat', pool: 'easy' },
  { type: 'combat', pool: 'easy' },
  { type: 'workbench' },
  { type: 'combat', pool: 'normal' },
  { type: 'workbench' },
  { type: 'combat', pool: 'elite' },
]);
