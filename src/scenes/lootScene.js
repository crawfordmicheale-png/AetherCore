// @ts-check
/**
 * Post-combat salvage (GDD §4.6–4.7): drag parts from the tray into the
 * Cargo Hold, crush anything for Aether, and leave the rest behind.
 */
import { RunError } from '../game/run/run.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, fillRound, inRect, label, panel } from '../render/draw.js';
import { Fx } from '../render/fx.js';
import { PART_H, PART_W, drawPart, partSummary } from '../render/partRenderer.js';
import { Button } from '../ui/button.js';
import { CargoGrid } from '../ui/cargoGrid.js';
import { drawRunHeader } from './runHud.js';

const TRAY = { x: 120, y: 250 };
const TRAY_GAP = 24;
const CRUSHER = { x: 120, y: 760, w: 420, h: 120 };

export class LootScene {
  /**
   * @param {object} opts
   * @param {import('../game/run/run.js').Run} opts.run
   * @param {() => void} opts.onChange   Called after every state change (autosave).
   * @param {() => void} opts.onDone
   */
  constructor({ run, onChange, onDone }) {
    this.run = run;
    this.registry = run.registry;
    this.onChange = onChange;
    this.onDone = onDone;
    this.fx = new Fx();
    this.time = 0;
    this.pointer = { x: 0, y: 0 };
    /** @type {string | null} */ this.selected = null;
    /** @type {{ uid: string, from: 'tray' | 'cargo', start: { x: number, y: number } } | null} */ this.drag =
      null;
    /** @type {{ text: string, color: string, until: number } | null} */ this.message = null;
    this.leaveConfirmUntil = 0;
    this.bgVersion = -1;
    this.cargo = new CargoGrid({
      registry: this.registry,
      cargo: () => this.run.state.cargo,
      x: 1500,
      y: 150,
    });
    this.buttons = [
      new Button({
        rect: { x: 600, y: 900, w: 200, h: 56 },
        label: () => (this.selected && this.inTray(this.selected) ? 'Take [T]' : 'Take'),
        enabled: () => !!this.selected && this.inTray(this.selected) && this.run.cargoFree > 0,
        keys: ['t', 'T'],
        onClick: () => this.take(/** @type {string} */ (this.selected)),
      }),
      new Button({
        rect: { x: 820, y: 900, w: 220, h: 56 },
        label: () =>
          this.selectedPart()
            ? `Crush +${this.run.crushValue(/** @type {any} */ (this.selectedPart()))} [C]`
            : 'Crush',
        enabled: () => !!this.selectedPart(),
        keys: ['c', 'C'],
        style: 'danger',
        onClick: () => this.crush(/** @type {string} */ (this.selected)),
      }),
      new Button({
        rect: { x: 1500, y: 940, w: 360, h: 70 },
        label: () =>
          this.time < this.leaveConfirmUntil ? 'Leave them behind? [Enter]' : 'Continue [Enter]',
        keys: ['Enter'],
        style: 'primary',
        onClick: () => this.leave(),
      }),
    ];
  }

  get tray() {
    return this.run.state.loot?.items ?? [];
  }

  /** @param {string} uid */
  inTray(uid) {
    return this.tray.some((p) => p.uid === uid);
  }

  selectedPart() {
    if (!this.selected) return null;
    return (
      [...this.tray, ...this.run.state.cargo.items].find((p) => p.uid === this.selected) ?? null
    );
  }

  /** @param {number} i */
  trayRect(i) {
    const perRow = 6;
    return {
      x: TRAY.x + (i % perRow) * (PART_W + TRAY_GAP),
      y: TRAY.y + Math.floor(i / perRow) * (PART_H + 40),
      w: PART_W,
      h: PART_H,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  trayAt(x, y) {
    const i = this.tray.findIndex((_, i) => inRect(this.trayRect(i), x, y));
    return i === -1 ? null : /** @type {string} */ (this.tray[i].uid);
  }

  /**
   * @param {string} text
   * @param {string} [color]
   */
  say(text, color = '#e8d6b0') {
    this.message = { text, color, until: this.time + 2.6 };
  }

  /** @param {() => void} fn */
  attempt(fn) {
    try {
      fn();
      this.onChange();
    } catch (err) {
      if (!(err instanceof RunError)) throw err;
      this.say(err.message, '#ff9a8a');
    }
  }

  /** @param {string} uid */
  take(uid) {
    this.attempt(() => {
      this.run.takeLoot(uid);
      this.selected = null;
    });
  }

  /** @param {string} uid */
  crush(uid) {
    this.attempt(() => {
      const part = /** @type {any} */ (this.selectedPart() ?? { defId: '' });
      const name = this.registry.has(part.defId) ? this.registry.get(part.defId).name : 'Part';
      const value = this.run.crush(uid);
      this.fx.sparks(CRUSHER.x + CRUSHER.w / 2, CRUSHER.y + 40, 40);
      this.fx.float(CRUSHER.x + CRUSHER.w / 2, CRUSHER.y, `+${value} Aether`, '#ffd27a');
      this.say(`${name} crushed for ${value} Aether`, '#ffd27a');
      this.selected = null;
    });
  }

  leave() {
    if (this.tray.length > 0 && this.time >= this.leaveConfirmUntil) {
      this.leaveConfirmUntil = this.time + 2.5;
      this.say(
        `${this.tray.length} part(s) will be left behind. Press again to continue.`,
        '#ffb070',
      );
      return;
    }
    this.attempt(() => this.run.leaveLoot());
    this.onDone();
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
    this.fx.update(dt);
  }

  /** @param {import('./sceneManager.js').InputEvent} event */
  onInput(event) {
    if (event.x !== undefined && event.y !== undefined) this.pointer = { x: event.x, y: event.y };
    const { x, y } = this.pointer;
    if (event.type === 'pointerdown' && event.button === 0) {
      for (const b of this.buttons) if (b.click(x, y)) return;
      const tray = this.trayAt(x, y);
      const cargo = this.cargo.itemAt(x, y);
      const uid = tray ?? cargo;
      this.selected = uid;
      if (uid) this.drag = { uid, from: tray ? 'tray' : 'cargo', start: { x, y } };
    } else if (event.type === 'pointerup' && event.button === 0 && this.drag) {
      const { uid, from, start } = this.drag;
      this.drag = null;
      if (Math.hypot(x - start.x, y - start.y) < 20) return;
      if (inRect(CRUSHER, x, y)) this.crush(uid);
      else if (from === 'tray' && inRect(this.cargo.bounds, x, y)) this.take(uid);
    } else if (event.type === 'keydown') {
      for (const b of this.buttons) if (b.key(/** @type {string} */ (event.key))) return;
    }
  }

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    if (this.bgVersion !== stage.resizeVersion) {
      this.bgVersion = stage.resizeVersion;
      const bg = stage.ctx('bg');
      const g = bg.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
      g.addColorStop(0, '#1e1812');
      g.addColorStop(1, '#0c0a08');
      bg.fillStyle = g;
      bg.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    }
    for (const layer of /** @type {const} */ (['world', 'hand', 'fx', 'ui'])) stage.clear(layer);
    const ctx = stage.ctx('world');
    drawRunHeader(ctx, this.run, 'Salvage');

    const loot = this.run.state.loot;
    label(ctx, TRAY.x, 200, 'Recovered parts', { font: FONT.title(32) });
    label(ctx, TRAY.x + 300, 200, `+${loot?.aether ?? 0} Aether collected`, {
      font: FONT.ui(20, 600),
      color: '#ffd27a',
    });
    const dragging =
      this.drag &&
      Math.hypot(this.pointer.x - this.drag.start.x, this.pointer.y - this.drag.start.y) >= 20
        ? this.drag
        : null;
    this.tray.forEach((part, i) => {
      if (dragging?.uid === part.uid) return;
      const r = this.trayRect(i);
      drawPart(ctx, this.registry, part, r.x, r.y, {
        selected: this.selected === part.uid,
        hover: this.trayAt(this.pointer.x, this.pointer.y) === part.uid,
      });
      label(ctx, r.x + r.w / 2, r.y + r.h + 24, `crush +${this.run.crushValue(part)}`, {
        font: FONT.ui(14),
        align: 'center',
        color: '#a89878',
      });
    });
    if (this.tray.length === 0)
      label(ctx, TRAY.x, TRAY.y + 60, 'Nothing left in the tray.', {
        font: FONT.ui(22),
        color: '#8a7a60',
      });

    this.cargo.draw(ctx, {
      selected: this.selected,
      hover: this.cargo.itemAt(this.pointer.x, this.pointer.y),
      highlight:
        dragging?.from === 'tray' && inRect(this.cargo.bounds, this.pointer.x, this.pointer.y),
    });

    // The crusher: a drop target.
    const overCrusher = !!dragging && inRect(CRUSHER, this.pointer.x, this.pointer.y);
    fillRound(
      ctx,
      CRUSHER.x,
      CRUSHER.y,
      CRUSHER.w,
      CRUSHER.h,
      14,
      overCrusher ? '#5a2a20' : '#2a1a16',
    );
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = overCrusher ? '#ff8a6a' : '#6a3a2a';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, CRUSHER.x + CRUSHER.w / 2, CRUSHER.y + 54, 'CRUSHER', {
      font: FONT.ui(26, 800),
      align: 'center',
      color: '#d08a6a',
    });
    label(
      ctx,
      CRUSHER.x + CRUSHER.w / 2,
      CRUSHER.y + 86,
      'Drop a part here to crush it into Aether',
      { font: FONT.ui(15), align: 'center', color: '#a87a6a' },
    );

    const ui = stage.ctx('ui');
    for (const b of this.buttons) b.draw(ui, this.pointer);
    const part = this.selectedPart();
    if (part) {
      const def = this.registry.get(part.defId);
      panel(ui, 600, 640, 640, {
        title: `${def.name} (${this.registry.kindOf(part.defId)}, ${def.tier})`,
        lines: [
          partSummary(this.registry, part),
          ...(def.text && this.registry.kindOf(part.defId) !== 'mod' ? [def.text] : []),
          `Crushes for ${this.run.crushValue(part)} Aether.`,
        ],
      });
    }
    label(
      ui,
      LOGICAL_WIDTH / 2,
      1060,
      'Drag parts into the Cargo Hold or onto the Crusher · click to select · T take · C crush · Enter continue',
      {
        font: FONT.ui(16),
        align: 'center',
        color: '#7a6a55',
      },
    );
    if (this.message && this.message.until > this.time) {
      label(ui, 120, 720, this.message.text, { font: FONT.ui(20, 600), color: this.message.color });
    }
    if (dragging) {
      const p = [...this.tray, ...this.run.state.cargo.items].find((q) => q.uid === dragging.uid);
      if (p)
        drawPart(ui, this.registry, p, this.pointer.x - PART_W / 2, this.pointer.y - PART_H / 2, {
          selected: true,
        });
    }
    this.fx.render(stage.ctx('fx'));
  }
}
