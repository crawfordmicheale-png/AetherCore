// @ts-check
/**
 * Anomaly (event) rules. Text lives in src/data/events.json; each choice
 * here can say why it is unavailable (`blocked`) and resolves to a line of
 * result text shown to the player.
 */
import { NEXT_TIER, PREV_TIER } from './economy.js';
import { RunError } from './errors.js';
import { rollComponent } from './loot.js';

/**
 * @typedef {import('./run.js').Run} Run
 * @typedef {{ blocked?: (run: Run) => string | null, resolve: (run: Run, params: { cargoUid?: string }) => string }} ChoiceHandler
 */

const NO_BIAS = { elements: new Set(), favor: new Set() };

/** @param {Run} run */
const cargoEmpty = (run) =>
  run.state.cargo.items.length === 0 ? 'Your Cargo Hold is empty' : null;

/**
 * Takes the chosen Cargo part out of the hold.
 * @param {Run} run
 * @param {{ cargoUid?: string }} params
 */
function takeFromCargo(run, params) {
  if (!params.cargoUid) throw new RunError('Choose a part from your Cargo Hold');
  const part = run.cargoItem(params.cargoUid);
  run.state.cargo.items = run.state.cargo.items.filter((p) => p !== part);
  return part;
}

/**
 * Gives a part, crushing it if the hold is full. Returns a phrase for the result text.
 * @param {Run} run
 * @param {string} defId
 */
function givePart(run, defId) {
  const name = run.registry.get(defId).name;
  const { toCargo, aether } = run.stow({ defId });
  return toCargo
    ? `${name} goes into your Cargo Hold.`
    : `Your hold is full, so ${name} is crushed for ${aether} Aether.`;
}

/** @type {Record<string, Record<string, ChoiceHandler>>} */
export const EVENT_HANDLERS = {
  ev_buried_crate: {
    pry: {
      blocked: (run) => (run.state.hp <= 6 ? 'Too damaged to risk it' : null),
      resolve(run) {
        run.loseHp(6);
        const defId = run.rng('events', (r) =>
          rollComponent(run.registry, r, { tiers: ['refined'], bias: NO_BIAS }),
        );
        return `The lid snaps your plating (-6 HP). Inside: ${givePart(run, defId)}`;
      },
    },
    leave: { resolve: () => 'You leave the crate to the slag.' },
  },
  ev_hungry_servitor: {
    feed: {
      blocked: cargoEmpty,
      resolve(run, params) {
        const part = takeFromCargo(run, params);
        const def = run.registry.get(part.defId);
        if (def.tier === 'refined' || def.tier === 'prototype') {
          const owned = new Set(run.state.blueprints);
          const pool = run.registry.all('blueprint').filter((b) => !owned.has(b.id));
          if (pool.length) {
            const bp = run.rng('events', (r) => r.pick(pool));
            run.gainBlueprint(bp.id);
            return `The servitor devours the ${def.name} and coughs up a Blueprint: ${bp.name}.`;
          }
          run.gainAether(40);
          return `The servitor devours the ${def.name} and leaves 40 Aether in thanks.`;
        }
        run.gainAether(25);
        return `The servitor munches the ${def.name} and leaves 25 Aether behind.`;
      },
    },
    ignore: { resolve: () => 'It whirs sadly and wanders off.' },
  },
  ev_conveyor_lottery: {
    swap: {
      blocked: cargoEmpty,
      resolve(run, params) {
        const part = takeFromCargo(run, params);
        const def = run.registry.get(part.defId);
        const up = run.rng('events', (r) => r.chance(0.5));
        const tierMap = /** @type {Record<string, string>} */ (up ? NEXT_TIER : PREV_TIER);
        const tier = tierMap[def.tier] ?? (def.tier === 'starter' ? 'salvage' : def.tier);
        const defId = run.rng('events', (r) =>
          rollComponent(run.registry, r, { tiers: [tier], bias: NO_BIAS }),
        );
        return `${up ? 'Lucky' : 'Unlucky'}: the belt takes your ${def.name}. ${givePart(run, defId)}`;
      },
    },
    walk: { resolve: () => 'You let the belt roll on.' },
  },
  ev_rogue_bench: {
    use: {
      blocked: (run) => (run.state.hp <= 5 ? 'Too damaged to risk it' : null),
      resolve(run) {
        run.loseHp(5);
        run.openWorkbench(1, false);
        return 'Sparks bite into your plating (-5 HP), but the clamps hold.';
      },
    },
    salvage: {
      resolve(run) {
        run.gainAether(30);
        return 'You strip the bench for 30 Aether.';
      },
    },
  },
};
