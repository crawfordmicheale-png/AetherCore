// @ts-check
/**
 * Property test: random Workbench sessions never create or destroy parts
 * except through crushing, never break a card's rules, and never let a
 * failed operation change anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERCLOCK_LIMIT } from '../src/game/core/content.js';
import { Rng } from '../src/game/core/rng.js';
import { deriveCard } from '../src/game/model/card.js';
import { MIN_DECK_SIZE } from '../src/game/run/economy.js';
import { GAUNTLET } from '../src/game/run/gauntlet.js';
import { Run, RunError } from '../src/game/run/run.js';
import { registry } from './helpers.js';

const COMPONENTS = ['frame', 'core', 'mod'].flatMap((k) =>
  registry
    .all(/** @type {any} */ (k))
    .filter((d) => d.tier !== 'starter')
    .map((d) => d.id),
);

/** @param {Run} run */
const partCount = (run) =>
  run.state.cargo.items.length + run.state.deck.reduce((n, c) => n + 2 + (c.mod ? 1 : 0), 0);

/**
 * One random workbench action; may legitimately be refused.
 * @param {Run} run
 * @param {Rng} rng
 */
function randomOp(run, rng) {
  const cargo = run.state.cargo.items;
  const deck = run.state.deck;
  const anyCargo = () => (cargo.length ? /** @type {string} */ (rng.pick(cargo).uid) : 'none');
  const ofKind = (/** @type {string} */ kind) =>
    cargo.filter((p) => registry.kindOf(p.defId) === kind);
  switch (rng.int(0, 6)) {
    case 0: {
      const f = ofKind('frame');
      const c = ofKind('core');
      const m = ofKind('mod');
      if (!f.length || !c.length)
        return () => run.assemble({ frame: anyCargo(), core: anyCargo() });
      return () =>
        run.assemble({
          frame: /** @type {string} */ (rng.pick(f).uid),
          core: /** @type {string} */ (rng.pick(c).uid),
          mod: m.length && rng.chance(0.6) ? /** @type {string} */ (rng.pick(m).uid) : null,
        });
    }
    case 1: {
      const card = rng.pick(deck).uid;
      const slot = rng.pick(/** @type {const} */ (['frame', 'core', 'mod']));
      const value = slot === 'mod' && rng.chance(0.3) ? null : anyCargo();
      return () => run.modify(card, { [slot]: value });
    }
    case 2:
      return () => run.dismantle(rng.pick(deck).uid);
    case 3:
      return rng.chance(0.5)
        ? () => run.tune({ cargoUid: anyCargo() })
        : () =>
            run.tune({
              cardUid: rng.pick(deck).uid,
              slot: rng.pick(/** @type {const} */ (['core', 'mod'])),
            });
    case 4:
      return () => run.crush(anyCargo());
    case 5:
      return () => run.fieldRepair();
    default:
      return () => {
        // Refill charges to keep sessions long.
        if (run.state.workbench) run.state.workbench.used = 0;
      };
  }
}

test('random Workbench sessions conserve parts and keep every card legal', () => {
  let applied = 0;
  let refused = 0;
  for (let game = 0; game < 40; game++) {
    const rng = Rng.fromSeed(`wb-${game}`);
    const run = Run.create({
      registry,
      chassisId: 'chassis_tinker',
      seed: `wb-${game}`,
      deck: game % 2 ? 'sandbox' : 'starter',
    });
    run.state.cargo.items = Array.from({ length: rng.int(4, 10) }, (_, i) => ({
      uid: `x${i}`,
      defId: rng.pick(COMPONENTS),
    }));
    run.state.step = GAUNTLET.findIndex((s) => s.type === 'workbench');
    run.state.hp = 30;
    run.enterStep();

    for (let i = 0; i < 80; i++) {
      const before = JSON.stringify(run.state);
      const partsBefore = partCount(run) + run.state.stats.partsCrushed;
      const aetherBefore = run.state.aether;
      try {
        randomOp(run, rng)();
        applied++;
      } catch (err) {
        if (!(err instanceof RunError)) throw err;
        refused++;
        assert.equal(JSON.stringify(run.state), before, `refused op changed state: ${err.message}`);
        continue;
      }
      // Conservation: parts only leave by being crushed.
      assert.equal(partCount(run) + run.state.stats.partsCrushed, partsBefore);
      assert.ok(run.state.aether >= aetherBefore);
      // Every card is legal, the deck floor holds, Cargo fits and uids are unique.
      for (const card of run.state.deck) {
        assert.ok(deriveCard(card, { registry }).overclock <= OVERCLOCK_LIMIT);
        for (const slot of /** @type {const} */ (['frame', 'core', 'mod'])) {
          if (card[slot]) assert.equal(registry.kindOf(card[slot].defId), slot);
        }
      }
      assert.ok(run.state.deck.length >= MIN_DECK_SIZE);
      assert.ok(run.state.cargo.items.length <= run.state.cargo.slots);
      const uids = run.state.cargo.items.map((p) => p.uid);
      assert.equal(new Set(uids).size, uids.length);
      const cardUids = run.state.deck.map((c) => c.uid);
      assert.equal(new Set(cardUids).size, cardUids.length);
      assert.ok(run.state.hp <= run.state.maxHp);
    }
  }
  assert.ok(applied > 600 && refused > 300, `applied ${applied}, refused ${refused}`);
});
