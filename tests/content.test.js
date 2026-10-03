// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContent } from '../src/game/core/content.js';
import { ContentError, Registry } from '../src/game/core/registry.js';
import { loadContentFromDisk } from '../tools/load-content.js';

const shipped = await loadContentFromDisk();
const clone = () => structuredClone(shipped);

test('shipped content in src/data is valid', () => {
  assert.deepEqual(validateContent(shipped), []);
});

test('registry exposes content by id and kind, and freezes it', () => {
  const registry = new Registry(shipped);
  assert.equal(registry.get('core_furnace').power, 6);
  assert.ok(registry.all('frame').some((f) => f.id === 'frame_heavy_strike'));
  assert.ok(registry.has('mod_spring_loaded'));
  assert.ok(!registry.has('mod_nope'));
  assert.throws(() => registry.get('mod_nope'), /unknown content id/);
  assert.throws(() => {
    'use strict';
    /** @type {any} */ (registry.get('core_furnace')).power = 99;
  }, TypeError);
});

test('registry is isolated from later mutation of the source bundle', () => {
  const bundle = clone();
  const registry = new Registry(bundle);
  bundle.core[0].power = 99;
  assert.notEqual(registry.get(bundle.core[0].id).power, 99);
});

test('registry throws ContentError listing every problem', () => {
  const bundle = clone();
  bundle.core[0].weight = 9;
  bundle.mod[0].id = 'oops';
  assert.throws(
    () => new Registry(bundle),
    (err) => err instanceof ContentError && err.problems.length >= 2,
  );
});

/**
 * @param {(bundle: Record<string, any[]>) => void} mutate
 * @param {RegExp} expected
 */
function expectProblem(mutate, expected) {
  const bundle = clone();
  mutate(bundle);
  const problems = validateContent(bundle);
  assert.ok(
    problems.some((p) => expected.test(p)),
    `expected a problem matching ${expected}, got:\n${problems.join('\n')}`,
  );
}

test('field rules', () => {
  expectProblem((b) => (b.frame[0].cost = 7), /frame\[0\].*cost must be an integer in \[0, 3\]/);
  expectProblem((b) => (b.core[0].element = 'plasma'), /element must be one of/);
  expectProblem((b) => (b.frame[0].keywords = ['flying']), /keywords must be an array of/);
  expectProblem((b) => (b.mod[0].colour = 'red'), /unknown field "colour"/);
});

test('ids must be unique and correctly prefixed', () => {
  expectProblem((b) => b.core.push({ ...b.core[0] }), /duplicate id "core_scrap"/);
  expectProblem((b) => (b.slag[0].id = 'mod_molten'), /id must start with "slag_"/);
});

test('frame verb rules', () => {
  expectProblem((b) => {
    const brace = b.frame.find((f) => f.id === 'frame_brace');
    brace.target = 'single';
  }, /defend frames must target "self"/);
  expectProblem((b) => {
    const conduit = b.frame.find((f) => f.id === 'frame_conduit');
    conduit.base = 3;
  }, /utility frames must have null/);
  expectProblem((b) => {
    b.frame[0].hits = null;
  }, /attack\/defend frames need/);
});

test('chassis cross-references and design rules', () => {
  expectProblem((b) => (b.chassis[0].deck[0].core = 'core_missing'), /unknown core "core_missing"/);
  expectProblem((b) => (b.chassis[0].deck[0].core = 'mod_ballast'), /unknown core "mod_ballast"/);
  expectProblem((b) => (b.chassis[0].deck = b.chassis[0].deck.slice(0, 1)), /minimum is 8/);
  expectProblem(
    (b) => (b.chassis[0].deck[0] = { count: 4, frame: 'frame_jab', core: 'core_furnace' }),
    /weight 2 exceeds frame_jab capacity 1/,
  );
  expectProblem((b) => (b.chassis[0].cargo = [{ id: 'chassis_tinker' }]), /is not a component id/);
  expectProblem((b) => (b.chassis[0].cargo = [{}]), /must have "id" or "random"/);
});

test('missing content files are reported', () => {
  const bundle = clone();
  delete bundle.slag;
  assert.ok(validateContent(bundle).includes('slag: expected an array of definitions'));
});
