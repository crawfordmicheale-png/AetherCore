// @ts-check
/**
 * @typedef {{ type: string, x?: number, y?: number, key?: string, button?: number }} InputEvent
 *
 * @typedef {object} Scene
 * @property {(params?: Record<string, unknown>) => void} [enter]
 * @property {() => void} [exit]
 * @property {(dt: number) => void} [update]
 * @property {(stage: import('../render/canvas.js').Stage) => void} render
 * @property {(event: InputEvent) => void} [onInput]
 */

export class SceneManager {
  constructor() {
    /** @type {Scene | null} */
    this.current = null;
  }

  /**
   * @param {Scene} scene
   * @param {Record<string, unknown>} [params]
   */
  change(scene, params) {
    this.current?.exit?.();
    this.current = scene;
    scene.enter?.(params);
  }

  /** @param {number} dt */
  update(dt) {
    this.current?.update?.(dt);
  }

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    this.current?.render(stage);
  }

  /** @param {InputEvent} event */
  input(event) {
    this.current?.onInput?.(event);
  }
}
