// @ts-check
/**
 * Stacked, letterboxed canvas layers at a fixed logical resolution
 * (docs/TECHNICAL_DESIGN.md §6.1). Everything draws in 1920x1080 logical
 * units; this module handles window scaling and devicePixelRatio.
 */

export const LOGICAL_WIDTH = 1920;
export const LOGICAL_HEIGHT = 1080;

/** Bottom to top. */
export const LAYER_NAMES = /** @type {const} */ (['bg', 'world', 'hand', 'fx', 'ui']);

/** @typedef {typeof LAYER_NAMES[number]} LayerName */

export class Stage {
  /** @param {HTMLElement} container */
  constructor(container) {
    this.container = container;
    /** CSS pixels per logical unit. */
    this.scale = 1;
    /** @type {Record<LayerName, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D }>} */
    this.layers = /** @type {any} */ ({});
    for (const name of LAYER_NAMES) {
      const canvas = document.createElement('canvas');
      canvas.dataset.layer = name;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      container.appendChild(canvas);
      this.layers[name] = { canvas, ctx };
    }
    /** Incremented on every resize so layers that cache content know to redraw. */
    this.resizeVersion = 0;
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.scale = Math.min(vw / LOGICAL_WIDTH, vh / LOGICAL_HEIGHT);
    const cssW = Math.floor(LOGICAL_WIDTH * this.scale);
    const cssH = Math.floor(LOGICAL_HEIGHT * this.scale);
    Object.assign(this.container.style, {
      width: `${cssW}px`,
      height: `${cssH}px`,
      left: `${Math.floor((vw - cssW) / 2)}px`,
      top: `${Math.floor((vh - cssH) / 2)}px`,
    });
    const dpr = window.devicePixelRatio || 1;
    for (const { canvas, ctx } of Object.values(this.layers)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(this.scale * dpr, 0, 0, this.scale * dpr, 0, 0);
    }
    this.resizeVersion++;
  }

  /** @param {LayerName} name */
  ctx(name) {
    return this.layers[name].ctx;
  }

  /** @param {LayerName} name */
  clear(name) {
    this.layers[name].ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  }

  /**
   * Converts a client-space pointer position to logical coordinates.
   * @param {number} clientX
   * @param {number} clientY
   */
  toLogical(clientX, clientY) {
    const rect = this.container.getBoundingClientRect();
    return { x: (clientX - rect.left) / this.scale, y: (clientY - rect.top) / this.scale };
  }

  destroy() {
    window.removeEventListener('resize', this.resize);
    this.container.replaceChildren();
  }
}
