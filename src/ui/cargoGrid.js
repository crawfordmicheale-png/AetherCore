// @ts-check
import { FONT, fillRound, inRect, label } from '../render/draw.js';
import { PART_H, PART_W, drawPart } from '../render/partRenderer.js';

const GAP = 14;

/**
 * The Cargo Hold: a fixed grid of slots (GDD §4.7), filled in order.
 */
export class CargoGrid {
  /**
   * @param {object} opts
   * @param {import('../game/core/registry.js').Registry} opts.registry
   * @param {() => import('../game/run/run.js').RunState['cargo']} opts.cargo
   * @param {number} opts.x
   * @param {number} opts.y
   * @param {number} [opts.cols]
   */
  constructor({ registry, cargo, x, y, cols = 2 }) {
    this.registry = registry;
    this.cargo = cargo;
    this.x = x;
    this.y = y;
    this.cols = cols;
  }

  /** @param {number} i */
  slotRect(i) {
    const col = i % this.cols;
    const row = Math.floor(i / this.cols);
    return {
      x: this.x + col * (PART_W + GAP),
      y: this.y + 40 + row * (PART_H + GAP),
      w: PART_W,
      h: PART_H,
    };
  }

  /** Whole grid area (a drop target). */
  get bounds() {
    const rows = Math.ceil(this.cargo().slots / this.cols);
    return {
      x: this.x - 10,
      y: this.y,
      w: this.cols * (PART_W + GAP) + 6,
      h: 40 + rows * (PART_H + GAP) + 6,
    };
  }

  /**
   * @param {number} px
   * @param {number} py
   * @returns {string | null} uid of the part under the point
   */
  itemAt(px, py) {
    const { items } = this.cargo();
    for (let i = 0; i < items.length; i++)
      if (inRect(this.slotRect(i), px, py)) return /** @type {string} */ (items[i].uid);
    return null;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ selected?: string | null, hover?: string | null, dim?: Set<string>, highlight?: boolean, badges?: Record<string, string> }} [opts]
   */
  draw(ctx, opts = {}) {
    const cargo = this.cargo();
    const b = this.bounds;
    fillRound(
      ctx,
      b.x,
      b.y,
      b.w,
      b.h,
      14,
      opts.highlight ? 'rgba(90, 70, 30, 0.6)' : 'rgba(30, 24, 18, 0.7)',
    );
    ctx.strokeStyle = opts.highlight ? '#ffd27a' : '#5a4428';
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, this.x, this.y + 28, `Cargo Hold  ${cargo.items.length}/${cargo.slots}`, {
      font: FONT.ui(20, 700),
      color: cargo.items.length >= cargo.slots ? '#ff9a7a' : '#e8d6b0',
    });
    for (let i = 0; i < cargo.slots; i++) {
      const r = this.slotRect(i);
      const item = cargo.items[i];
      if (!item) {
        fillRound(ctx, r.x, r.y, r.w, r.h, 10, 'rgba(0, 0, 0, 0.25)');
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = 'rgba(138, 106, 58, 0.4)';
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      const uid = /** @type {string} */ (item.uid);
      drawPart(ctx, this.registry, item, r.x, r.y, {
        selected: opts.selected === uid,
        hover: opts.hover === uid,
        dim: opts.dim?.has(uid),
        badge: opts.badges?.[uid],
      });
    }
  }
}
