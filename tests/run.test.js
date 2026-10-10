// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/game/core/events.js';
import { Rng } from '../src/game/core/rng.js';
import { CRUSH_VALUE, RUSTED_CRUSH_VALUE, TOOL_CHARGES } from '../src/game/run/economy.js';
import { rollLoot } from '../src/game/run/loot.js';
import { Run, RunError } from '../src/game/run/run.js';
import { registry } from './helpers.js';

/** @param {Partial<Parameters<typeof Run.create>[0]>} [opts] */
const newRun = (opts = {}) =>
  Run.create({ registry, chassisId: 'chassis_tinker', seed: 'RUN-TEST', ...opts });

/**
 * Puts the run at a Workbench with the given parts in Cargo.
 * @param {string[]} defIds
 * @param {Partial<Parameters<typeof Run.create>[0]>} [opts]
 */
function atWorkbench(defIds, opts = {}) {
  const run = newRun(opts);
  run.state.cargo.items = defIds.map((defId, i) => ({ uid: `t${i + 1}`, defId }));
  run.state.flags.fieldKitUsed = true; // plain 3 charges unless a test says otherwise
  run.enterNode({ type: 'workbench' });
  return run;
}

/**
 * Travels to the first node on the map (always a combat) and starts the fight.
 * @param {Run} run
 */
function startFirst(run) {
  if (run.state.phase === 'map') run.travel(run.availableNodes()[0]);
  return run.startCombat();
}

/** Plays a combat to the end with a simple greedy policy. */
function autoplay(/** @type {import('../src/game/combat/combat.js').Combat} */ c) {
  for (let guard = 0; guard < 300 && !c.over; guard++) {
    const uid = c.state.piles.hand.find((u) => c.canPlay(u).ok);
    if (uid) c.playCard(uid, c.needsTarget(uid) ? c.aliveEnemies()[0].uid : null);
    else c.endTurn();
  }
}

test('a new run: starter deck is Rusted, Cargo has the chassis kit, first node is a combat', () => {
  const run = newRun();
  const s = run.state;
  assert.deepEqual(newRun().state, s, 'deterministic by seed');
  assert.equal(s.phase, 'map');
  assert.deepEqual(run.availableNodes(), s.map.start);
  assert.throws(() => run.travel('nowhere'), /not connected/);
  run.travel(s.map.start[0]);
  assert.equal(s.deck.length, 10);
  assert.ok(s.deck.every((c) => c.frame.rusted && c.core.rusted));
  assert.equal(s.cargo.items.length, 1);
  assert.equal(registry.kindOf(s.cargo.items[0].defId), 'mod');
  assert.equal(registry.get(s.cargo.items[0].defId).tier, 'salvage');
  assert.equal(s.phase, 'combat');
  assert.equal(registry.get(/** @type {string} */ (s.encounterId)).kind, 'easy');
});

test('combat carries HP over, rolls loot with Aether, then moves on', () => {
  const run = newRun();
  const combat = startFirst(run);
  assert.equal(run.state.combat, combat.state, 'the run holds the live combat state');
  autoplay(combat);
  assert.equal(combat.state.phase, 'won');
  const { won, loot } = run.finishCombat();
  assert.ok(won && loot);
  assert.equal(run.state.hp, combat.state.player.hp);
  assert.equal(run.state.phase, 'loot');
  assert.equal(loot.items.length, 2);
  assert.ok(run.state.aether >= 12 && run.state.aether <= 20);
  assert.equal(run.state.combat, null);
});

test('losing a combat ends the run', () => {
  const run = newRun();
  const combat = startFirst(run);
  combat.state.player.hp = 1;
  combat.state.player.block = 0;
  while (!combat.over) combat.endTurn();
  assert.deepEqual(run.finishCombat(), { won: false, loot: null });
  assert.equal(run.state.phase, 'lost');
  assert.ok(run.over);
});

test('loot: take into Cargo, crush for Aether, refuse when the hold is full', () => {
  const run = newRun();
  autoplay(startFirst(run));
  run.finishCombat();
  const [a, b] = /** @type {NonNullable<typeof run.state.loot>} */ (run.state.loot).items;
  run.takeLoot(/** @type {string} */ (a.uid));
  assert.ok(run.state.cargo.items.some((p) => p.uid === a.uid));
  const before = run.state.aether;
  const value = run.crush(/** @type {string} */ (b.uid));
  assert.equal(value, CRUSH_VALUE[/** @type {'salvage'} */ (registry.get(b.defId).tier)]);
  assert.equal(run.state.aether, before + value);

  run.state.cargo.items = Array.from({ length: 10 }, (_, i) => ({
    uid: `f${i}`,
    defId: 'mod_whetted',
  }));
  /** @type {any} */ (run.state.loot).items.push({ uid: 'extra', defId: 'core_ember' });
  assert.throws(() => run.takeLoot('extra'), /Cargo Hold is full/);
  run.leaveLoot();
  assert.equal(run.state.loot, null);
  assert.equal(run.state.phase, 'map');
  assert.ok(run.availableNodes().length > 0);
});

test('loot tables: never starter parts; elites guarantee a Refined+ Mod; bias favors elements', () => {
  const rng = Rng.fromSeed('loot');
  let thermalCores = 0;
  let cores = 0;
  for (let i = 0; i < 400; i++) {
    const roll = rollLoot(registry, rng, {
      encounterKind: 'easy',
      enemyDefIds: ['en_boiler_mite'],
    });
    assert.equal(roll.defIds.length, 2);
    for (const id of roll.defIds) {
      assert.notEqual(registry.get(id).tier, 'starter');
      if (registry.kindOf(id) === 'core') {
        cores++;
        if (registry.get(id).element === 'thermal') thermalCores++;
      }
    }
    const elite = rollLoot(registry, rng, {
      encounterKind: 'elite',
      enemyDefIds: ['el_foreman_gantry'],
    });
    assert.equal(registry.kindOf(elite.defIds[0]), 'mod');
    assert.notEqual(registry.get(elite.defIds[0]).tier, 'salvage');
    assert.ok(elite.aether >= 30 && elite.aether <= 40);
  }
  // 3 of 8 droppable Cores are Thermal; a ×3 bias should make them well over half.
  assert.ok(thermalCores / cores > 0.5, `${thermalCores}/${cores} thermal`);
  const bonus = rollLoot(registry, Rng.fromSeed('b'), {
    encounterKind: 'easy',
    enemyDefIds: [],
    bonusRolls: 2,
  });
  assert.equal(bonus.defIds.length, 4);
});

test("Scavenger's Hook: a killing blow earns a bonus loot roll", () => {
  const run = newRun();
  run.state.deck = run.state.deck.map((c) => ({ ...c, mod: { defId: 'mod_scavenger' } }));
  const combat = startFirst(run);
  autoplay(combat);
  assert.ok(combat.state.bonusLoot >= 1, `bonusLoot ${combat.state.bonusLoot}`);
  const { loot } = run.finishCombat();
  assert.equal(loot?.items.length, 2 + combat.state.bonusLoot);
});

test('Workbench: Tool Charges, plus Field Kit on the first visit', () => {
  const run = newRun();
  run.enterNode({ type: 'workbench' });
  assert.equal(run.state.workbench?.charges, TOOL_CHARGES + 1, 'Tinker Field Kit');
  run.leaveWorkbench();
  run.enterNode({ type: 'workbench' });
  assert.equal(run.state.workbench?.charges, TOOL_CHARGES);
});

test('Assemble: consumes parts and a charge, adds the card', () => {
  const run = atWorkbench(['frame_heavy_strike', 'core_furnace', 'mod_spring_loaded']);
  const { card, derived } = run.assemble({ frame: 't1', core: 't2', mod: 't3' });
  assert.equal(derived.valuePerHit, 12);
  assert.equal(run.state.deck.at(-1), card);
  assert.equal(run.state.cargo.items.length, 0);
  assert.equal(run.chargesLeft, 2);
  assert.equal(card.frame.uid, undefined, 'socketed parts drop their Cargo uid');
});

test('Assemble validation: socket kinds and the +2 Overclock limit', () => {
  const run = atWorkbench([
    'frame_jab',
    'core_piston',
    'mod_twin_linked',
    'core_furnace',
    'frame_strike',
  ]);
  assert.throws(() => run.assemble({ frame: 't2', core: 't1' }), /does not fit the frame socket/);
  // Jab cap 1, Piston 3 + Twin-Linked 2 = 5: +4 over.
  assert.throws(
    () => run.assemble({ frame: 't1', core: 't2', mod: 't3' }),
    /Overclock limit is \+2/,
  );
  assert.equal(run.chargesLeft, 3, 'failed welds cost nothing');
  // Strike cap 2, Furnace 2 + Twin-Linked 2 = 4: +2 is allowed, and Exhausts.
  const { derived } = run.assemble({ frame: 't5', core: 't4', mod: 't3' });
  assert.equal(derived.overclock, 2);
  assert.ok(derived.keywords.includes('exhaust'));
});

test('Modify (Swap): replaced parts return to Cargo; Rusted parts are crushed for 5', () => {
  const run = atWorkbench(['core_furnace', 'mod_whetted']);
  const strike = /** @type {string} */ (
    run.state.deck.find((c) => c.frame.defId === 'frame_strike')?.uid
  );
  const aether = run.state.aether;
  const { stowed } = run.modify(strike, { core: 't1' });
  assert.deepEqual(stowed, [{ defId: 'core_scrap', toCargo: false, aether: RUSTED_CRUSH_VALUE }]);
  assert.equal(run.state.aether, aether + RUSTED_CRUSH_VALUE);
  assert.equal(run.card(strike).core.defId, 'core_furnace');

  // Adding a Mod to an empty socket, then taking it back off.
  run.modify(strike, { mod: 't2' });
  assert.equal(run.card(strike).mod?.defId, 'mod_whetted');
  run.modify(strike, { mod: null });
  assert.equal(run.card(strike).mod, undefined);
  assert.ok(run.state.cargo.items.some((p) => p.defId === 'mod_whetted'));
  assert.equal(run.chargesLeft, 0);
  assert.throws(
    () => run.modify(strike, { mod: run.state.cargo.items[0].uid }),
    /Needs 1 Tool Charge/,
  );
});

test('Modify: changing two slots in one weld costs 2 and is validated as a whole', () => {
  const run = atWorkbench(['core_piston', 'mod_hair_trigger']);
  const heavy = /** @type {string} */ (
    run.state.deck.find((c) => c.frame.defId === 'frame_heavy_strike')?.uid
  );
  // Heavy Strike cap 3; Piston 3 + Hair Trigger 2 = 5 (+2): allowed as one change.
  const { derived } = run.modify(heavy, { core: 't1', mod: 't2' });
  assert.equal(derived.overclock, 2);
  assert.equal(run.chargesLeft, 1);
});

test('a part removed into a full Cargo Hold is crushed instead', () => {
  const run = atWorkbench(['mod_whetted']);
  const strike = /** @type {string} */ (
    run.state.deck.find((c) => c.frame.defId === 'frame_strike')?.uid
  );
  run.modify(strike, { mod: 't1' });
  run.state.cargo.items = Array.from({ length: 10 }, (_, i) => ({
    uid: `f${i}`,
    defId: 'core_ember',
  }));
  const { stowed } = run.modify(strike, { mod: null });
  assert.deepEqual(stowed, [{ defId: 'mod_whetted', toCargo: false, aether: CRUSH_VALUE.salvage }]);
});

test('Dismantle: parts to Cargo, deck floor of 8', () => {
  const run = atWorkbench(['frame_strike', 'core_ember']);
  const built = run.assemble({ frame: 't1', core: 't2' }).card;
  run.dismantle(built.uid);
  assert.deepEqual(run.state.cargo.items.map((p) => p.defId).sort(), [
    'core_ember',
    'frame_strike',
  ]);
  // Next visit: two Rusted starter cards crushed down to the floor.
  run.state.workbench = { charges: 3, used: 0, repaired: false };
  run.dismantle(run.state.deck[0].uid);
  run.dismantle(run.state.deck[0].uid);
  assert.equal(run.state.deck.length, 8);
  assert.throws(() => run.dismantle(run.state.deck[0].uid), /below 8/);
});

test('Tune: Cores and Mods only, once each, weight above 0', () => {
  const run = atWorkbench(['core_furnace', 'frame_strike', 'core_scrap']);
  run.tune({ cargoUid: 't1' });
  assert.equal(run.cargoItem('t1').tuned, true);
  assert.throws(() => run.tune({ cargoUid: 't1' }), /already tuned/);
  assert.throws(() => run.tune({ cargoUid: 't2' }), /Only Cores and Mods/);
  assert.throws(() => run.tune({ cargoUid: 't3' }), /weighs nothing/);
  // A tuned Furnace Core (weight 1) now fits a Jab with a Mod-free Strike socket.
  run.state.cargo.items.push({ uid: 'jab', defId: 'frame_jab' });
  assert.equal(run.assemble({ frame: 'jab', core: 't1' }).derived.overclock, 0);
});

test('Field Repair heals 30% and uses the whole visit; only as the first action', () => {
  const run = atWorkbench(['core_ember']);
  assert.throws(() => run.fieldRepair(), /full HP/);
  run.state.hp = 20;
  const { healed } = run.fieldRepair();
  assert.equal(healed, 19); // floor(65 * 0.3)
  assert.equal(run.chargesLeft, 0);
  const other = atWorkbench(['core_ember']);
  other.state.hp = 20;
  other.tune({ cargoUid: 't1' });
  assert.throws(() => other.fieldRepair(), /only thing/);
});

test('operations are refused outside their phase', () => {
  const run = newRun();
  assert.throws(() => run.assemble({ frame: 'x', core: 'y' }), RunError);
  assert.throws(() => run.leaveLoot(), /Not available during map/);
  startFirst(run);
  assert.throws(() => run.crush('x'), /outside combat/);
  assert.throws(() => run.travel(run.state.map.start[0]), /Not available during combat/);
});

test('a full Stratum can be played to the boss, and survives JSON round-trips', () => {
  let run = newRun({ deck: 'sandbox' });
  for (let guard = 0; guard < 200 && !run.over; guard++) {
    // Save/resume at every step.
    run = new Run(JSON.parse(JSON.stringify(run.state)), { registry });
    const phase = run.state.phase;
    if (phase === 'map') run.travel(run.availableNodes()[0]);
    else if (phase === 'combat') {
      // The scripted player is invulnerable: this test covers flow, not balance.
      const combat = run.startCombat();
      combat.state.player.hp = combat.state.player.maxHp = 9999;
      autoplay(combat);
      run.finishCombat();
      run.state.hp = run.state.maxHp;
    } else if (phase === 'loot') {
      const loot = /** @type {NonNullable<typeof run.state.loot>} */ (run.state.loot);
      if (loot.blueprints?.length) run.takeBlueprint(loot.blueprints[0]);
      if (loot.pick?.length && run.cargoFree > 0)
        run.choosePick(/** @type {string} */ (loot.pick[0].uid));
      for (const item of [...loot.items]) {
        if (run.cargoFree > 0) run.takeLoot(/** @type {string} */ (item.uid));
      }
      run.leaveLoot();
    } else if (phase === 'workbench') run.leaveWorkbench();
    else if (phase === 'smelter') run.leaveSmelter();
    else if (phase === 'event') {
      const ev = registry.get(/** @type {any} */ (run.state.event).id);
      const choice = ev.choices.find((/** @type {any} */ c) => !run.eventChoiceBlocked(c.id));
      run.chooseEvent(choice.id, { cargoUid: run.state.cargo.items[0]?.uid });
      if (run.state.phase === 'event') run.leaveEvent();
    }
  }
  assert.equal(run.state.phase, 'won');
  assert.equal(run.node?.type, 'boss');
  assert.equal(run.state.visited.length, run.state.map.rows);
});

test('the first turnReady save already includes the new combat', () => {
  const run = newRun();
  run.travel(run.availableNodes()[0]);
  const bus = new EventBus();
  /** @type {any[]} */
  const snapshots = [];
  bus.on('turnReady', () => snapshots.push(JSON.parse(JSON.stringify(run.state))));
  run.startCombat(bus);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].combat?.turn, 1);
  assert.equal(snapshots[0].combat.piles.hand.length, 5);
});
