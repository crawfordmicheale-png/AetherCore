// @ts-check
import { FONT, fillRound, inRect, label } from '../render/draw.js';

/**
 * A clickable, optionally hotkeyed button. `enabled` and `label` may be
 * functions so the button reflects live state.
 */
export class Button {
  /**
   * @param {object} opts
   * @param {{ x: number, y: number, w: number, h: number }} opts.rect
   * @param {string | (() => string)} opts.label
   * @param {() => void} opts.onClick
   * @param {boolean | (() => boolean)} [opts.enabled]
   * @param {string[]} [opts.keys] keys that trigger it
   * @param {'normal' | 'primary' | 'danger'} [opts.style]
   */
  constructor({ rect, label, onClick, enabled = true, keys = [], style = 'normal' }) {
    this.rect = rect;
    this.label = label;
    this.onClick = onClick;
    this.enabled = enabled;
    this.keys = keys;
    this.style = style;
  }

  isEnabled() {
    return typeof this.enabled === 'function' ? this.enabled() : this.enabled;
  }

  text() {
    return typeof this.label === 'function' ? this.label() : this.label;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  hit(x, y) {
    return inRect(this.rect, x, y);
  }

  /**
   * Handles a click at (x, y). Returns true if consumed.
   * @param {number} x
   * @param {number} y
   */
  click(x, y) {
    if (!this.hit(x, y)) return false;
    if (this.isEnabled()) this.onClick();
    return true;
  }

  /** @param {string} key */
  key(key) {
    if (!this.keys.includes(key)) return false;
    if (this.isEnabled()) this.onClick();
    return true;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ x: number, y: number }} pointer
   */
  draw(ctx, pointer) {
    const { x, y, w, h } = this.rect;
    const enabled = this.isEnabled();
    const hover = enabled && this.hit(pointer.x, pointer.y);
    const fills = {
      normal: ['#4a3a22', '#5e4a2a'],
      primary: ['#5a4a1a', '#7a6222'],
      danger: ['#4a2420', '#6a302a'],
    };
    fillRound(ctx, x, y, w, h, 10, enabled ? fills[this.style][hover ? 1 : 0] : '#2a2420');
    ctx.strokeStyle = enabled ? (this.style === 'primary' ? '#ffd27a' : '#c9a86a') : '#4a3a2a';
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, x + w / 2, y + h / 2 + 7, this.text(), {
      font: FONT.ui(h > 50 ? 20 : 17, 700),
      align: 'center',
      color: enabled ? '#fff0c8' : '#6a5a4a',
    });
  }
}
