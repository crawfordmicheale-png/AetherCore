// @ts-check
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, fillRound, inRect, label } from '../render/draw.js';

/**
 * Title screen with a graybox encounter picker (M1). The run map replaces the
 * picker in M3.
 */
export class TitleScene {
  /**
   * @param {object} opts
   * @param {import('../game/core/registry.js').Registry} opts.registry
   * @param {() => number} opts.fps
   * @param {string} opts.platform
   * @param {number} [opts.selected]
   * @param {'starter' | 'sandbox'} [opts.deck]
   * @param {(encounterId: string, deck: 'starter' | 'sandbox') => void} opts.onStart
   */
  constructor({ registry, fps, platform, selected = 0, deck = 'sandbox', onStart }) {
    this.registry = registry;
    this.fps = fps;
    this.platform = platform;
    this.onStart = onStart;
    this.encounters = registry.all('encounter');
    this.selected = selected;
    /** @type {'starter' | 'sandbox'} */
    this.deck = deck;
    this.time = 0;
    this.bgVersion = -1;
  }

  /** @param {number} i */
  itemRect(i) {
    return { x: LOGICAL_WIDTH / 2 - 380, y: 560 + i * 58, w: 760, h: 48 };
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
  }

  /** @param {{ type: string, x?: number, y?: number, key?: string, button?: number }} event */
  onInput(event) {
    if (event.type === 'pointermove' || event.type === 'pointerdown') {
      const i = this.encounters.findIndex((_, i) =>
        inRect(this.itemRect(i), event.x ?? -1, event.y ?? -1),
      );
      if (i >= 0) {
        this.selected = i;
        if (event.type === 'pointerdown' && event.button === 0) this.start();
      }
    }
    if (event.type !== 'keydown') return;
    const n = this.encounters.length;
    if (event.key === 'ArrowDown' || event.key === 's') this.selected = (this.selected + 1) % n;
    else if (event.key === 'ArrowUp' || event.key === 'w')
      this.selected = (this.selected - 1 + n) % n;
    else if (event.key === 'Enter' || event.key === ' ') this.start();
    else if (event.key === 't' || event.key === 'T')
      this.deck = this.deck === 'sandbox' ? 'starter' : 'sandbox';
    else if (event.key && /^[1-9]$/.test(event.key) && Number(event.key) <= n) {
      this.selected = Number(event.key) - 1;
      this.start();
    }
  }

  start() {
    this.onStart(this.encounters[this.selected].id, this.deck);
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
    ctx.translate(cx, 250);
    ctx.rotate(this.time * 0.4);
    drawGear(ctx, 110, 16, '#8a6a3a');
    ctx.restore();
    const glow = ctx.createRadialGradient(cx, 250, 0, cx, 250, 70);
    glow.addColorStop(0, `rgba(160, 200, 255, ${0.6 + 0.4 * pulse})`);
    glow.addColorStop(1, 'rgba(90, 130, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, 250, 70, 0, Math.PI * 2);
    ctx.fill();

    label(ctx, cx, 470, 'AETHERCORE', { font: FONT.title(96), align: 'center' });
    label(ctx, cx, 515, 'Combat graybox · choose an encounter', {
      font: FONT.ui(24),
      align: 'center',
      color: '#9c8a6a',
    });

    this.encounters.forEach((enc, i) => {
      const r = this.itemRect(i);
      const active = i === this.selected;
      fillRound(ctx, r.x, r.y, r.w, r.h, 10, active ? '#4a3a22' : 'rgba(40, 32, 24, 0.8)');
      ctx.strokeStyle = active ? '#ffd27a' : '#6a5030';
      ctx.lineWidth = 2;
      ctx.stroke();
      const names = enc.enemies
        .map((/** @type {string} */ id) => this.registry.get(id).name)
        .join(', ');
      label(ctx, r.x + 18, r.y + 31, `${i + 1}. ${enc.name}`, { font: FONT.ui(21, 700) });
      label(ctx, r.x + r.w - 18, r.y + 31, `${enc.kind} · ${names}`, {
        font: FONT.ui(15),
        align: 'right',
        color: enc.kind === 'elite' ? '#ff9a7a' : '#a89878',
      });
    });

    label(
      ctx,
      cx,
      1010,
      'Enter / click to fight · ↑↓ to choose · in combat: 1-0 select, Q/E target, Space end turn, right-click / Alt exploded view',
      {
        font: FONT.ui(17),
        align: 'center',
        color: '#7a6a55',
      },
    );
    label(ctx, cx, 1042, `${this.platform} · ${this.fps().toFixed(0)} fps`, {
      font: FONT.mono(15),
      align: 'center',
      color: '#5a5040',
    });
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
