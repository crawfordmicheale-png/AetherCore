// @ts-check
/**
 * The Smelter (GDD §4.5): buy parts, upgrade Frame Capacity, fuse three
 * same-tier parts into one of the next tier, or remove a card for good.
 * Functions take the Run so the rules live beside the economy constants.
 */
import { MIN_DECK_SIZE, NEXT_TIER, SMELTER } from './economy.js';
import { RunError } from './errors.js';
import { rollComponent } from './loot.js';

export const FUSION_COST = SMELTER.fusionCost;

/** @typedef {import('./run.js').Run} Run */

const NO_BIAS = { elements: new Set(), favor: new Set() };

/**
 * Applies the Salvage Rights discount.
 * @param {Run} run
 * @param {number} base
 */
export function discounted(run, base) {
  return Math.round((base * (100 - run.effect('smelterDiscountPct'))) / 100);
}

/**
 * Six offers: two Frames, two Cores, two Mods, one of them on sale.
 * @param {Run} run
 * @returns {import('./run.js').SmelterOffer[]}
 */
export function rollOffers(run) {
  const kinds = /** @type {const} */ (['frame', 'frame', 'core', 'core', 'mod', 'mod']);
  return run.rng('smelter', (r) => {
    const sale = r.int(0, kinds.length - 1);
    return kinds.map((kind, i) => {
      const tiers = /** @type {Array<keyof typeof SMELTER.tierWeights>} */ (
        Object.keys(SMELTER.tierWeights)
      );
      const tier = r.weighted(tiers, (t) => SMELTER.tierWeights[t]);
      const defId = rollComponent(run.registry, r, { kind, tiers: [tier], bias: NO_BIAS });
      const actualTier = /** @type {keyof typeof SMELTER.prices} */ (run.registry.get(defId).tier);
      const [lo, hi] = SMELTER.prices[actualTier];
      let price = r.int(lo, hi);
      if (i === sale) price = Math.round((price * (100 - SMELTER.saleDiscountPct)) / 100);
      return { uid: run.newId('o'), defId, price, sale: i === sale, sold: false };
    });
  });
}

/**
 * @param {Run} run
 * @param {number} cost
 */
function pay(run, cost) {
  if (run.state.aether < cost)
    throw new RunError(`Needs ${cost} Aether (you have ${run.state.aether})`);
  run.state.aether -= cost;
}

/**
 * @param {Run} run
 * @param {string} offerUid
 */
export function buy(run, offerUid) {
  run.requirePhase('smelter');
  const offer = run.state.smelter?.offers.find((o) => o.uid === offerUid);
  if (!offer) throw new RunError('That is not for sale here');
  if (offer.sold) throw new RunError('Already sold');
  if (run.cargoFree <= 0) throw new RunError('Cargo Hold is full: crush something first');
  const cost = discounted(run, offer.price);
  pay(run, cost);
  offer.sold = true;
  const part = { uid: run.newId('p'), defId: offer.defId };
  run.state.cargo.items.push(part);
  return { part, cost };
}

/** @param {Run} run */
export function capacityUpgradeCost(run) {
  return discounted(
    run,
    SMELTER.capacityBase + SMELTER.capacityStep * run.state.counters.capacityUpgrades,
  );
}

/**
 * +1 Capacity on a Frame in your deck or Cargo (max +2 per Frame).
 * @param {Run} run
 * @param {{ cardUid: string } | { cargoUid: string }} target
 */
export function upgradeCapacity(run, target) {
  run.requirePhase('smelter');
  const frame =
    'cardUid' in target ? run.card(target.cardUid).frame : run.cargoItem(target.cargoUid);
  if (run.registry.kindOf(frame.defId) !== 'frame') throw new RunError('Only Frames have Capacity');
  if ((frame.capacityBonus ?? 0) >= SMELTER.maxCapacityBonus) {
    throw new RunError(`That Frame is already upgraded +${SMELTER.maxCapacityBonus}`);
  }
  const cost = capacityUpgradeCost(run);
  pay(run, cost);
  frame.capacityBonus = (frame.capacityBonus ?? 0) + 1;
  run.state.counters.capacityUpgrades += 1;
  return { frame, cost };
}

/**
 * Three Cargo parts of the same tier become one random part of the chosen
 * kind at the next tier.
 * @param {Run} run
 * @param {string[]} cargoUids
 * @param {'frame' | 'core' | 'mod'} kind
 */
export function fuse(run, cargoUids, kind) {
  run.requirePhase('smelter');
  if (new Set(cargoUids).size !== 3)
    throw new RunError('Fusion needs exactly three different parts');
  if (!['frame', 'core', 'mod'].includes(kind)) throw new RunError('Choose Frame, Core, or Mod');
  const parts = cargoUids.map((uid) => run.cargoItem(uid));
  const tiers = new Set(parts.map((p) => run.registry.get(p.defId).tier));
  if (tiers.size !== 1) throw new RunError('All three parts must be the same tier');
  const [tier] = tiers;
  const next = /** @type {Record<string, string>} */ (NEXT_TIER)[tier];
  if (!next) throw new RunError('Prototype parts are already the highest tier');
  const cost = discounted(run, SMELTER.fusionCost);
  pay(run, cost);
  const defId = run.rng('smelter', (r) =>
    rollComponent(run.registry, r, { kind, tiers: [next], bias: NO_BIAS }),
  );
  const used = new Set(cargoUids);
  run.state.cargo.items = run.state.cargo.items.filter(
    (p) => !used.has(/** @type {string} */ (p.uid)),
  );
  const part = { uid: run.newId('p'), defId };
  run.state.cargo.items.push(part);
  return { part, cost };
}

/** @param {Run} run */
export function removalCost(run) {
  return discounted(run, SMELTER.removalBase + SMELTER.removalStep * run.state.counters.removals);
}

/**
 * Removes a card (and its parts) from the deck for good.
 * @param {Run} run
 * @param {string} cardUid
 */
export function removeCard(run, cardUid) {
  run.requirePhase('smelter');
  const card = run.card(cardUid);
  if (run.state.deck.length - 1 < MIN_DECK_SIZE)
    throw new RunError(`Your deck can't go below ${MIN_DECK_SIZE} cards`);
  const cost = removalCost(run);
  pay(run, cost);
  run.state.deck = run.state.deck.filter((c) => c !== card);
  run.state.counters.removals += 1;
  return { card, cost };
}
