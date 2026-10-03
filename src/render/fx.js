// @ts-check
/**
 * Lightweight juice for the graybox: floating numbers, trauma-based screen
 * shake (docs/TECHNICAL_DESIGN.md §6.4), and pooled spark particles.
 */
import { FONT } from './draw.js';

const MAX_PARTICLES = 2000;

export class Fx {
  constructor() {
    /** @type {{ x: number, y: number, text: string, color: string, age: number, delay: number, life: number }[]} */
    this.floaters = [];
    /** Shake trauma in [0, 1]; offset scales with trauma². */
    this.trauma = 0;
    /** Accessibility multiplier for shake (0-1). */
    this.shakeScale = 1;
    this.time = 0;
    // Pooled particles: parallel typed arrays, no per-frame allocation.
    this.px = new Float32Array(MAX_PARTICLES);
    this.py = new Float32Array(MAX_PARTICLES);
    this.vx = new Float32Array(MAX_PARTICLES);
    this.vy = new Float32Array(MAX_PARTICLES);
    this.life = new Float32Array(MAX_PARTICLES);
    this.count = 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} text
   * @param {string} color
   * @param {number} [delay] seconds before it appears
   */
  float(x, y, text, color, delay = 0) {
    this.floaters.push({ x, y, text, color, age: 0, delay, life: 1.1 });
  }

  /** @param {number} amount */
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} n
   */
  sparks(x, y, n) {
    for (let i = 0; i < n && this.count < MAX_PARTICLES; i++) {
      const k = this.count++;
      const angle = Math.random() * Math.PI * 2;
      const speed = 150 + Math.random() * 350;
      this.px[k] = x;
      this.py[k] = y;
      this.vx[k] = Math.cos(angle) * speed;
      this.vy[k] = Math.sin(angle) * speed - 150;
      this.life[k] = 0.4 + Math.random() * 0.5;
    }
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    for (const f of this.floaters) {
      if (f.delay > 0) f.delay -= dt;
      else f.age += dt;
    }
    this.floaters = this.floaters.filter((f) => f.age < f.life);
    for (let k = 0; k < this.count; k++) {
      this.life[k] -= dt;
      if (this.life[k] <= 0) {
        // Swap-remove.
        const last = --this.count;
        this.px[k] = this.px[last];
        this.py[k] = this.py[last];
        this.vx[k] = this.vx[last];
        this.vy[k] = this.vy[last];
        this.life[k] = this.life[last];
        k--;
        continue;
      }
      this.vy[k] += 900 * dt;
      this.px[k] += this.vx[k] * dt;
      this.py[k] += this.vy[k] * dt;
    }
  }

  /** Current shake offset in logical pixels. */
  shakeOffset() {
    const t = this.trauma * this.trauma * this.shakeScale;
    if (t <= 0) return { x: 0, y: 0 };
    return {
      x: 22 * t * Math.sin(this.time * 61.3),
      y: 16 * t * Math.sin(this.time * 47.9 + 1.7),
    };
  }

  /** @param {CanvasRenderingContext2D} ctx */
  render(ctx) {
    ctx.fillStyle = '#ffc060';
    for (let k = 0; k < this.count; k++) ctx.fillRect(this.px[k], this.py[k], 3, 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      if (f.delay > 0) continue;
      const t = f.age / f.life;
      ctx.globalAlpha = 1 - t * t;
      ctx.font = FONT.ui(34, 800);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.strokeText(f.text, f.x, f.y - t * 70);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - t * 70);
    }
    ctx.globalAlpha = 1;
  }
}
