// @ts-check
/**
 * Builds card instances from content (starter decks today; Workbench output in M2).
 */

/**
 * @param {import('../core/registry.js').Registry} registry
 * @param {string} chassisId
 * @returns {import('./card.js').CardInstance[]}
 */
export function buildStarterDeck(registry, chassisId) {
  const chassis = registry.get(chassisId);
  /** @type {import('./card.js').CardInstance[]} */
  const deck = [];
  for (const entry of chassis.deck) {
    for (let i = 0; i < entry.count; i++) {
      // Starter parts are Rusted (GDD §2.6): they crush for 5 and never return to Cargo.
      deck.push({
        uid: `c${deck.length + 1}`,
        frame: { defId: entry.frame, rusted: true },
        core: { defId: entry.core, rusted: true },
        ...(entry.mod ? { mod: { defId: entry.mod, rusted: true } } : {}),
      });
    }
  }
  return deck;
}

/**
 * Graybox test loadout (M1): the Tinker's starter deck with four Strikes and
 * one Brace swapped for modded cards, so EMP, Dampening, Overclocking,
 * state-check Mods, and Utility frames can all be exercised before the
 * Workbench exists. [frame, core, mod?]
 * @type {ReadonlyArray<readonly [string, string, string?]>}
 */
export const SANDBOX_CARDS = Object.freeze([
  ['frame_heavy_strike', 'core_furnace', 'mod_spring_loaded'],
  ['frame_strike', 'core_furnace', 'mod_whetted'], // Overclocked (+1)
  ['frame_twin_piston', 'core_arc_cell', 'mod_kindling'],
  ['frame_sweep', 'core_ember', 'mod_grounding'],
  ['frame_brace', 'core_ember', 'mod_ballast'],
  ['frame_conduit', 'core_furnace'],
  ['frame_strike', 'core_ember', 'mod_fail_safe'],
  ['frame_relay', 'core_arc_cell'],
]);

/**
 * @param {import('../core/registry.js').Registry} registry
 * @returns {import('./card.js').CardInstance[]}
 */
export function buildSandboxDeck(registry) {
  const starter = buildStarterDeck(registry, 'chassis_tinker');
  const kept = starter.filter((c, i) => !(i < 4 && c.frame.defId === 'frame_strike')).slice(1);
  const extras = SANDBOX_CARDS.map(([frame, core, mod], i) => {
    for (const id of [frame, core, mod]) if (id) registry.get(id); // fail fast on typos
    return {
      uid: `sb${i + 1}`,
      frame: { defId: frame },
      core: { defId: core },
      ...(mod ? { mod: { defId: mod } } : {}),
    };
  });
  return [...kept, ...extras];
}
