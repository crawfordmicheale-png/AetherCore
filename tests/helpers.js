// @ts-check
import { Registry } from '../src/game/core/registry.js';
import { Combat } from '../src/game/combat/combat.js';
import { loadContentFromDisk } from '../tools/load-content.js';

export const bundle = await loadContentFromDisk();
export const registry = new Registry(bundle);

/**
 * Shorthand for a card instance: card('frame_strike', 'core_scrap', 'mod_whetted').
 * @param {string} frame
 * @param {string} core
 * @param {string} [mod]
 * @param {string} [uid]
 * @returns {import('../src/game/model/card.js').CardInstance}
 */
export function card(frame, core, mod, uid = 'x1') {
  return {
    uid,
    frame: { defId: frame },
    core: { defId: core },
    ...(mod ? { mod: { defId: mod } } : {}),
  };
}

/**
 * Builds a started combat where `hand` holds exactly the given cards (uids h1..hN)
 * and the draw pile holds `draw` filler cards. Energy and enemy HP are overridable.
 *
 * @param {object} opts
 * @param {Array<[string, string, string?]>} opts.hand
 * @param {string} [opts.encounter]
 * @param {number} [opts.energy]
 * @param {number[]} [opts.enemyHp]
 * @param {number} [opts.drawFiller]
 * @param {import('../src/game/core/events.js').EventBus} [opts.bus]
 */
export function setupCombat({
  hand,
  encounter = 'enc_drones',
  energy = 3,
  enemyHp,
  drawFiller = 10,
  bus,
}) {
  const deck = [
    ...hand.map(([f, c, m], i) => card(f, c, m, `h${i + 1}`)),
    ...Array.from({ length: drawFiller }, (_, i) =>
      card('frame_brace', 'core_scrap', undefined, `d${i + 1}`),
    ),
  ];
  const combat = Combat.create({
    registry,
    bus: bus ?? null,
    encounterId: encounter,
    deck,
    player: { hp: 50, maxHp: 50 },
    seed: 'test-seed',
  });
  combat.start();
  const { piles } = combat.state;
  piles.hand = hand.map((_, i) => `h${i + 1}`);
  piles.draw = deck.map((c) => c.uid).filter((uid) => !piles.hand.includes(uid));
  piles.discard = [];
  combat.state.energy = energy;
  if (enemyHp) {
    combat.state.enemies.forEach((e, i) => {
      if (enemyHp[i] !== undefined) e.hp = e.maxHp = enemyHp[i];
    });
  }
  return combat;
}
