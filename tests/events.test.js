// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../src/game/core/events.js';

test('listeners receive events in subscription order, then wildcard listeners', () => {
  const bus = new EventBus();
  /** @type {string[]} */
  const calls = [];
  bus.on('*', () => calls.push('wild'));
  bus.on('damageDealt', () => calls.push('first'));
  bus.on('damageDealt', () => calls.push('second'));
  bus.emit({ type: 'damageDealt', amount: 6 });
  assert.deepEqual(calls, ['first', 'second', 'wild']);
});

test('unsubscribe and once', () => {
  const bus = new EventBus();
  let count = 0;
  const off = bus.on('tick', () => count++);
  bus.once('tick', () => (count += 10));
  bus.emit({ type: 'tick' });
  off();
  bus.emit({ type: 'tick' });
  assert.equal(count, 11);
});

test('a listener can unsubscribe during dispatch without skipping others', () => {
  const bus = new EventBus();
  /** @type {string[]} */
  const calls = [];
  /** @type {() => void} */
  let offA = () => {};
  offA = bus.on('x', () => {
    calls.push('a');
    offA();
  });
  bus.on('x', () => calls.push('b'));
  bus.emit({ type: 'x' });
  bus.emit({ type: 'x' });
  assert.deepEqual(calls, ['a', 'b', 'b']);
});

test('recording keeps an event log', () => {
  const bus = new EventBus();
  bus.emit({ type: 'ignored' });
  bus.recording = true;
  bus.emit({ type: 'cardPlayed', uid: 'c1' });
  assert.deepEqual(bus.log, [{ type: 'cardPlayed', uid: 'c1' }]);
});
