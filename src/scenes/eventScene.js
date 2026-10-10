// @ts-check
/**
 * Anomalies (events): a short scene, a few choices with stakes, a result.
 * Choices that need a part from Cargo switch to a part picker.
 */
import { RunError } from '../game/run/run.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, fillRound, inRect, label, wrapText } from '../render/draw.js';
import { CargoGrid } from '../ui/cargoGrid.js';
import { drawRunHeader } from './runHud.js';

/** Choices that consume a Cargo part chosen by the player. */
const NEEDS_PART = new Set(['ev_hungry_servitor:feed', 'ev_conveyor_lottery:swap']);
const TEXT_X = 160;
const TEXT_W = 1100;

export class EventScene {
  /**
   * @param {object} opts
   * @param {import('../game/run/run.js').Run} opts.run
   * @param {() => void} opts.onChange
   * @param {() => void} opts.onDone  Called when the event is over (route by the run's phase).
   */
  constructor({ run, onChange, onDone }) {
    this.run = run;
    this.registry = run.registry;
    this.onChange = onChange;
    this.onDone = onDone;
    this.time = 0;
    this.pointer = { x: 0, y: 0 };
    /** @type {string | null} choice waiting for a Cargo part */ this.picking = null;
    /** @type {string | null} */ this.error = null;
    this.cargo = new CargoGrid({
      registry: this.registry,
      cargo: () => this.run.state.cargo,
      x: 1500,
      y: 150,
    });
  }

  get def() {
    return this.registry.get(
      /** @type {NonNullable<typeof this.run.state.event>} */ (this.run.state.event).id,
    );
  }

  /** @param {number} i */
  choiceRect(i) {
    return { x: TEXT_X, y: 470 + i * 110, w: TEXT_W, h: 92 };
  }

  continueRect() {
    return { x: TEXT_X, y: 640, w: 360, h: 70 };
  }

  /**
   * @param {string} choiceId
   * @param {string} [cargoUid]
   */
  choose(choiceId, cargoUid) {
    try {
      this.run.chooseEvent(choiceId, { cargoUid });
      this.picking = null;
      this.onChange();
      // Some choices lead straight elsewhere (the Rogue Workbench).
      if (this.run.state.phase !== 'event') this.onDone();
    } catch (err) {
      if (!(err instanceof RunError)) throw err;
      this.error = err.message;
    }
  }

  leave() {
    this.run.leaveEvent();
    this.onChange();
    this.onDone();
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
  }

  /** @param {import('./sceneManager.js').InputEvent} event */
  onInput(event) {
    if (event.x !== undefined && event.y !== undefined) this.pointer = { x: event.x, y: event.y };
    const ev = this.run.state.event;
    if (!ev) return;
    const { x, y } = this.pointer;
    if (event.type === 'keydown') {
      if (ev.result !== null && (event.key === 'Enter' || event.key === ' ')) this.leave();
      else if (event.key === 'Escape') this.picking = null;
      else if (ev.result === null && !this.picking && /^[1-9]$/.test(event.key ?? '')) {
        const choice = this.def.choices[Number(event.key) - 1];
        if (choice) this.click(choice.id);
      }
      return;
    }
    if (event.type !== 'pointerdown' || event.button !== 0) return;
    if (ev.result !== null) {
      if (inRect(this.continueRect(), x, y)) this.leave();
      return;
    }
    if (this.picking) {
      const uid = this.cargo.itemAt(x, y);
      if (uid) this.choose(this.picking, uid);
      return;
    }
    const i = this.def.choices.findIndex((/** @type {any} */ _c, /** @type {number} */ j) =>
      inRect(this.choiceRect(j), x, y),
    );
    if (i >= 0) this.click(this.def.choices[i].id);
  }

  /** @param {string} choiceId */
  click(choiceId) {
    const blocked = this.run.eventChoiceBlocked(choiceId);
    if (blocked) {
      this.error = blocked;
      return;
    }
    if (NEEDS_PART.has(`${this.def.id}:${choiceId}`)) {
      this.picking = choiceId;
      this.error = null;
      return;
    }
    this.choose(choiceId);
  }

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    const bg = stage.ctx('bg');
    bg.fillStyle = '#120e14';
    bg.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    for (const layer of /** @type {const} */ (['world', 'hand', 'fx', 'ui'])) stage.clear(layer);
    const ctx = stage.ctx('world');
    drawRunHeader(ctx, this.run, 'Anomaly');
    const ev = this.run.state.event;
    if (!ev) return;
    const def = this.def;
    label(ctx, TEXT_X, 230, def.name, { font: FONT.title(52), color: '#e0c8ff' });
    ctx.font = FONT.ui(22);
    wrapText(ctx, def.text, TEXT_W).forEach((line, i) =>
      label(ctx, TEXT_X, 300 + i * 32, line, { font: FONT.ui(22), color: '#d8cce8' }),
    );

    if (ev.result !== null) {
      ctx.font = FONT.ui(22, 600);
      wrapText(ctx, ev.result, TEXT_W).forEach((line, i) =>
        label(ctx, TEXT_X, 470 + i * 32, line, { font: FONT.ui(22, 600), color: '#ffd27a' }),
      );
      const r = this.continueRect();
      fillRound(
        ctx,
        r.x,
        r.y,
        r.w,
        r.h,
        12,
        inRect(r, this.pointer.x, this.pointer.y) ? '#5a4a1a' : '#4a3a1a',
      );
      ctx.strokeStyle = '#ffd27a';
      ctx.lineWidth = 2;
      ctx.stroke();
      label(ctx, r.x + r.w / 2, r.y + 44, 'Continue [Enter]', {
        font: FONT.ui(22, 700),
        align: 'center',
      });
    } else if (this.picking) {
      label(ctx, TEXT_X, 490, 'Choose a part from your Cargo Hold (Esc to go back).', {
        font: FONT.ui(24, 700),
        color: '#ffd27a',
      });
      this.cargo.draw(ctx, {
        hover: this.cargo.itemAt(this.pointer.x, this.pointer.y),
        highlight: true,
      });
    } else {
      def.choices.forEach((/** @type {any} */ choice, /** @type {number} */ i) => {
        const r = this.choiceRect(i);
        const blocked = this.run.eventChoiceBlocked(choice.id);
        const hover = !blocked && inRect(r, this.pointer.x, this.pointer.y);
        fillRound(ctx, r.x, r.y, r.w, r.h, 12, blocked ? '#1a161c' : hover ? '#3a2a4a' : '#261e2e');
        ctx.strokeStyle = blocked ? '#3a3040' : hover ? '#e0c8ff' : '#6a5080';
        ctx.lineWidth = 2;
        ctx.stroke();
        label(ctx, r.x + 20, r.y + 36, `${i + 1}. ${choice.label}`, {
          font: FONT.ui(22, 700),
          color: blocked ? '#6a6070' : '#f0e4ff',
        });
        label(ctx, r.x + 20, r.y + 68, blocked ? blocked : choice.text, {
          font: FONT.ui(17),
          color: blocked ? '#8a6070' : '#b8a8c8',
        });
      });
      this.cargo.draw(ctx, { hover: null });
    }
    if (this.error)
      label(stage.ctx('ui'), TEXT_X, 1020, this.error, {
        font: FONT.ui(19, 600),
        color: '#ff9a8a',
      });
  }
}
