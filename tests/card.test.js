// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCard, riderFor } from '../src/game/model/card.js';
import { cardRulesText } from '../src/game/model/cardText.js';
import { card, registry } from './helpers.js';

/** @param {Partial<import('../src/game/model/card.js').DerivationContext>} [ctx] */
const derive = (/** @type {any} */ c, ctx = {}) => deriveCard(c, { registry, ...ctx });
const sum = (/** @type {import('../src/game/model/card.js').DerivedCard} */ d) =>
  d.breakdown.reduce((t, l) => t + (l.stat === 'value' ? (l.value ?? 0) : 0), 0);

test('starter cards (Tinker deck golden values)', () => {
  const strike = derive(card('frame_strike', 'core_scrap'));
  assert.equal(strike.cost, 1);
  assert.equal(strike.valuePerHit, 6);
  assert.equal(strike.rider, null, 'Scrap Core is riderless');
  assert.equal(strike.name, 'Scrap Strike');

  const brace = derive(card('frame_brace', 'core_scrap'));
  assert.equal(brace.verb, 'defend');
  assert.equal(brace.valuePerHit, 5);

  const heavy = derive(card('frame_heavy_strike', 'core_kinetic_slug'));
  assert.equal(heavy.cost, 2);
  assert.equal(heavy.valuePerHit, 10);
  assert.deepEqual(heavy.rider, { kind: 'crush', stacks: 0 });

  const arc = derive(card('frame_strike', 'core_arc_cell'));
  assert.equal(arc.valuePerHit, 7);
  assert.deepEqual(arc.rider, { kind: 'shock', stacks: 1 });
});

test('GDD §2.2 worked example: Heavy Strike + Furnace Core + Spring-Loaded', () => {
  const d = derive(card('frame_heavy_strike', 'core_furnace', 'mod_spring_loaded'));
  assert.equal(d.weight, 3);
  assert.equal(d.capacity, 3);
  assert.equal(d.overclock, 0);
  assert.equal(d.cost, 2);
  assert.equal(d.valuePerHit, 12);
  assert.deepEqual(d.rider, { kind: 'burn', stacks: 2 });
  assert.deepEqual(d.onPlay, [{ op: 'draw', n: 1 }]);
  assert.ok(!d.keywords.includes('exhaust'));
  assert.equal(d.name, 'Searing Heavy Strike');
  assert.deepEqual(cardRulesText(d), [
    'Deal 12 damage.',
    'Apply 2 Burn.',
    'Draw 1 card when played.',
  ]);
});

test('breakdown lines sum to the value per hit', () => {
  for (const c of [
    card('frame_heavy_strike', 'core_furnace', 'mod_whetted'),
    card('frame_twin_piston', 'core_piston', 'mod_whetted'),
    card('frame_ram', 'core_piston'),
    card('frame_bulwark', 'core_dynamo'),
  ]) {
    const d = derive(c);
    assert.equal(sum(d), d.valuePerHit, c.frame.defId);
  }
});

test('Overclocking: weight over capacity adds Exhaust', () => {
  const d = derive(card('frame_strike', 'core_furnace', 'mod_hair_trigger')); // 2 + 2 > 2
  assert.equal(d.overclock, 2);
  assert.ok(d.keywords.includes('exhaust'));
  assert.equal(d.cost, 0);
  assert.ok(cardRulesText(d).includes('Exhaust (Overclocked).'));
});

test('EMP: a suppressed Mod contributes no stats, hooks, or weight', () => {
  const c = card('frame_strike', 'core_furnace', 'mod_whetted'); // weight 3 > cap 2
  const normal = derive(c);
  assert.equal(normal.overclock, 1);
  assert.equal(normal.valuePerHit, 12);

  const emp = derive(c, { suppression: { mod: true } });
  assert.equal(emp.overclock, 0, 'suppressing the Mod brings the card back within capacity');
  assert.ok(!emp.keywords.includes('exhaust'));
  assert.equal(emp.valuePerHit, 10);
  assert.equal(emp.suppressed.mod, true);
  assert.notEqual(emp.hash, normal.hash);
  assert.ok(cardRulesText(emp).includes('[Mod suppressed]'));
});

test('Fail-Safe ignores suppression and gains value while another component is suppressed', () => {
  const c = card('frame_strike', 'core_ember', 'mod_fail_safe');
  assert.equal(derive(c).valuePerHit, 6);
  const emp = derive(c, { suppression: { mod: true } });
  assert.equal(emp.suppressed.mod, false);
  assert.equal(emp.valuePerHit, 6, 'only the mod slot was suppressed, and Fail-Safe ignores it');
  const damp = derive(c, { suppression: { coreRider: true } });
  assert.equal(damp.rider, null);
  assert.equal(damp.valuePerHit, 10);
});

test('Dampening Field removes the element rider but keeps Power', () => {
  const d = derive(card('frame_strike', 'core_furnace'), { suppression: { coreRider: true } });
  assert.equal(d.valuePerHit, 10);
  assert.equal(d.rider, null);
});

test('multi-hit frames scale Core Power by 0.5 (floored); Twin-Linked adds a hit', () => {
  const d = derive(card('frame_twin_piston', 'core_furnace', 'mod_twin_linked'));
  assert.equal(d.valuePerHit, 2 + 3);
  assert.equal(d.hits, 3);
  assert.equal(derive(card('frame_twin_piston', 'core_arc_cell')).valuePerHit, 2 + 1);
});

test('frame modifiers: Battering Ram gives Kinetic Cores +3 Power', () => {
  assert.equal(derive(card('frame_ram', 'core_kinetic_slug')).valuePerHit, 12 + 4 + 3);
  assert.equal(derive(card('frame_ram', 'core_furnace')).valuePerHit, 12 + 6);
});

test('Flywheel Core gains Power per play this combat', () => {
  const c = card('frame_strike', 'core_flywheel');
  assert.equal(derive(c).valuePerHit, 9);
  assert.equal(derive(c, { timesPlayed: 3 }).valuePerHit, 12);
});

test('Resonator counts other cards in hand sharing the element', () => {
  const c = card('frame_strike', 'core_ember', 'mod_resonator');
  assert.equal(
    derive(c, { otherHandElements: ['thermal', 'kinetic', 'thermal'] }).valuePerHit,
    6 + 4,
  );
});

test('target-dependent Mods only apply once a target is known', () => {
  const kindling = card('frame_strike', 'core_scrap', 'mod_kindling');
  assert.equal(derive(kindling).valuePerHit, 6);
  assert.equal(derive(kindling).hasTargetConditions, true);
  const burning = { hp: 10, maxHp: 10, statuses: { burn: 2 } };
  assert.equal(derive(kindling, { target: burning }).valuePerHit, 9);

  const exec = card('frame_strike', 'core_scrap', 'mod_executioner');
  assert.equal(derive(exec, { target: { hp: 10, maxHp: 10, statuses: {} } }).damageMult, 1);
  assert.equal(derive(exec, { target: { hp: 2, maxHp: 10, statuses: {} } }).damageMult, 1.5);
});

test('Hair Trigger reduces cost (min 0); Jammed previews +1', () => {
  assert.equal(derive(card('frame_jab', 'core_scrap', 'mod_hair_trigger')).cost, 0);
  assert.equal(
    derive(card('frame_strike', 'core_scrap'), { player: { statuses: { jammed: 1 } } }).cost,
    2,
  );
});

test('Rust Slag lowers Capacity and can push a card into Overclock', () => {
  const d = derive(card('frame_strike', 'core_furnace'), { rustCount: 1 });
  assert.equal(d.capacity, 1);
  assert.equal(d.overclock, 1);
  assert.ok(d.keywords.includes('exhaust'));
});

test('Tune and Capacity upgrades', () => {
  const c = card('frame_strike', 'core_furnace', 'mod_whetted');
  c.core.tuned = true;
  assert.equal(derive(c).weight, 2);
  c.frame.capacityBonus = 1;
  assert.equal(derive(c).capacity, 3);
});

test('Defend riders and Utility frames', () => {
  assert.deepEqual(derive(card('frame_brace', 'core_ember')).rider, { kind: 'searing', stacks: 1 });
  assert.deepEqual(derive(card('frame_brace', 'core_arc_cell')).rider, {
    kind: 'charge',
    stacks: 1,
  });
  assert.deepEqual(derive(card('frame_brace', 'core_kinetic_slug')).rider, {
    kind: 'reinforce',
    stacks: 2,
  });
  const conduit = derive(card('frame_conduit', 'core_furnace'));
  assert.deepEqual(conduit.rider, { kind: 'burn', stacks: 4 }, 'Conduit doubles the Attack rider');
  assert.equal(conduit.valuePerHit, 0);
  assert.equal(derive(card('frame_conduit', 'core_kinetic_slug')).rider, null);
  const relay = derive(card('frame_relay', 'core_arc_cell'));
  assert.deepEqual(relay.rider, { kind: 'charge', stacks: 1 });
  assert.equal(relay.draw, 1);
});

test('Gyro-Stabilizer grants Retain; keywords are sorted and unique', () => {
  const d = derive(card('frame_aegis', 'core_scrap', 'mod_gyro'));
  assert.deepEqual(d.keywords, ['retain']);
});

test('hash is stable for identical inputs', () => {
  const c = card('frame_heavy_strike', 'core_furnace', 'mod_spring_loaded');
  assert.equal(derive(c).hash, derive(structuredClone(c)).hash);
  assert.match(derive(c).hash, /^[0-9a-f]{8}$/);
});

test('riderFor covers every element and verb', () => {
  for (const el of ['kinetic', 'thermal', 'voltaic', 'aether', 'cryo']) {
    assert.ok(riderFor(el, 'attack', 1));
    assert.ok(riderFor(el, 'defend', 1));
  }
  assert.equal(riderFor('thermal', 'attack', null), null);
});

test('every Tinker/Machinist/Spark-Weaver starter card derives within capacity', () => {
  for (const chassis of registry.all('chassis')) {
    for (const entry of chassis.deck) {
      const d = derive(card(entry.frame, entry.core, entry.mod));
      assert.equal(d.overclock, 0, `${chassis.id}: ${d.name}`);
      assert.ok(cardRulesText(d).length > 0);
    }
  }
});

test('sandbox deck builds from valid content and keeps the 10-card size', async () => {
  const { buildSandboxDeck } = await import('../src/game/model/deck.js');
  const deck = buildSandboxDeck(registry);
  assert.equal(new Set(deck.map((c) => c.uid)).size, deck.length);
  assert.ok(deck.length >= 10);
  const overclocked = deck.map((c) => derive(c)).filter((d) => d.overclock > 0);
  assert.equal(overclocked.length, 1, 'exactly one card demonstrates Overclocking');
});
