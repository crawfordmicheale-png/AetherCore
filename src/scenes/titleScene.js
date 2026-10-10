// @ts-check
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, fillRound, inRect, label } from '../render/draw.js';

/**
 * @typedef {{ label: string, detail: string, accent?: string, action: () => void }} MenuItem
 */

/**
 * Title screen: run options plus graybox quick fights. The menu is built by
 * the caller so the scene stays free of game-flow logic.
 */
export class TitleScene {
  /**
   * @param {object} opts
   * @param {() => MenuItem[]} opts.items
   * @param {() => number} opts.fps
   * @param {string} opts.platform
   * @param {() => string} opts.footer  extra status line (e.g. the deck toggle)
   * @param {(key: string) => void} [opts.onKey]  keys not handled by the menu
   * @param {number} [opts.selected]
   */
  constructor({ items, fps, platform, footer, onKey, selected = 0 }) {
    this.items = items;
    this.fps = fps;
    this.platform = platform;
    this.footer = footer;
    this.onKey = onKey;
    this.selected = selected;
    this.time = 0;
    this.bgVersion = -1;
  }

  /** @param {number} i */
  itemRect(i) {
    return { x: LOGICAL_WIDTH / 2 - 380, y: 470 + i * 54, w: 760, h: 46 };
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
  }

  /** @param {import('./sceneManager.js').InputEvent} event */
  onInput(event) {
    const items = this.items();
    if (event.type === 'pointermove' || event.type === 'pointerdown') {
      const i = items.findIndex((_, i) => inRect(this.itemRect(i), event.x ?? -1, event.y ?? -1));
      if (i >= 0) {
        this.selected = i;
        if (event.type === 'pointerdown' && event.button === 0) items[i].action();
      }
    }
    if (event.type !== 'keydown' || !event.key) return;
    const n = items.length;
    if (event.key === 'ArrowDown' || event.key === 's') this.selected = (this.selected + 1) % n;
    else if (event.key === 'ArrowUp' || event.key === 'w')
      this.selected = (this.selected - 1 + n) % n;
    else if (event.key === 'Enter' || event.key === ' ')
      items[Math.min(this.selected, n - 1)].action();
    else this.onKey?.(event.key);
  }

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    if (this.bgVersion !== stage.resizeVersion) {
      this.drawBackground(stage.ctx('bg'));
      this.bgVersion = stage.resizeVersion;
    }
    for (const layer of /** @type {const} */ (['hand', 'fx', 'ui'])) stage.clear(layer);
    stage.clear('world');
    const ctx = stage.ctx('world');
    const cx = LOGICAL_WIDTH / 2;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2);

    ctx.save();
    ctx.translate(cx, 190);
    ctx.rotate(this.time * 0.4);
    drawGear(ctx, 95, 16, '#8a6a3a');
    ctx.restore();
    const glow = ctx.createRadialGradient(cx, 190, 0, cx, 190, 60);
    glow.addColorStop(0, `rgba(160, 200, 255, ${0.6 + 0.4 * pulse})`);
    glow.addColorStop(1, 'rgba(90, 130, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, 190, 60, 0, Math.PI * 2);
    ctx.fill();

    label(ctx, cx, 385, 'AETHERCORE', { font: FONT.title(92), align: 'center' });
    label(ctx, cx, 428, 'Build your cards. Survive the Spire.', {
      font: FONT.ui(22),
      align: 'center',
      color: '#9c8a6a',
    });

    const items = this.items();
    items.forEach((item, i) => {
      const r = this.itemRect(i);
      const active = i === this.selected;
      fillRound(ctx, r.x, r.y, r.w, r.h, 10, active ? '#4a3a22' : 'rgba(40, 32, 24, 0.8)');
      ctx.strokeStyle = active ? '#ffd27a' : '#6a5030';
      ctx.lineWidth = 2;
      ctx.stroke();
      label(ctx, r.x + 18, r.y + 30, item.label, { font: FONT.ui(20, 700) });
      label(ctx, r.x + r.w - 18, r.y + 30, item.detail, {
        font: FONT.ui(15),
        align: 'right',
        color: item.accent ?? '#a89878',
      });
    });

    label(ctx, cx, 1000, this.footer(), {
      font: FONT.ui(19, 600),
      align: 'center',
      color: '#d8b070',
    });
    label(
      ctx,
      cx,
      1042,
      `↑↓ choose · Enter / click to start · ${this.platform} · ${this.fps().toFixed(0)} fps`,
      {
        font: FONT.mono(15),
        align: 'center',
        color: '#5a5040',
      },
    );
  }

  /** @param {CanvasRenderingContext2D} ctx */
  drawBackground(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
    grad.addColorStop(0, '#1b1612');
    grad.addColorStop(1, '#0d0b09');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    ctx.strokeStyle = 'rgba(138, 106, 58, 0.08)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= LOGICAL_WIDTH; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, LOGICAL_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y <= LOGICAL_HEIGHT; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(LOGICAL_WIDTH, y);
      ctx.stroke();
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} radius
 * @param {number} teeth
 * @param {string} color
 */
function drawGear(ctx, radius, teeth, color) {
  const inner = radius * 0.82;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 === 0 ? radius : inner;
    const a0 = (i / (teeth * 2)) * Math.PI * 2;
    const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
  }
  ctx.closePath();
  ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2, true);
  ctx.fillStyle = color;
  ctx.fill('evenodd');
}
