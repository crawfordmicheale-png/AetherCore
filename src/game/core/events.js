// @ts-check
/**
 * Synchronous event bus (docs/TECHNICAL_DESIGN.md §3.3).
 *
 * Game logic emits events as state changes; the renderer and audio subscribe
 * to build their own timelines. Listeners run in subscription order, so the
 * hook ordering rules can be enforced by the order systems subscribe in.
 */

/**
 * @typedef {{ type: string, [key: string]: unknown }} GameEvent
 * @typedef {(event: GameEvent) => void} Listener
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Listener[]>} */
    this.listeners = new Map();
    /** @type {GameEvent[]} */
    this.log = [];
    /** Keep an in-memory log of emitted events (useful for tests and replays). */
    this.recording = false;
  }

  /**
   * Subscribe to an event type, or to every event with "*".
   * @param {string} type
   * @param {Listener} listener
   * @returns {() => void} unsubscribe function
   */
  on(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
    return () => this.off(type, listener);
  }

  /**
   * @param {string} type
   * @param {Listener} listener
   * @returns {() => void}
   */
  once(type, listener) {
    /** @type {Listener} */
    const wrapped = (event) => {
      this.off(type, wrapped);
      listener(event);
    };
    return this.on(type, wrapped);
  }

  /**
   * @param {string} type
   * @param {Listener} listener
   */
  off(type, listener) {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(listener);
    if (i !== -1) list.splice(i, 1);
  }

  /** @param {GameEvent} event */
  emit(event) {
    if (this.recording) this.log.push(event);
    // Copy so listeners can unsubscribe during dispatch.
    for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener(event);
    for (const listener of [...(this.listeners.get('*') ?? [])]) listener(event);
  }

  clear() {
    this.listeners.clear();
    this.log = [];
  }
}
