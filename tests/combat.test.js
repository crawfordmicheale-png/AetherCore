// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Combat, CombatError } from '../src/game/combat/combat.js';
import { EventBus } from '../src/game/core/events.js';
import { buildStarterDeck } from '../src/game/model/deck.js';
import { registry, setupCombat } from './helpers.js';

const e1 = (/** @type {Combat} */ c) =>
  /** @type {import('../src/game/combat/combat.js').EnemyState} */ (c.enemy('e1'));

test('start: turn 1, full energy, 5 cards drawn, deterministic by seed', () => {
  const make = () => {
    const c = Combat.create({
      registry,
      encounterId: 'enc_drones',
      deck: buildStarterDeck(registry, 'chassis_tinker'),
      player: { hp: 65, maxHp: 65 },
      seed: 'abc',
    });
    c.start();
    return c;
  };
  const a = make();
  assert.equal(a.state.turn, 1);
  assert.equal(a.state.energy, 3);
  assert.equal(a.state.piles.hand.length, 5);
  assert.equal(a.state.piles.draw.length, 5);
  assert.deepEqual(make().state, a.state);
  assert.throws(() => a.start(), CombatError);
});

test('playing an attack spends energy, deals damage, and discards the card', () => {
  const c = setupCombat({ hand: [['frame_strike', 'core_scrap']], enemyHp: [20, 20] });
  c.playCard('h1', 'e1');
  assert.equal(c.state.energy, 2);
  assert.equal(e1(c).hp, 14);
  assert.deepEqual(c.state.piles.discard, ['h1']);
});

test('canPlay explains why a card cannot be played', () => {
  const c = setupCombat({ hand: [['frame_heavy_strike', 'core_scrap']], energy: 1 });
  assert.deepEqual(c.canPlay('h1', 'e1'), { ok: false, reason: 'Not enough Energy' });
  assert.deepEqual(c.canPlay('d1'), { ok: false, reason: 'Card is not in hand' });
  assert.throws(() => c.playCard('h1', 'e1'), /Not enough Energy/);
  c.state.energy = 3;
  assert.throws(() => c.playCard('h1'), /needs a target/);
  e1(c).alive = false;
  assert.deepEqual(c.canPlay('h1', 'e1'), { ok: false, reason: 'Invalid target' });
});

test('Block absorbs enemy attacks and is removed at the start of the next turn', () => {
  const c = setupCombat({ hand: [['frame_brace', 'core_scrap']], encounter: 'enc_hound' });
  c.playCard('h1');
  assert.equal(c.state.player.block, 5);
  c.endTurn(); // Hound: Rivet Bite 4×2
  assert.equal(c.state.player.hp, 50 - 3);
  assert.equal(c.state.player.block, 0);
});

test('Strength adds to each hit, and intents show the final number', () => {
  const c = setupCombat({ hand: [], encounter: 'enc_hound' });
  e1(c).patternIndex = 1; // Howl: +1 Strength
  assert.equal(c.intentOf('e1')?.intent, 'buff');
  c.endTurn();
  assert.equal(e1(c).statuses.strength, 1);
  assert.deepEqual([c.intentOf('e1')?.damage, c.intentOf('e1')?.hits], [5, 2]);
});

test('Burn ticks at the end of the owner turn, ignores Block, and decays', () => {
  const c = setupCombat({
    hand: [['frame_strike', 'core_furnace']],
    encounter: 'enc_hound',
    enemyHp: [40],
  });
  c.playCard('h1', 'e1');
  assert.equal(e1(c).hp, 30);
  assert.equal(e1(c).statuses.burn, 2);
  e1(c).block = 0;
  c.endTurn();
  assert.equal(e1(c).hp, 28);
  assert.equal(e1(c).statuses.burn, 1);
});

test('Shock adds +3 per stack to the next hit and is consumed', () => {
  const c = setupCombat({
    hand: [
      ['frame_strike', 'core_arc_cell'],
      ['frame_strike', 'core_scrap'],
      ['frame_jab', 'core_scrap'],
    ],
    enemyHp: [40, 40],
  });
  c.playCard('h1', 'e1');
  assert.equal(e1(c).statuses.shock, 1);
  c.playCard('h2', 'e1');
  assert.equal(e1(c).hp, 40 - 7 - 9);
  assert.equal(e1(c).statuses.shock, undefined);
  c.playCard('h3', 'e1');
  assert.equal(e1(c).hp, 40 - 7 - 9 - 2);
});

test('Crush deals double damage to Block; Pierce ignores it', () => {
  const c = setupCombat({
    hand: [
      ['frame_heavy_strike', 'core_kinetic_slug'],
      ['frame_strike', 'core_aether_shard'],
    ],
    enemyHp: [40, 40],
    energy: 5,
  });
  e1(c).block = 10;
  c.playCard('h1', 'e1'); // 10 damage: 5 of it strips all 10 Block, 5 goes through
  assert.equal(e1(c).block, 0);
  assert.equal(e1(c).hp, 35);
  e1(c).block = 10;
  c.playCard('h2', 'e1'); // 4 + 2 = 6, pierce
  assert.equal(e1(c).block, 10);
  assert.equal(e1(c).hp, 29);
});

test('Searing: the next enemy to attack you gains Burn', () => {
  const c = setupCombat({ hand: [['frame_brace', 'core_ember']], encounter: 'enc_hound' });
  c.playCard('h1');
  assert.equal(c.state.player.statuses.searing, 1);
  c.endTurn();
  // The Burn was applied mid-attack, then ticked at the end of the Hound's turn.
  assert.equal(e1(c).statuses.burn, undefined);
  assert.equal(e1(c).hp, e1(c).maxHp - 1);
  assert.equal(c.state.player.statuses.searing, undefined);
});

test('Charge converts into Energy at 3', () => {
  const c = setupCombat({
    hand: [
      ['frame_plating', 'core_arc_cell'],
      ['frame_plating', 'core_arc_cell'],
      ['frame_plating', 'core_arc_cell'],
    ],
  });
  c.playCard('h1');
  c.playCard('h2');
  assert.equal(c.state.player.statuses.charge, 2);
  assert.equal(c.state.energy, 3);
  c.playCard('h3');
  assert.equal(c.state.player.statuses.charge, undefined);
  assert.equal(c.state.energy, 4);
});

test('Reinforce adds Block only if you already have Block', () => {
  const c = setupCombat({
    hand: [
      ['frame_brace', 'core_kinetic_slug'],
      ['frame_brace', 'core_kinetic_slug'],
    ],
  });
  c.playCard('h1');
  assert.equal(c.state.player.block, 7);
  c.playCard('h2');
  assert.equal(c.state.player.block, 7 + 9);
});

test('Ward prevents the next debuff', () => {
  const c = setupCombat({
    hand: [
      ['frame_brace', 'core_aether_shard'],
      ['frame_jab', 'core_scrap'],
    ],
    encounter: 'enc_mites',
  });
  c.playCard('h1');
  assert.equal(c.state.player.statuses.ward, 1);
  e1(c).hp = 1;
  c.playCard('h2', 'e1'); // Boiler Mite dies: Burn 2 on you, blocked by Ward
  assert.equal(c.state.player.statuses.burn, undefined);
  assert.equal(c.state.player.statuses.ward, undefined);
});

test('Boiler Mite death applies Burn to the player', () => {
  const c = setupCombat({ hand: [['frame_strike', 'core_scrap']], encounter: 'enc_mites' });
  e1(c).hp = 3;
  c.playCard('h1', 'e1');
  assert.equal(e1(c).alive, false);
  assert.equal(c.state.player.statuses.burn, 2);
});

test('Overclocked cards Exhaust; an EMP that removes the excess weight saves them', () => {
  const bus = new EventBus();
  /** @type {any[]} */
  const exhausted = [];
  bus.on('cardExhausted', (e) => exhausted.push(e));
  const c = setupCombat({
    hand: [
      ['frame_strike', 'core_furnace', 'mod_whetted'],
      ['frame_strike', 'core_furnace', 'mod_whetted'],
    ],
    enemyHp: [80, 80],
    energy: 3,
    bus,
  });
  c.playCard('h1', 'e1');
  assert.deepEqual(c.state.piles.exhaust, ['h1']);
  assert.equal(exhausted[0].overclock, 1);

  c.suppress('mod', 1, 'e2');
  assert.equal(c.derive('h2').overclock, 0);
  c.playCard('h2', 'e1');
  assert.deepEqual(c.state.piles.discard, ['h2']);
});

test('Foreman Gantry EMP suppresses Mods for the next player turn only', () => {
  const bus = new EventBus();
  /** @type {string[]} */
  const events = [];
  bus.on('componentSuppressed', () => events.push('suppressed'));
  bus.on('suppressionExpired', () => events.push('expired'));
  const c = setupCombat({
    hand: [['frame_strike', 'core_scrap', 'mod_whetted']],
    encounter: 'enc_foreman',
    bus,
  });
  assert.equal(c.intentOf('e1')?.intent, 'suppress');
  assert.equal(c.intentOf('e1')?.slot, 'mod');
  c.endTurn();
  assert.equal(c.state.turn, 2);
  assert.ok(c.isSuppressed('mod'));
  for (const uid of c.state.piles.hand) {
    const card = c.state.cards[uid];
    if (card.kind === 'card' && card.mod) assert.equal(c.derive(uid).suppressed.mod, true);
  }
  c.endTurn();
  assert.ok(!c.isSuppressed('mod'));
  assert.deepEqual(events, ['suppressed', 'expired']);
});

test('Molten Slag: Kinetic plays hurt, end of turn Burns; Grounding Rod clears it', () => {
  const c = setupCombat({
    hand: [
      ['frame_strike', 'core_scrap'],
      ['frame_strike', 'core_ember', 'mod_grounding'],
    ],
    enemyHp: [80, 80],
  });
  c.addSlag('slag_molten', 1, 'hand', 'test');
  c.playCard('h1', 'e1');
  assert.equal(c.state.player.hp, 48);
  c.playCard('h2', 'e1'); // Thermal: no damage; Grounding Rod exhausts the Slag
  assert.equal(c.state.player.hp, 48);
  assert.equal(c.state.piles.exhaust.length, 1);
  assert.ok(c.state.piles.exhaust[0].startsWith('s'));
});

test('Molten Slag left in hand applies Burn at end of turn', () => {
  const c = setupCombat({ hand: [], encounter: 'enc_hound' });
  c.addSlag('slag_molten', 1, 'hand', 'test');
  c.state.player.block = 100;
  c.endTurn();
  // Burn 1 was applied then ticked immediately at the end of the player's turn.
  assert.equal(c.state.player.hp, 49);
});

test('Static Slag Jams you; Jammed raises the next cost by 1 and is consumed', () => {
  const c = setupCombat({
    hand: [
      ['frame_jab', 'core_arc_cell'],
      ['frame_strike', 'core_scrap'],
    ],
    enemyHp: [40, 40],
  });
  c.addSlag('slag_static', 1, 'hand', 'test');
  c.playCard('h1', 'e1');
  assert.equal(c.state.player.statuses.jammed, 1);
  assert.equal(c.costOf('h2'), 2);
  c.playCard('h2', 'e1');
  assert.equal(c.state.energy, 1);
  assert.equal(c.state.player.statuses.jammed, undefined);
});

test('Rust Slag lowers Capacity of cards in hand; Sludge is playable and Exhausts', () => {
  const c = setupCombat({ hand: [['frame_strike', 'core_furnace']] });
  assert.equal(c.derive('h1').overclock, 0);
  c.addSlag('slag_rust', 1, 'hand', 'test');
  assert.equal(c.derive('h1').overclock, 1);
  c.addSlag('slag_sludge', 1, 'hand', 'test');
  const sludge = /** @type {string} */ (
    c.state.piles.hand.find(
      (u) => c.state.cards[u].kind === 'slag' && c.state.cards[u].defId === 'slag_sludge',
    )
  );
  const rust = /** @type {string} */ (
    c.state.piles.hand.find(
      (u) => c.state.cards[u].kind === 'slag' && c.state.cards[u].defId === 'slag_rust',
    )
  );
  assert.deepEqual(c.canPlay(rust), { ok: false, reason: 'Unplayable' });
  c.playCard(sludge);
  assert.equal(c.state.energy, 2);
  assert.ok(c.state.piles.exhaust.includes(sludge));
});

test('Slag added to the draw pile lands at a seeded random position', () => {
  const c = setupCombat({ hand: [] });
  const before = c.state.piles.draw.length;
  c.addSlag('slag_molten', 2, 'draw', 'test');
  assert.equal(c.state.piles.draw.length, before + 2);
});

test('drawing reshuffles the discard pile; overdraw beyond 10 is discarded', () => {
  const c = setupCombat({ hand: [], drawFiller: 12 });
  c.state.piles.discard = c.state.piles.draw.splice(0, 10);
  c.draw(5);
  assert.equal(c.state.piles.hand.length, 5);
  c.draw(10);
  assert.equal(c.state.piles.hand.length, 10);
  assert.equal(c.state.piles.draw.length + c.state.piles.discard.length, 2);
});

test('Retain cards stay in hand at end of turn', () => {
  const c = setupCombat({
    hand: [
      ['frame_aegis', 'core_scrap'],
      ['frame_strike', 'core_scrap', 'mod_gyro'],
    ],
    encounter: 'enc_hound',
  });
  c.state.player.block = 100;
  c.endTurn();
  assert.ok(c.state.piles.hand.includes('h1'));
  assert.ok(c.state.piles.hand.includes('h2'));
});

test('Ricochet repeats at 50% on another enemy; Siphon heals from unblocked damage', () => {
  const c = setupCombat({
    hand: [
      ['frame_heavy_strike', 'core_piston', 'mod_ricochet'],
      ['frame_heavy_strike', 'core_scrap', 'mod_siphon'],
    ],
    enemyHp: [40, 40],
    energy: 4,
  });
  c.state.player.hp = 30;
  c.playCard('h1', 'e1'); // 14 to e1, 7 to e2 (Ricochet is Overclocked: weight 4 > 3)
  assert.equal(e1(c).hp, 26);
  assert.equal(c.enemy('e2')?.hp, 33);
  assert.ok(c.state.piles.exhaust.includes('h1'));
  c.playCard('h2', 'e1'); // 8 damage → heal 1
  assert.equal(c.state.player.hp, 31);
});

test('Conduit applies the doubled rider without damage; Relay draws', () => {
  const c = setupCombat({
    hand: [
      ['frame_conduit', 'core_furnace'],
      ['frame_relay', 'core_arc_cell'],
    ],
    enemyHp: [40, 40],
  });
  c.playCard('h1', 'e1');
  assert.equal(e1(c).hp, 40);
  assert.equal(e1(c).statuses.burn, 4);
  c.playCard('h2');
  assert.equal(c.state.player.statuses.charge, 1);
  assert.equal(c.state.piles.hand.length, 1);
});

test('Sweep hits all enemies; Kindling reads each target', () => {
  const c = setupCombat({
    hand: [['frame_sweep', 'core_scrap', 'mod_kindling']],
    enemyHp: [40, 40],
  });
  /** @type {any} */ (c.enemy('e2')).statuses.burn = 1;
  c.playCard('h1');
  assert.equal(e1(c).hp, 35);
  assert.equal(c.enemy('e2')?.hp, 32);
});

test('winning: killing every enemy ends the combat', () => {
  const bus = new EventBus();
  let won = 0;
  bus.on('combatWon', () => won++);
  const c = setupCombat({ hand: [['frame_sweep', 'core_piston']], enemyHp: [5, 5], bus });
  c.playCard('h1');
  assert.equal(c.state.phase, 'won');
  assert.equal(won, 1);
  assert.throws(() => c.endTurn(), CombatError);
});

test('losing: the player reaching 0 HP ends the combat', () => {
  const c = setupCombat({ hand: [], encounter: 'enc_hound' });
  c.state.player.hp = 3;
  c.endTurn();
  assert.equal(c.state.phase, 'lost');
  assert.equal(c.state.player.hp, 0);
});

test('preview reports the exact outcome without changing state', () => {
  const c = setupCombat({ hand: [['frame_heavy_strike', 'core_furnace']], enemyHp: [40, 40] });
  const before = structuredClone(c.state);
  const p = c.preview('h1', 'e1');
  assert.deepEqual(c.state, before);
  assert.equal(p?.enemies[0].hpAfter, 28);
  assert.equal(p?.energyAfter, 1);
  assert.equal(c.preview('h1'), null, 'single-target cards need a target to preview');
});

test('turnReady fires after the new hand is drawn (a safe autosave point)', () => {
  const bus = new EventBus();
  /** @type {number[]} */
  const handSizes = [];
  bus.on('turnReady', () => handSizes.push(combat.state.piles.hand.length));
  const combat = Combat.create({
    registry,
    bus,
    encounterId: 'enc_hound',
    deck: buildStarterDeck(registry, 'chassis_tinker'),
    player: { hp: 65, maxHp: 65 },
    seed: 'ready',
  });
  combat.start();
  combat.endTurn();
  assert.deepEqual(handSizes, [5, 5]);
});
