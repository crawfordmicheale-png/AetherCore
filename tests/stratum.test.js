// @ts-check
/** M3 combat content: elite and boss mechanics, Blueprint combat effects, new Mods. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Combat } from '../src/game/combat/combat.js';
import { EventBus } from '../src/game/core/events.js';
import { card, registry, setupCombat } from './helpers.js';

/**
 * @param {object} opts
 * @param {string} opts.encounter
 * @param {Array<[string, string, string?]>} [opts.hand]
 * @param {import('../src/game/combat/combat.js').CombatMods} [opts.mods]
 * @param {EventBus} [opts.bus]
 */
function fight({ encounter, hand = [], mods = {}, bus }) {
  const deck = [
    ...hand.map(([f, c, m], i) => card(f, c, m, `h${i + 1}`)),
    ...Array.from({ length: 10 }, (_, i) =>
      card('frame_brace', 'core_scrap', undefined, `d${i + 1}`),
    ),
  ];
  const combat = Combat.create({
    registry,
    bus: bus ?? null,
    encounterId: encounter,
    deck,
    player: { hp: 60, maxHp: 60 },
    seed: 'm3',
    mods,
  });
  combat.start();
  const { piles } = combat.state;
  piles.hand = hand.map((_, i) => `h${i + 1}`);
  piles.draw = deck.map((c) => c.uid).filter((u) => !piles.hand.includes(u));
  piles.discard = [];
  return combat;
}

const e1 = (/** @type {Combat} */ c) =>
  /** @type {import('../src/game/combat/combat.js').EnemyState} */ (c.enemy('e1'));

test('Foreman Gantry summons a Scrapper Drone once, below 50% HP', () => {
  const bus = new EventBus();
  /** @type {any[]} */
  const phases = [];
  bus.on('enemyPhase', (e) => phases.push(e));
  const c = fight({
    encounter: 'enc_foreman',
    hand: [
      ['frame_ram', 'core_piston'],
      ['frame_ram', 'core_piston'],
    ],
    bus,
  });
  c.state.energy = 6;
  e1(c).hp = 45;
  c.playCard('h1', 'e1'); // 12 + 8 + 3 = 23 → 22 HP, below 40
  assert.equal(c.state.enemies.length, 2);
  assert.equal(c.state.enemies[1].defId, 'en_scrapper_drone');
  assert.equal(phases.length, 1);
  c.playCard('h2', 'e1');
  assert.equal(c.state.enemies.length, 2, 'the trigger fires once');
});

test('Crucible Engine: phase 2 at 50% (Fortified, new pattern), Crucible Heat at 25%', () => {
  const c = fight({
    encounter: 'enc_crucible',
    hand: [
      ['frame_strike', 'core_scrap'],
      ['frame_strike', 'core_scrap'],
    ],
  });
  const boss = e1(c);
  boss.hp = 85; // 160 max: one Strike takes it below 50%
  c.playCard('h1', 'e1');
  assert.equal(boss.statuses.fortified, 4);
  assert.deepEqual(boss.pattern, ['emp', 'barrage', 'rust_pour']);
  assert.equal(c.intentOf('e1')?.moveId, 'emp');
  boss.hp = 45;
  boss.block = 0;
  c.playCard('h2', 'e1');
  assert.equal(boss.statuses.crucible, 2);
  // Crucible Heat: each Slag in hand at end of turn deals 2.
  c.addSlag('slag_sludge', 2, 'hand', 'test');
  c.state.player.block = 0;
  const hp = c.state.player.hp;
  c.endTurn();
  assert.ok(c.state.player.hp <= hp - 4, 'two Slag in hand burned for 2 each');
});

test('the boss uses its new pattern from the first move after a phase change', () => {
  const c = fight({ encounter: 'enc_crucible' });
  const boss = e1(c);
  c.dealDamage('player', 'e1', 90, { pierce: true }); // straight to phase 2
  c.endTurn();
  assert.equal(c.isSuppressed('mod'), true, 'phase 2 opens with the EMP');
  assert.equal(c.intentOf('e1')?.moveId, 'barrage');
  assert.ok(boss.alive);
});

test('Press Warden Seizure: one card in the next hand costs +1 and has -1 Capacity', () => {
  const bus = new EventBus();
  /** @type {string[]} */
  const seized = [];
  bus.on('cardSeized', (e) => seized.push(/** @type {string} */ (e.uid)));
  const c = fight({ encounter: 'enc_press_warden', bus });
  assert.equal(c.intentOf('e1')?.slot, 'frame');
  c.endTurn();
  assert.equal(seized.length, 1);
  const d = c.derive(seized[0]);
  assert.equal(d.seized, true);
  assert.equal(d.cost, 2);
  assert.equal(d.capacity, 1);
  c.endTurn();
  assert.ok(!c.isSuppressed('frame'), 'Seizure lasts one turn');
});

test('Slagmaw spews Molten Slag into your draw pile; Molten Slag cools (Exhausts) at end of turn', () => {
  const c = fight({ encounter: 'enc_slagmaw' });
  c.endTurn();
  const molten = Object.values(c.state.cards).filter((x) => x.kind === 'slag');
  assert.equal(molten.length, 2);
  // Force one into hand and end the turn: it Burns you, then Exhausts.
  const uid = molten[0].uid;
  for (const pile of /** @type {const} */ (['draw', 'hand', 'discard'])) {
    const i = c.state.piles[pile].indexOf(uid);
    if (i >= 0) c.state.piles[pile].splice(i, 1);
  }
  c.state.piles.hand.push(uid);
  c.state.player.block = 99;
  c.endTurn();
  assert.ok(c.state.piles.exhaust.includes(uid));
});

test('Blueprints: Ballast Tank, Spare Flywheel', () => {
  const c = fight({ encounter: 'enc_hound', mods: { startBlock: 6, firstTurnEnergy: 1 } });
  assert.equal(c.state.player.block, 6);
  const fresh = Combat.create({
    registry,
    encounterId: 'enc_hound',
    deck: [card('frame_brace', 'core_scrap', undefined, 'z')],
    player: { hp: 60, maxHp: 60 },
    seed: 'x',
    mods: { firstTurnEnergy: 1 },
  });
  fresh.start();
  assert.equal(fresh.state.energy, 4);
  fresh.endTurn();
  assert.equal(fresh.state.energy, 3, 'only on turn 1');
});

test('Blueprints: Heat Sink saves the first Overclocked card each combat', () => {
  const c = fight({
    encounter: 'enc_hound',
    hand: [
      ['frame_strike', 'core_furnace', 'mod_whetted'],
      ['frame_strike', 'core_furnace', 'mod_whetted'],
    ],
    mods: { heatSink: true },
  });
  e1(c).hp = e1(c).maxHp = 200;
  c.playCard('h1', 'e1');
  assert.ok(c.state.piles.discard.includes('h1'));
  c.playCard('h2', 'e1');
  assert.ok(c.state.piles.exhaust.includes('h2'));
});

test('Blueprints: Faraday Lining ignores the first Suppression; Slag Filter eats the first Slag', () => {
  const c = fight({ encounter: 'enc_foreman', mods: { faraday: true, slagFilter: true } });
  c.suppress('mod', 1, 'e1');
  assert.ok(!c.isSuppressed('mod'));
  c.suppress('mod', 1, 'e1');
  assert.ok(c.isSuppressed('mod'));
  c.addSlag('slag_molten', 2, 'hand', 'e1');
  assert.equal(c.state.piles.exhaust.length, 1);
  assert.equal(c.state.piles.hand.length, 1);
});

test('Feedback Loop refunds Energy when the card Exhausts; Overdrive doubles Power', () => {
  const c = setupCombat({
    hand: [['frame_strike', 'core_furnace', 'mod_feedback']],
    enemyHp: [80, 80],
  });
  // Furnace 2 + Feedback 1 = 3 on capacity 2: Overclocked, so it Exhausts.
  c.playCard('h1', 'e1');
  assert.equal(c.state.energy, 3, 'paid 1, refunded 1');
  const od = setupCombat({
    hand: [['frame_heavy_strike', 'core_kinetic_slug', 'mod_overdrive']],
    enemyHp: [80, 80],
  });
  const d = od.derive('h1');
  assert.equal(d.valuePerHit, 6 + 8);
  assert.ok(d.keywords.includes('exhaust'));
});
