// @ts-check
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';

/**
 * Placeholder title screen for M0: proves the layer stack, scaling, loop, and
 * content loading all work. Replaced by the real title scene in M1.
 */
export class BootScene {
  /**
   * @param {object} opts
   * @param {import('../game/core/registry.js').Registry} opts.registry
   * @param {string} opts.seed
   * @param {() => number} opts.fps
   * @param {string} opts.platform
   */
  constructor({ registry, seed, fps, platform }) {
    this.registry = registry;
    this.seed = seed;
    this.fps = fps;
    this.platform = platform;
    this.time = 0;
    this.pointer = { x: LOGICAL_WIDTH / 2, y: LOGICAL_HEIGHT / 2 };
    this.bgVersion = -1;
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
  }

  /** @param {{ type: string, x?: number, y?: number }} event */
  onInput(event) {
    if (event.type === 'pointermove' && event.x !== undefined && event.y !== undefined) {
      this.pointer = { x: event.x, y: event.y };
    }
  }

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    // Static background is only redrawn when the window size changes.
    if (this.bgVersion !== stage.resizeVersion) {
      this.drawBackground(stage.ctx('bg'));
      this.bgVersion = stage.resizeVersion;
    }

    stage.clear('world');
    const world = stage.ctx('world');
    const cx = LOGICAL_WIDTH / 2;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2);

    // A slowly turning gear around a glowing core: the M0 "it runs" indicator.
    world.save();
    world.translate(cx, 420);
    world.rotate(this.time * 0.4);
    drawGear(world, 140, 16, '#8a6a3a');
    world.restore();
    const glow = world.createRadialGradient(cx, 420, 0, cx, 420, 90);
    glow.addColorStop(0, `rgba(160, 200, 255, ${0.6 + 0.4 * pulse})`);
    glow.addColorStop(1, 'rgba(90, 130, 255, 0)');
    world.fillStyle = glow;
    world.beginPath();
    world.arc(cx, 420, 90, 0, Math.PI * 2);
    world.fill();

    world.textAlign = 'center';
    world.fillStyle = '#e8d6b0';
    world.font = '600 96px Georgia, serif';
    world.fillText('AETHERCORE', cx, 700);
    world.fillStyle = '#9c8a6a';
    world.font = '28px Georgia, serif';
    world.fillText('Build your cards. Survive the Spire.', cx, 750);

    const counts = ['frame', 'core', 'mod', 'slag', 'chassis']
      .map((kind) => `${this.registry.all(/** @type {any} */ (kind)).length} ${kind}`)
      .join(' · ');
    world.font = '20px monospace';
    world.fillStyle = '#6f6555';
    world.fillText(`M0 foundations · content: ${counts}`, cx, 960);
    world.fillText(`seed ${this.seed} · ${this.platform} · ${this.fps().toFixed(0)} fps`, cx, 992);

    // FX layer: a cursor spark, confirming pointer → logical coordinate mapping.
    stage.clear('fx');
    const fx = stage.ctx('fx');
    fx.fillStyle = `rgba(255, 190, 90, ${0.5 + 0.5 * pulse})`;
    fx.beginPath();
    fx.arc(this.pointer.x, this.pointer.y, 6, 0, Math.PI * 2);
    fx.fill();
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
