// @ts-check
/** M3 run systems: Smelter, Anomalies, Blueprint run effects, Elite/boss rewards. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRUSH_VALUE, SMELTER, TOOL_CHARGES } from '../src/game/run/economy.js';
import { EVENT_HANDLERS } from '../src/game/run/events.js';
import { Run } from '../src/game/run/run.js';
import { registry } from './helpers.js';

const newRun = () => Run.create({ registry, chassisId: 'chassis_tinker', seed: 'ECON' });

/**
 * @param {string[]} [defIds]
 * @param {number} [aether]
 */
function atSmelter(defIds = [], aether = 500) {
  const run = newRun();
  run.state.cargo.items = defIds.map((defId, i) => ({ uid: `t${i + 1}`, defId }));
  run.state.aether = aether;
  run.enterNode({ type: 'smelter' });
  return run;
}

test('Smelter offers: 2 Frames, 2 Cores, 2 Mods, one on sale, priced by tier', () => {
  const run = atSmelter();
  const offers = /** @type {NonNullable<typeof run.state.smelter>} */ (run.state.smelter).offers;
  assert.deepEqual(
    offers.map((o) => registry.kindOf(o.defId)),
    ['frame', 'frame', 'core', 'core', 'mod', 'mod'],
  );
  assert.equal(offers.filter((o) => o.sale).length, 1);
  for (const o of offers) {
    const [lo, hi] = SMELTER.prices[/** @type {'salvage'} */ (registry.get(o.defId).tier)];
    if (o.sale) assert.ok(o.price < lo);
    else assert.ok(o.price >= lo && o.price <= hi);
  }
});

test('buying: pays Aether, adds to Cargo, refuses when broke, full, or sold', () => {
  const run = atSmelter([], 0);
  const offer = /** @type {any} */ (run.state.smelter).offers[0];
  assert.throws(() => run.buy(offer.uid), /Needs \d+ Aether/);
  run.state.aether = 500;
  const { part, cost } = run.buy(offer.uid);
  assert.equal(run.state.aether, 500 - cost);
  assert.ok(run.state.cargo.items.includes(part));
  assert.throws(() => run.buy(offer.uid), /Already sold/);
  run.state.cargo.items = Array.from({ length: 10 }, (_, i) => ({
    uid: `f${i}`,
    defId: 'core_ember',
  }));
  assert.throws(
    () => run.buy(/** @type {any} */ (run.state.smelter).offers[1].uid),
    /Cargo Hold is full/,
  );
});

test('Capacity Upgrade: +1 per purchase, max +2 per Frame, escalating cost', () => {
  const run = atSmelter(['frame_strike']);
  assert.equal(run.capacityUpgradeCost(), 50);
  run.upgradeCapacity({ cargoUid: 't1' });
  assert.equal(run.capacityUpgradeCost(), 75);
  run.upgradeCapacity({ cargoUid: 't1' });
  assert.equal(run.cargoItem('t1').capacityBonus, 2);
  assert.throws(() => run.upgradeCapacity({ cargoUid: 't1' }), /already upgraded/);
  const deckCard = run.state.deck[0];
  run.upgradeCapacity({ cardUid: deckCard.uid });
  assert.equal(deckCard.frame.capacityBonus, 1);
  assert.equal(run.state.aether, 500 - 50 - 75 - 100);
});

test('Fusion: three same-tier parts become one part of the chosen kind, next tier', () => {
  const run = atSmelter(['frame_strike', 'core_ember', 'mod_whetted', 'core_furnace']);
  assert.throws(() => run.fuse(['t1', 't2', 't4'], 'core'), /same tier/);
  const { part } = run.fuse(['t1', 't2', 't3'], 'mod');
  assert.equal(registry.kindOf(part.defId), 'mod');
  assert.equal(registry.get(part.defId).tier, 'refined');
  assert.equal(run.state.cargo.items.length, 2);
  assert.equal(run.state.aether, 500 - SMELTER.fusionCost);
});

test('card removal: escalating cost, deck floor of 8', () => {
  const run = atSmelter();
  assert.equal(run.removalCost(), 40);
  run.removeCard(run.state.deck[0].uid);
  assert.equal(run.removalCost(), 55);
  run.removeCard(run.state.deck[0].uid);
  assert.equal(run.state.deck.length, 8);
  assert.throws(() => run.removeCard(run.state.deck[0].uid), /below 8/);
});

test('Salvage Rights discounts every Smelter price by 20%', () => {
  const run = atSmelter();
  run.gainBlueprint('bp_salvage_rights');
  assert.equal(run.capacityUpgradeCost(), 40);
  assert.equal(run.removalCost(), 32);
  assert.equal(run.fusionCost(), 16);
});

test('run Blueprints: Torque Wrench, Expanded Hold, Magnetic Sorter, Spare Gasket', () => {
  const run = newRun();
  run.state.flags.fieldKitUsed = true;
  run.gainBlueprint('bp_torque_wrench');
  run.gainBlueprint('bp_expanded_hold');
  run.gainBlueprint('bp_magnetic_sorter');
  run.gainBlueprint('bp_spare_gasket');
  assert.throws(() => run.gainBlueprint('bp_torque_wrench'), /already have/);
  assert.equal(run.state.cargo.slots, 12);
  assert.equal(run.crushValue({ defId: 'core_ember' }), Math.floor(CRUSH_VALUE.salvage * 1.5));
  run.enterNode({ type: 'workbench' });
  assert.equal(run.state.workbench?.charges, TOOL_CHARGES + 1);
  run.state.hp = 10;
  assert.equal(run.fieldRepair().healed, Math.floor(65 * 0.4));
});

test('combat Blueprints reach the combat as mods', () => {
  const run = newRun();
  run.gainBlueprint('bp_ballast_tank');
  run.gainBlueprint('bp_heat_sink');
  run.travel(run.availableNodes()[0]);
  const combat = run.startCombat();
  assert.equal(combat.state.mods?.startBlock, 6);
  assert.equal(combat.state.mods?.heatSink, true);
  assert.equal(combat.state.player.block, 6);
});

test('Elites offer a Blueprint choice; the boss adds a Prototype pick', () => {
  const run = newRun();
  run.enterNode({ type: 'elite' });
  const c = run.startCombat();
  for (const e of c.state.enemies) c.dealDamage('player', e.uid, 999, { pierce: true });
  c.checkEnd();
  const { loot } = run.finishCombat();
  assert.equal(loot?.blueprints?.length, 3);
  assert.equal(loot?.pick, null);
  run.takeBlueprint(/** @type {string[]} */ (loot?.blueprints ?? [])[0]);
  assert.equal(run.state.blueprints.length, 1);
  assert.equal(run.state.stats.elitesDefeated, 1);
  run.leaveLoot();

  run.enterNode({ type: 'boss' });
  const boss = run.startCombat();
  for (const e of boss.state.enemies) boss.dealDamage('player', e.uid, 999, { pierce: true });
  boss.checkEnd();
  const reward = run.finishCombat().loot;
  assert.equal(reward?.pick?.length, 3);
  for (const p of reward?.pick ?? []) assert.equal(registry.get(p.defId).tier, 'prototype');
  run.choosePick(/** @type {string} */ (reward?.pick?.[0].uid));
  assert.ok(run.state.cargo.items.some((p) => registry.get(p.defId).tier === 'prototype'));
});

test('every Anomaly has a handler for each of its choices', () => {
  for (const ev of registry.all('event')) {
    for (const choice of ev.choices)
      assert.ok(EVENT_HANDLERS[ev.id]?.[choice.id], `${ev.id}.${choice.id}`);
  }
});

test('Anomalies: Buried Crate, Hungry Servitor, Conveyor Lottery, Rogue Workbench', () => {
  /** @param {string} id */
  const at = (id) => {
    const run = newRun();
    run.state.phase = 'event';
    run.state.event = { id, result: null };
    return run;
  };
  const crate = at('ev_buried_crate');
  crate.chooseEvent('pry');
  assert.equal(crate.state.hp, 59);
  assert.equal(registry.get(crate.state.cargo.items.at(-1)?.defId ?? '').tier, 'refined');
  assert.throws(() => crate.chooseEvent('leave'), /already made/);
  crate.leaveEvent();
  assert.equal(crate.state.phase, 'map');

  const servitor = at('ev_hungry_servitor');
  servitor.state.cargo.items = [{ uid: 'x', defId: 'mod_scavenger' }];
  servitor.chooseEvent('feed', { cargoUid: 'x' });
  assert.equal(servitor.state.blueprints.length, 1, 'a Refined part buys a Blueprint');
  const empty = at('ev_hungry_servitor');
  empty.state.cargo.items = [];
  assert.equal(empty.eventChoiceBlocked('feed'), 'Your Cargo Hold is empty');
  assert.throws(() => empty.chooseEvent('feed'), /empty/);

  const belt = at('ev_conveyor_lottery');
  belt.state.cargo.items = [{ uid: 'y', defId: 'core_furnace' }];
  belt.chooseEvent('swap', { cargoUid: 'y' });
  const tier = registry.get(belt.state.cargo.items[0].defId).tier;
  assert.ok(tier === 'salvage' || tier === 'prototype', tier);

  const bench = at('ev_rogue_bench');
  bench.chooseEvent('use');
  assert.equal(bench.state.phase, 'workbench');
  assert.equal(bench.state.workbench?.charges, 1);
  assert.equal(bench.state.hp, 60);
  bench.leaveWorkbench();
  assert.equal(bench.state.phase, 'map');
});
