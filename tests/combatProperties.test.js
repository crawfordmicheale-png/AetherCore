// @ts-check
/**
 * Property tests: random legal play across many seeds and encounters.
 * Each property must hold for every game, not just hand-picked scenarios.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Combat } from '../src/game/combat/combat.js';
import { EventBus } from '../src/game/core/events.js';
import { Rng } from '../src/game/core/rng.js';
import { buildStarterDeck } from '../src/game/model/deck.js';
import { registry } from './helpers.js';

const ENCOUNTERS = registry.all('encounter').map((e) => e.id);
const GAMES = 60;

/** A deck that exercises Mods, Overclocking, Utility frames, and multi-hit. */
function variedDeck() {
  const deck = buildStarterDeck(registry, 'chassis_tinker');
  const extras = [
    ['frame_twin_piston', 'core_furnace', 'mod_whetted'],
    ['frame_sweep', 'core_arc_cell', 'mod_kindling'],
    ['frame_heavy_strike', 'core_piston', 'mod_ricochet'],
    ['frame_conduit', 'core_dynamo'],
    ['frame_relay', 'core_ember'],
    ['frame_bulwark', 'core_aether_shard', 'mod_gyro'],
    ['frame_strike', 'core_flywheel', 'mod_executioner'],
    ['frame_jab', 'core_ember', 'mod_resonator'],
  ];
  extras.forEach(([frame, core, mod], i) => {
    deck.push({
      uid: `x${i}`,
      frame: { defId: frame },
      core: { defId: core },
      ...(mod ? { mod: { defId: mod } } : {}),
    });
  });
  return deck;
}

/**
 * Picks a random legal action: a playable card (with a target if needed) or end turn.
 * @param {Combat} c
 * @param {Rng} rng
 * @returns {{ uid: string, target: string | null } | 'end'}
 */
function randomAction(c, rng) {
  const playable = c.state.piles.hand.filter((uid) => c.canPlay(uid).ok);
  if (playable.length === 0 || rng.chance(0.15)) return 'end';
  const uid = rng.pick(playable);
  const target = c.needsTarget(uid) ? rng.pick(c.aliveEnemies()).uid : null;
  return { uid, target };
}

/**
 * @param {number} game
 * @param {EventBus | null} [bus]
 */
function newGame(game, bus = null) {
  const combat = Combat.create({
    registry,
    bus,
    encounterId: ENCOUNTERS[game % ENCOUNTERS.length],
    deck: variedDeck(),
    player: { hp: 60, maxHp: 60 },
    seed: `prop-${game}`,
  });
  combat.start();
  return combat;
}

/**
 * Plays a game to the end (or a step cap), calling `check` before each action.
 * @param {Combat} c
 * @param {Rng} rng
 * @param {(c: Combat, action: ReturnType<typeof randomAction>) => void} [check]
 * @returns {Array<ReturnType<typeof randomAction>>}
 */
function playOut(c, rng, check) {
  /** @type {Array<ReturnType<typeof randomAction>>} */
  const actions = [];
  for (let step = 0; step < 400 && !c.over; step++) {
    const action = randomAction(c, rng);
    check?.(c, action);
    actions.push(action);
    if (action === 'end') c.endTurn();
    else c.playCard(action.uid, action.target);
  }
  return actions;
}

/** @param {Combat} c */
function assertInvariants(c) {
  const s = c.state;
  assert.ok(s.player.hp >= 0 && s.player.hp <= s.player.maxHp, 'player HP in range');
  assert.ok(s.energy >= 0, 'energy never negative');
  for (const e of s.enemies) {
    assert.ok(e.hp >= 0 && e.hp <= e.maxHp, `${e.uid} HP in range`);
    assert.ok(e.block >= 0);
    for (const v of Object.values(e.statuses)) assert.ok(v > 0, 'no zero/negative statuses kept');
  }
  // Every card is in exactly one pile.
  const all = [...s.piles.draw, ...s.piles.hand, ...s.piles.discard, ...s.piles.exhaust];
  assert.equal(new Set(all).size, all.length, 'no card in two piles');
  assert.deepEqual([...all].sort(), Object.keys(s.cards).sort(), 'no card lost');
  assert.ok(s.piles.hand.length <= s.maxHand);
}

test('preview always equals the actual outcome', () => {
  let previews = 0;
  for (let game = 0; game < GAMES; game++) {
    const c = newGame(game);
    const rng = Rng.fromSeed(`actions-${game}`);
    playOut(c, rng, (combat, action) => {
      if (action === 'end') return;
      const p = combat.preview(action.uid, action.target);
      assert.ok(p, 'legal plays always have a preview');
      const clone = new Combat(structuredClone(combat.state), { registry });
      clone.playCard(action.uid, action.target);
      if (p.random) return;
      previews++;
      assert.equal(p.player.hpAfter, clone.state.player.hp);
      assert.equal(p.player.blockAfter, clone.state.player.block);
      assert.equal(p.energyAfter, clone.state.energy);
      p.enemies.forEach((e, i) => {
        assert.equal(e.hpAfter, clone.state.enemies[i].hp, `game ${game}: ${e.uid} hp`);
        assert.equal(e.blockAfter, clone.state.enemies[i].block, `game ${game}: ${e.uid} block`);
      });
    });
  }
  assert.ok(previews > 500, `exercised ${previews} previews`);
});

test('invariants hold after every action, and games terminate', () => {
  let finished = 0;
  for (let game = 0; game < GAMES; game++) {
    const c = newGame(game);
    const rng = Rng.fromSeed(`inv-${game}`);
    playOut(c, rng, (combat) => assertInvariants(combat));
    assertInvariants(c);
    if (c.over) finished++;
  }
  assert.ok(finished >= GAMES * 0.9, `${finished}/${GAMES} games reached an end`);
});

test('determinism: same seed and inputs reproduce the same state and event log', () => {
  for (let game = 0; game < 20; game++) {
    const busA = new EventBus();
    busA.recording = true;
    const a = newGame(game, busA);
    const actions = playOut(a, Rng.fromSeed(`det-${game}`));

    const busB = new EventBus();
    busB.recording = true;
    const b = newGame(game, busB);
    for (const action of actions) {
      if (action === 'end') b.endTurn();
      else b.playCard(action.uid, action.target);
    }
    assert.deepEqual(b.state, a.state);
    assert.deepEqual(busB.log, busA.log);
  }
});

test('state survives a JSON round-trip mid-combat (save/resume)', () => {
  for (let game = 0; game < 20; game++) {
    const original = newGame(game);
    const rng = Rng.fromSeed(`save-${game}`);
    for (let i = 0; i < 8 && !original.over; i++) {
      const action = randomAction(original, rng);
      if (action === 'end') original.endTurn();
      else original.playCard(action.uid, action.target);
    }
    const resumed = new Combat(JSON.parse(JSON.stringify(original.state)), { registry });
    const rngA = Rng.fromSeed(`tail-${game}`);
    const rngB = Rng.fromSeed(`tail-${game}`);
    playOut(original, rngA);
    playOut(resumed, rngB);
    assert.deepEqual(resumed.state, original.state);
  }
});
