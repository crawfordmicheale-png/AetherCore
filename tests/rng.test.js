// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng, RngStreams, STREAMS, makeRunSeed } from '../src/game/core/rng.js';

const take = (/** @type {Rng} */ rng, /** @type {number} */ n) =>
  Array.from({ length: n }, () => rng.nextUint32());

test('same seed produces the same sequence', () => {
  assert.deepEqual(take(Rng.fromSeed('ABCD-1234'), 50), take(Rng.fromSeed('ABCD-1234'), 50));
});

test('different seeds diverge', () => {
  assert.notDeepEqual(take(Rng.fromSeed('seed-a'), 10), take(Rng.fromSeed('seed-b'), 10));
});

test('serialize/restore resumes the exact sequence', () => {
  const rng = Rng.fromSeed('resume');
  take(rng, 17);
  const restored = new Rng(JSON.parse(JSON.stringify(rng.serialize())));
  assert.deepEqual(take(restored, 20), take(rng, 20));
});

test('next() stays in [0, 1) and int() respects inclusive bounds', () => {
  const rng = Rng.fromSeed('bounds');
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const f = rng.next();
    assert.ok(f >= 0 && f < 1);
    const n = rng.int(-2, 2);
    assert.ok(n >= -2 && n <= 2);
    seen.add(n);
  }
  assert.deepEqual([...seen].sort(), [-1, -2, 0, 1, 2].sort());
});

test('int() rejects invalid ranges', () => {
  const rng = Rng.fromSeed('x');
  assert.throws(() => rng.int(5, 1), RangeError);
  assert.throws(() => rng.int(0.5, 2), RangeError);
});

test('int() is roughly uniform', () => {
  const rng = Rng.fromSeed('uniform');
  const buckets = [0, 0, 0, 0, 0, 0];
  const n = 60000;
  for (let i = 0; i < n; i++) buckets[rng.int(0, 5)]++;
  for (const count of buckets) assert.ok(Math.abs(count - n / 6) < n * 0.01, `bucket ${count}`);
});

test('shuffle is a deterministic permutation', () => {
  const a = Rng.fromSeed('shuffle').shuffle([...Array(20).keys()]);
  const b = Rng.fromSeed('shuffle').shuffle([...Array(20).keys()]);
  assert.deepEqual(a, b);
  assert.deepEqual(
    [...a].sort((x, y) => x - y),
    [...Array(20).keys()],
  );
});

test('weighted() never picks zero-weight items and rejects all-zero weights', () => {
  const rng = Rng.fromSeed('weights');
  const items = [
    { id: 'never', w: 0 },
    { id: 'common', w: 9 },
    { id: 'rare', w: 1 },
  ];
  const counts = { never: 0, common: 0, rare: 0 };
  for (let i = 0; i < 10000; i++)
    counts[/** @type {'never'} */ (rng.weighted(items, (x) => x.w).id)]++;
  assert.equal(counts.never, 0);
  assert.ok(counts.common > counts.rare * 6);
  assert.throws(() => rng.weighted([{ w: 0 }], (x) => x.w), RangeError);
});

test('pick() rejects empty arrays', () => {
  assert.throws(() => Rng.fromSeed('x').pick([]), RangeError);
});

test('streams are independent: consuming one does not perturb another', () => {
  const a = RngStreams.fromSeed('RUN-1');
  const b = RngStreams.fromSeed('RUN-1');
  take(a.get('shuffle'), 100);
  assert.deepEqual(take(a.get('map'), 10), take(b.get('map'), 10));
});

test('streams round-trip through JSON', () => {
  const streams = RngStreams.fromSeed('RUN-2');
  take(streams.get('loot'), 7);
  const restored = RngStreams.deserialize(JSON.parse(JSON.stringify(streams.serialize())));
  for (const name of STREAMS)
    assert.deepEqual(take(restored.get(name), 5), take(streams.get(name), 5));
});

test('deserialize() requires every stream', () => {
  const data = RngStreams.fromSeed('RUN-3').serialize();
  delete data.ai;
  assert.throws(() => RngStreams.deserialize(data), /missing stream "ai"/);
});

test('makeRunSeed() is formatted, deterministic, and avoids ambiguous characters', () => {
  const seed = makeRunSeed('entropy');
  assert.match(seed, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(makeRunSeed('entropy'), seed);
});
