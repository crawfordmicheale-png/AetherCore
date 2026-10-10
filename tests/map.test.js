// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/game/core/rng.js';
import { generateMap, reachable } from '../src/game/run/map.js';

const MAPS = Array.from({ length: 200 }, (_, i) => generateMap(Rng.fromSeed(`map-${i}`)));

/** @param {import('../src/game/run/map.js').StratumMap} map */
function parentsOf(map) {
  /** @type {Map<string, string[]>} */
  const parents = new Map();
  for (const n of Object.values(map.nodes))
    for (const c of n.next) parents.set(c, [...(parents.get(c) ?? []), n.id]);
  return parents;
}

test('maps are deterministic by seed', () => {
  assert.deepEqual(generateMap(Rng.fromSeed('same')), generateMap(Rng.fromSeed('same')));
  assert.notDeepEqual(generateMap(Rng.fromSeed('a')), generateMap(Rng.fromSeed('b')));
});

test('structure: every node reachable, edges go up one row, every path ends at the boss', () => {
  for (const map of MAPS) {
    assert.equal(reachable(map).size, Object.keys(map.nodes).length);
    assert.ok(map.start.length >= 2, 'at least two starting choices');
    for (const n of Object.values(map.nodes)) {
      if (n.type === 'boss') {
        assert.deepEqual(n.next, []);
        continue;
      }
      assert.ok(n.next.length >= 1, `${n.id} is a dead end`);
      for (const c of n.next) assert.equal(map.nodes[c].row, n.row + 1);
    }
  }
});

test('paths never cross', () => {
  for (const map of MAPS) {
    const edges = Object.values(map.nodes)
      .filter((n) => n.type !== 'boss')
      .flatMap((n) =>
        n.next
          .filter((c) => map.nodes[c].type !== 'boss')
          .map((c) => [n.row, n.col, map.nodes[c].col]),
      );
    for (const [r, a, b] of edges) {
      for (const [r2, c, d] of edges) {
        if (r !== r2) continue;
        assert.ok(!((a < c && b > d) || (a > c && b < d)), `crossing at row ${r}`);
      }
    }
  }
});

test('row rules: first row combat, fixed Workbench rows, elites and Smelters not too early', () => {
  for (const map of MAPS) {
    for (const n of Object.values(map.nodes)) {
      if (n.row === 0) assert.equal(n.type, 'combat');
      if (n.row === 7 || n.row === map.rows - 2) assert.equal(n.type, 'workbench');
      if (n.type === 'elite') assert.ok(n.row >= 4);
      if (n.type === 'smelter') assert.ok(n.row >= 2);
      if (n.type === 'combat') assert.equal(n.pool, n.row < 3 ? 'easy' : 'normal');
    }
  }
});

test('spacing rules: no back-to-back Workbenches or Smelters; at most one Elite per four rows of a path', () => {
  for (const map of MAPS) {
    const parents = parentsOf(map);
    for (const n of Object.values(map.nodes)) {
      for (const p of parents.get(n.id) ?? []) {
        const pt = map.nodes[p].type;
        if (n.type === 'workbench' || n.type === 'smelter')
          assert.notEqual(pt, n.type, `${p} -> ${n.id}`);
      }
      if (n.type !== 'elite') continue;
      let frontier = [n.id];
      for (let d = 0; d < 3; d++) {
        frontier = frontier.flatMap((id) => parents.get(id) ?? []);
        for (const id of frontier)
          assert.notEqual(map.nodes[id].type, 'elite', `elites too close: ${id} and ${n.id}`);
      }
    }
  }
});

test('the node mix is varied across maps', () => {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const map of MAPS)
    for (const n of Object.values(map.nodes)) counts[n.type] = (counts[n.type] ?? 0) + 1;
  for (const type of ['combat', 'elite', 'workbench', 'smelter', 'event', 'boss'])
    assert.ok(counts[type] > 0, type);
  assert.ok(counts.combat > counts.elite * 3);
});
