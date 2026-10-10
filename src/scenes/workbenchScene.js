// @ts-check
/**
 * The Workbench (GDD §4.4): assemble cards from Cargo parts, swap parts on
 * existing cards, dismantle, tune, or spend the visit on a Field Repair.
 * The bench shows a live preview; nothing is committed until Weld.
 */
import { OVERCLOCK_LIMIT } from '../game/core/content.js';
import { deriveCard } from '../game/model/card.js';
import { FIELD_REPAIR_PCT } from '../game/run/economy.js';
import { RunError } from '../game/run/run.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { CARD_H, CARD_W, drawCard } from '../render/cardRenderer.js';
import { FONT, fillRound, inRect, label, panel, wrapText } from '../render/draw.js';
import { Fx } from '../render/fx.js';
import { PART_H, PART_W, drawPart, partSummary } from '../render/partRenderer.js';
import { Button } from '../ui/button.js';
import { CargoGrid } from '../ui/cargoGrid.js';
import { drawRunHeader } from './runHud.js';

/**
 * @typedef {import('../game/model/card.js').ComponentInstance} ComponentInstance
 * @typedef {'frame' | 'core' | 'mod'} Slot
 * @typedef {{ part: ComponentInstance | null, source: 'cargo' | 'card' | 'none', uid?: string }} SocketView
 */

const SLOTS = /** @type {const} */ (['frame', 'core', 'mod']);
const SOCKET_Y = 230;
/** @type {Record<Slot, { x: number, y: number, w: number, h: number }>} */
const SOCKETS = {
  frame: { x: 520, y: SOCKET_Y, w: PART_W, h: PART_H },
  core: { x: 720, y: SOCKET_Y, w: PART_W, h: PART_H },
  mod: { x: 920, y: SOCKET_Y, w: PART_W, h: PART_H },
};
const GAUGE = { x: 520, y: 372, w: 568, h: 26 };
const PREVIEW = { x: 540, y: 430, scale: 1.2 };
const DECK = { x: 40, y: 150, rowH: 34 };
const DOUBLE_CLICK = 0.35;

export class WorkbenchScene {
  /**
   * @param {object} opts
   * @param {import('../game/run/run.js').Run} opts.run
   * @param {() => void} opts.onChange  Called after every committed change (autosave).
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
    /** @type {string | null} card being edited, or null for a new card */ this.editing = null;
    /** @type {{ frame?: string, core?: string, mod?: string | null }} pending cargo uids per socket */ this.pending =
      {};
    /** @type {{ kind: 'cargo', uid: string } | { kind: 'socket', slot: Slot } | null} */ this.focus =
      null;
    /** @type {{ uid: string, start: { x: number, y: number } } | null} */ this.drag = null;
    /** @type {{ uid: string, at: number } | null} */ this.lastClick = null;
    /** @type {{ text: string, color: string, until: number } | null} */ this.message = null;
    this.leaveConfirmUntil = 0;
    this.bgVersion = -1;
    this.cargo = new CargoGrid({
      registry: this.registry,
      cargo: () => this.run.state.cargo,
      x: 1500,
      y: 150,
    });

    const focusPart = () => this.focusPart();
    this.buttons = [
      new Button({
        rect: { x: 520, y: 800, w: 250, h: 60 },
        label: () => `Weld (${this.weldCost()}) [Enter]`,
        enabled: () => this.canWeld(),
        keys: ['Enter'],
        style: 'primary',
        onClick: () => this.weld(),
      }),
      new Button({
        rect: { x: 790, y: 800, w: 150, h: 60 },
        label: 'Clear [Esc]',
        enabled: () => !!this.editing || Object.keys(this.pending).length > 0,
        keys: ['Escape'],
        onClick: () => this.clearBench(),
      }),
      new Button({
        rect: { x: 960, y: 800, w: 200, h: 60 },
        label: () => (this.pending.mod === null ? 'Keep Mod' : 'Remove Mod'),
        enabled: () =>
          !!this.editing &&
          !!this.run.card(this.editing).mod &&
          typeof this.pending.mod !== 'string',
        onClick: () => {
          if (this.pending.mod === null) delete this.pending.mod;
          else this.pending.mod = null;
        },
      }),
      new Button({
        rect: { x: 1180, y: 800, w: 260, h: 60 },
        label: 'Dismantle card (1)',
        enabled: () => !!this.editing && this.run.chargesLeft >= 1,
        style: 'danger',
        onClick: () => this.dismantle(),
      }),
      new Button({
        rect: { x: 520, y: 880, w: 200, h: 56 },
        label: 'Tune −1 wt (1) [T]',
        enabled: () => this.canTune(),
        keys: ['t', 'T'],
        onClick: () => this.tune(),
      }),
      new Button({
        rect: { x: 740, y: 880, w: 200, h: 56 },
        label: () => {
          const p = focusPart();
          return p && this.focus?.kind === 'cargo'
            ? `Crush +${this.run.crushValue(p)} [C]`
            : 'Crush [C]';
        },
        enabled: () => this.focus?.kind === 'cargo' && !this.isPending(this.focus.uid),
        keys: ['c', 'C'],
        style: 'danger',
        onClick: () => this.crush(),
      }),
      new Button({
        rect: { x: 960, y: 880, w: 260, h: 56 },
        label: () => `Field Repair +${this.repairAmount()} HP`,
        enabled: () =>
          this.run.state.workbench?.used === 0 && this.run.state.hp < this.run.state.maxHp,
        onClick: () =>
          this.attempt(() => {
            const { healed } = this.run.fieldRepair();
            this.say(`Field Repair: +${healed} HP. The Workbench is spent.`, '#7aff8a');
          }),
      }),
      new Button({
        rect: { x: 1240, y: 880, w: 200, h: 56 },
        label: () => (this.time < this.leaveConfirmUntil ? 'Leave anyway? [L]' : 'Leave [L]'),
        keys: ['l', 'L'],
        onClick: () => this.leave(),
      }),
    ];
  }

  // ---------------------------------------------------------------------------
  // Bench model
  // ---------------------------------------------------------------------------

  /** @param {string} uid */
  isPending(uid) {
    return Object.values(this.pending).includes(uid);
  }

  /**
   * What a socket currently shows.
   * @param {Slot} slot
   * @returns {SocketView}
   */
  socket(slot) {
    const value = this.pending[slot];
    if (typeof value === 'string') {
      const part = this.run.state.cargo.items.find((p) => p.uid === value) ?? null;
      return { part, source: part ? 'cargo' : 'none', uid: value };
    }
    if (value === null) return { part: null, source: 'none' };
    if (this.editing) {
      const part = this.run.card(this.editing)[slot] ?? null;
      return { part, source: part ? 'card' : 'none' };
    }
    return { part: null, source: 'none' };
  }

  /** The card the bench would produce, or null if a Frame or Core is missing. */
  candidate() {
    const frame = this.socket('frame').part;
    const core = this.socket('core').part;
    if (!frame || !core) return null;
    const mod = this.socket('mod').part;
    return {
      uid: this.editing ?? 'bench',
      frame: { ...frame, uid: undefined },
      core: { ...core, uid: undefined },
      ...(mod ? { mod: { ...mod, uid: undefined } } : {}),
    };
  }

  /** @returns {{ derived: import('../game/model/card.js').DerivedCard | null, error: string | null }} */
  validation() {
    const card = this.candidate();
    if (!card)
      return {
        derived: null,
        error: this.editing ? null : 'Socket a Frame and a Core to build a card.',
      };
    try {
      return { derived: this.run.checkCard(card), error: null };
    } catch (err) {
      if (!(err instanceof RunError)) throw err;
      return { derived: deriveCard(card, { registry: this.registry }), error: err.message };
    }
  }

  changedSlots() {
    return SLOTS.filter((slot) => this.pending[slot] !== undefined);
  }

  weldCost() {
    return this.editing ? Math.max(1, this.changedSlots().length) : 1;
  }

  canWeld() {
    if (this.run.state.phase !== 'workbench') return false;
    if (this.editing && this.changedSlots().length === 0) return false;
    const { derived, error } = this.validation();
    return !!derived && !error && this.run.chargesLeft >= this.weldCost();
  }

  repairAmount() {
    const s = this.run.state;
    return Math.min(Math.floor((s.maxHp * FIELD_REPAIR_PCT) / 100), s.maxHp - s.hp);
  }

  /** The part the Tune/Crush buttons act on. */
  focusPart() {
    const f = this.focus;
    if (!f) return null;
    if (f.kind === 'cargo') return this.run.state.cargo.items.find((p) => p.uid === f.uid) ?? null;
    return this.socket(f.slot).part;
  }

  canTune() {
    const part = this.focusPart();
    if (!part || part.tuned || this.run.chargesLeft < 1) return false;
    const kind = this.registry.kindOf(part.defId);
    if (kind !== 'core' && kind !== 'mod') return false;
    if (this.focus?.kind === 'socket' && this.socket(this.focus.slot).source !== 'card')
      return false;
    return this.registry.get(part.defId).weight > 0;
  }

  /** Drop pending references to parts that no longer exist in Cargo. */
  prune() {
    for (const slot of SLOTS) {
      const uid = this.pending[slot];
      if (typeof uid === 'string' && !this.run.state.cargo.items.some((p) => p.uid === uid))
        delete this.pending[slot];
    }
    if (this.editing && !this.run.state.deck.some((c) => c.uid === this.editing))
      this.editing = null;
    if (this.focus?.kind === 'cargo' && !this.focusPart()) this.focus = null;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * @param {string} text
   * @param {string} [color]
   */
  say(text, color = '#e8d6b0') {
    this.message = { text, color, until: this.time + 3.2 };
  }

  /** @param {() => void} fn */
  attempt(fn) {
    try {
      fn();
      this.prune();
      this.onChange();
      return true;
    } catch (err) {
      if (!(err instanceof RunError)) throw err;
      this.say(err.message, '#ff9a8a');
      return false;
    }
  }

  /**
   * Puts a Cargo part into the socket matching its kind.
   * @param {string} uid
   * @param {Slot} [into] the socket it was dropped on, if any
   */
  place(uid, into) {
    const part = this.run.state.cargo.items.find((p) => p.uid === uid);
    if (!part) return;
    const kind = /** @type {Slot} */ (this.registry.kindOf(part.defId));
    if (into && into !== kind) {
      this.say(`${this.registry.get(part.defId).name} goes in the ${kind} socket.`, '#ff9a8a');
      return;
    }
    this.pending[kind] = uid;
    this.focus = { kind: 'cargo', uid };
  }

  clearBench() {
    this.editing = null;
    this.pending = {};
    this.focus = null;
  }

  /** @param {string} uid */
  editCard(uid) {
    if (this.editing === uid) {
      this.clearBench();
      return;
    }
    this.editing = uid;
    this.pending = {};
    this.focus = null;
  }

  weld() {
    if (!this.canWeld()) return;
    const editing = this.editing;
    this.attempt(() => {
      if (editing) {
        /** @type {{ frame?: string, core?: string, mod?: string | null }} */
        const changes = {};
        for (const slot of this.changedSlots())
          /** @type {any} */ (changes)[slot] = this.pending[slot];
        const { derived, stowed } = this.run.modify(editing, changes);
        this.pending = {};
        const crushed = stowed.filter((s) => !s.toCargo);
        this.say(
          `Welded ${derived.name}.${crushed.length ? ` ${crushed.map((s) => this.registry.get(s.defId).name).join(', ')} crushed (+${crushed.reduce((n, s) => n + s.aether, 0)} Aether).` : ''}`,
          '#ffd27a',
        );
      } else {
        const { derived } = this.run.assemble({
          frame: /** @type {string} */ (this.pending.frame),
          core: /** @type {string} */ (this.pending.core),
          mod: typeof this.pending.mod === 'string' ? this.pending.mod : null,
        });
        this.clearBench();
        this.say(
          `Welded a new card: ${derived.name}${derived.overclock ? ' (Overclocked)' : ''}.`,
          '#ffd27a',
        );
      }
      this.fx.sparks(PREVIEW.x + (CARD_W * PREVIEW.scale) / 2, PREVIEW.y + 120, 70);
      this.fx.shake(0.25);
    });
  }

  dismantle() {
    const uid = this.editing;
    if (!uid) return;
    this.attempt(() => {
      const name = deriveCard(this.run.card(uid), { registry: this.registry }).name;
      const { stowed } = this.run.dismantle(uid);
      this.clearBench();
      const aether = stowed.reduce((n, s) => n + s.aether, 0);
      this.say(
        `Dismantled ${name}: ${stowed.filter((s) => s.toCargo).length} part(s) to Cargo${aether ? `, +${aether} Aether from crushed parts` : ''}.`,
        '#ffd27a',
      );
    });
  }

  tune() {
    const f = this.focus;
    if (!f || !this.canTune()) return;
    this.attempt(() => {
      if (f.kind === 'cargo') this.run.tune({ cargoUid: f.uid });
      else
        this.run.tune({
          cardUid: /** @type {string} */ (this.editing),
          slot: /** @type {'core' | 'mod'} */ (f.slot),
        });
      this.say('Tuned: weight −1.', '#9fe0ff');
    });
  }

  crush() {
    const f = this.focus;
    if (f?.kind !== 'cargo' || this.isPending(f.uid)) return;
    this.attempt(() => {
      const name = this.registry.get(
        /** @type {ComponentInstance} */ (this.focusPart()).defId,
      ).name;
      const value = this.run.crush(f.uid);
      this.focus = null;
      this.say(`${name} crushed for ${value} Aether.`, '#ffd27a');
    });
  }

  leave() {
    const unsaved =
      this.changedSlots().length > 0 || (!this.editing && Object.keys(this.pending).length > 0);
    if ((unsaved || this.run.chargesLeft > 0) && this.time >= this.leaveConfirmUntil) {
      this.leaveConfirmUntil = this.time + 2.5;
      this.say(
        unsaved
          ? 'The bench has unwelded changes. Press L again to leave anyway.'
          : `You still have ${this.run.chargesLeft} Tool Charge(s). Press L again to leave.`,
        '#ffb070',
      );
      return;
    }
    if (this.attempt(() => this.run.leaveWorkbench())) this.onDone();
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  /**
   * @param {number} x
   * @param {number} y
   */
  deckRowAt(x, y) {
    const i = Math.floor((y - DECK.y - 40) / DECK.rowH);
    if (x < DECK.x || x > DECK.x + 380 || i < 0 || i >= this.run.state.deck.length) return null;
    return this.run.state.deck[i].uid;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Slot | null}
   */
  socketAt(x, y) {
    return SLOTS.find((slot) => inRect(SOCKETS[slot], x, y)) ?? null;
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
    if (event.type === 'keydown') {
      for (const b of this.buttons) if (b.key(/** @type {string} */ (event.key))) return;
      return;
    }
    if (event.type === 'pointerdown' && event.button === 0) {
      for (const b of this.buttons) if (b.click(x, y)) return;
      const cargoUid = this.cargo.itemAt(x, y);
      if (cargoUid) {
        const double =
          this.lastClick?.uid === cargoUid && this.time - this.lastClick.at < DOUBLE_CLICK;
        this.lastClick = { uid: cargoUid, at: this.time };
        this.focus = { kind: 'cargo', uid: cargoUid };
        if (double) this.place(cargoUid);
        else this.drag = { uid: cargoUid, start: { x, y } };
        return;
      }
      const slot = this.socketAt(x, y);
      if (slot) {
        const view = this.socket(slot);
        if (view.source === 'cargo') {
          delete this.pending[slot]; // send it back to Cargo
          this.focus = null;
        } else {
          this.focus = { kind: 'socket', slot };
        }
        return;
      }
      const row = this.deckRowAt(x, y);
      if (row) {
        this.editCard(row);
        return;
      }
      this.focus = null;
    } else if (event.type === 'pointerup' && event.button === 0 && this.drag) {
      const { uid, start } = this.drag;
      this.drag = null;
      if (Math.hypot(x - start.x, y - start.y) < 20) return;
      const slot = this.socketAt(x, y);
      if (slot) this.place(uid, slot);
      else if (inRect({ x: 480, y: 200, w: 640, h: 560 }, x, y)) this.place(uid);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    if (this.bgVersion !== stage.resizeVersion) {
      this.bgVersion = stage.resizeVersion;
      const bg = stage.ctx('bg');
      const g = bg.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
      g.addColorStop(0, '#201a12');
      g.addColorStop(1, '#0d0a08');
      bg.fillStyle = g;
      bg.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    }
    for (const layer of /** @type {const} */ (['world', 'hand', 'fx', 'ui'])) stage.clear(layer);
    const ctx = stage.ctx('world');
    const shake = this.fx.shakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);
    drawRunHeader(ctx, this.run, 'Workbench');
    this.renderDeck(ctx);
    this.renderBench(ctx);
    const pendingUids = new Set(Object.values(this.pending).filter((v) => typeof v === 'string'));
    /** @type {Record<string, string>} */
    const badges = {};
    for (const uid of pendingUids) badges[/** @type {string} */ (uid)] = 'ON BENCH';
    this.cargo.draw(ctx, {
      selected: this.focus?.kind === 'cargo' ? this.focus.uid : null,
      hover: this.cargo.itemAt(this.pointer.x, this.pointer.y),
      dim: /** @type {Set<string>} */ (pendingUids),
      badges,
    });
    ctx.restore();

    const ui = stage.ctx('ui');
    for (const b of this.buttons) b.draw(ui, this.pointer);
    if (this.message && this.message.until > this.time) {
      label(ui, 520, 985, this.message.text, { font: FONT.ui(20, 600), color: this.message.color });
    }
    label(
      ui,
      LOGICAL_WIDTH / 2,
      1060,
      'Click a deck card to edit it · double-click or drag Cargo parts onto the bench · click a socketed part to send it back',
      {
        font: FONT.ui(16),
        align: 'center',
        color: '#7a6a55',
      },
    );
    this.renderInspector(ui);
    const hoverRow = this.deckRowAt(this.pointer.x, this.pointer.y);
    if (hoverRow && hoverRow !== this.editing && !this.drag) {
      const card = this.run.card(hoverRow);
      const d = deriveCard(card, { registry: this.registry });
      const y = Math.min(Math.max(120, this.pointer.y - CARD_H / 2), LOGICAL_HEIGHT - CARD_H - 20);
      drawCard(
        ui,
        {
          kind: 'card',
          derived: d,
          affordable: true,
          parts: {
            mod: card.mod?.defId ?? null,
            modName: card.mod ? this.registry.get(card.mod.defId).name : null,
          },
        },
        440,
        y,
        1,
      );
    }
    if (
      this.drag &&
      Math.hypot(this.pointer.x - this.drag.start.x, this.pointer.y - this.drag.start.y) >= 20
    ) {
      const part = this.run.state.cargo.items.find((p) => p.uid === this.drag?.uid);
      if (part)
        drawPart(
          ui,
          this.registry,
          part,
          this.pointer.x - PART_W / 2,
          this.pointer.y - PART_H / 2,
          { selected: true },
        );
    }
    this.fx.render(stage.ctx('fx'));
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderDeck(ctx) {
    const deck = this.run.state.deck;
    label(ctx, DECK.x, DECK.y + 28, `Deck (${deck.length})`, { font: FONT.ui(20, 700) });
    const hover = this.deckRowAt(this.pointer.x, this.pointer.y);
    deck.forEach((card, i) => {
      const y = DECK.y + 40 + i * DECK.rowH;
      const d = deriveCard(card, { registry: this.registry });
      const active = card.uid === this.editing;
      fillRound(
        ctx,
        DECK.x,
        y,
        380,
        DECK.rowH - 4,
        6,
        active ? '#5a4520' : card.uid === hover ? '#3a2e1c' : 'rgba(40, 32, 24, 0.6)',
      );
      label(ctx, DECK.x + 12, y + 21, String(d.cost), { font: FONT.ui(16, 800), color: '#9fe0ff' });
      label(ctx, DECK.x + 34, y + 21, d.name, {
        font: FONT.ui(15, 600),
        color: d.overclock ? '#ffb070' : '#e8d6b0',
      });
      if (card.mod) {
        label(ctx, DECK.x + 370, y + 21, this.registry.get(card.mod.defId).name, {
          font: FONT.ui(12),
          align: 'right',
          color: '#d8b070',
        });
      }
    });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderBench(ctx) {
    const wb = this.run.state.workbench;
    const charges = wb ? wb.charges : 0;
    label(
      ctx,
      520,
      170,
      this.editing
        ? `Editing: ${deriveCard(this.run.card(this.editing), { registry: this.registry }).name}`
        : 'New card',
      {
        font: FONT.title(28),
      },
    );
    // Tool charge pips.
    label(ctx, 1110, 170, 'Tool Charges', { font: FONT.ui(16, 600), color: '#a89878' });
    for (let i = 0; i < charges; i++) {
      ctx.beginPath();
      ctx.arc(1250 + i * 30, 164, 11, 0, Math.PI * 2);
      ctx.fillStyle = i < this.run.chargesLeft ? '#ffd27a' : '#3a3024';
      ctx.fill();
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (wb?.repaired)
      label(ctx, 1110, 196, 'Spent on Field Repair', { font: FONT.ui(15), color: '#7aff8a' });

    for (const slot of SLOTS) {
      const r = SOCKETS[slot];
      const view = this.socket(slot);
      label(ctx, r.x, r.y - 10, slot === 'mod' ? 'MOD (optional)' : slot.toUpperCase(), {
        font: FONT.mono(13),
        color: '#a89878',
      });
      const focused = this.focus?.kind === 'socket' && this.focus.slot === slot;
      if (view.part) {
        drawPart(ctx, this.registry, view.part, r.x, r.y, {
          selected: focused,
          hover: inRect(r, this.pointer.x, this.pointer.y),
          badge: view.source === 'cargo' ? (this.editing ? 'NEW' : '') : '',
        });
      } else {
        fillRound(ctx, r.x, r.y, r.w, r.h, 10, 'rgba(0, 0, 0, 0.35)');
        ctx.setLineDash([8, 6]);
        ctx.strokeStyle = this.pending[slot] === null ? '#ff8a6a' : '#8a6a3a';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
        label(
          ctx,
          r.x + r.w / 2,
          r.y + r.h / 2 + 6,
          this.pending[slot] === null ? 'removing' : 'empty',
          {
            font: FONT.ui(15),
            align: 'center',
            color: '#7a6a55',
          },
        );
      }
    }

    const { derived, error } = this.validation();
    if (derived) {
      this.renderGauge(ctx, derived.weight, derived.capacity);
      drawCard(
        ctx,
        {
          kind: 'card',
          derived,
          affordable: true,
          parts: {
            mod: this.socket('mod').part?.defId ?? null,
            modName: this.socket('mod').part
              ? this.registry.get(/** @type {ComponentInstance} */ (this.socket('mod').part).defId)
                  .name
              : null,
          },
        },
        PREVIEW.x,
        PREVIEW.y,
        PREVIEW.scale,
      );
    } else {
      fillRound(
        ctx,
        PREVIEW.x,
        PREVIEW.y,
        CARD_W * PREVIEW.scale,
        CARD_H * PREVIEW.scale,
        14,
        'rgba(0, 0, 0, 0.3)',
      );
      label(ctx, PREVIEW.x + (CARD_W * PREVIEW.scale) / 2, PREVIEW.y + 170, 'preview', {
        font: FONT.ui(18),
        align: 'center',
        color: '#5a4a38',
      });
    }

    // Status lines next to the preview.
    const lx = 820;
    let ly = 470;
    const line = (/** @type {string} */ text, /** @type {string} */ color) => {
      ctx.font = FONT.ui(16, 600);
      for (const row of wrapText(ctx, text, 270)) {
        label(ctx, lx, ly, row, { font: FONT.ui(16, 600), color });
        ly += 22;
      }
      ly += 8;
    };
    if (error) line(error, '#ff9a8a');
    else if (derived?.overclock)
      line(`Overclocked +${derived.overclock}: Exhausts after each use in combat.`, '#ffb070');
    else if (derived) line('Stable: within capacity.', '#a8c890');
    if (this.editing) {
      const changes = this.changedSlots();
      line(
        changes.length
          ? `${changes.length} change(s): ${changes.join(', ')}`
          : 'No changes yet: drop parts onto sockets to swap.',
        '#cbbd9e',
      );
      const removing = changes
        .map((slot) => this.run.card(/** @type {string} */ (this.editing))[slot])
        .filter((p) => p !== undefined);
      for (const p of removing) {
        line(
          p.rusted
            ? `${this.registry.get(p.defId).name} is Rusted: crushed for 5 Aether.`
            : `${this.registry.get(p.defId).name} returns to Cargo.`,
          '#a89878',
        );
      }
    }
    line(`Overclock limit: +${OVERCLOCK_LIMIT} weight over capacity.`, '#7a6a55');
  }

  /**
   * Weight vs. capacity, with the Overclock zone (GDD §2.3).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} weight
   * @param {number} capacity
   */
  renderGauge(ctx, weight, capacity) {
    const units = Math.max(capacity + OVERCLOCK_LIMIT, weight, 1);
    const u = GAUGE.w / units;
    fillRound(ctx, GAUGE.x, GAUGE.y, GAUGE.w, GAUGE.h, 6, '#1a1410');
    ctx.fillStyle = 'rgba(120, 180, 100, 0.25)';
    ctx.fillRect(GAUGE.x, GAUGE.y, capacity * u, GAUGE.h);
    ctx.fillStyle = 'rgba(240, 160, 32, 0.22)';
    ctx.fillRect(GAUGE.x + capacity * u, GAUGE.y, OVERCLOCK_LIMIT * u, GAUGE.h);
    const over = weight - capacity;
    ctx.fillStyle = over > OVERCLOCK_LIMIT ? '#d0402a' : over > 0 ? '#f0a020' : '#7ab060';
    ctx.fillRect(GAUGE.x + 2, GAUGE.y + 5, Math.max(0, weight * u - 4), GAUGE.h - 10);
    for (let i = 1; i < units; i++) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(GAUGE.x + i * u - 1, GAUGE.y, 2, GAUGE.h);
    }
    label(ctx, GAUGE.x, GAUGE.y - 8, `Weight ${weight} / Capacity ${capacity}`, {
      font: FONT.ui(15, 600),
      color: '#cbbd9e',
    });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderInspector(ctx) {
    const part = this.focusPart();
    if (!part) return;
    const def = this.registry.get(part.defId);
    const kind = this.registry.kindOf(part.defId);
    panel(ctx, 1110, 430, 360, {
      title: def.name,
      lines: [
        {
          text: `${kind} · ${def.tier}${part.tuned ? ' · tuned' : ''}${part.rusted ? ' · Rusted' : ''}`,
          color: '#a89878',
        },
        partSummary(this.registry, part),
        ...(def.text && kind !== 'mod' ? [def.text] : []),
        {
          text: part.rusted
            ? 'Rusted: crushes for 5 and never returns to Cargo.'
            : `Crush value: ${this.run.crushValue(part)} Aether`,
          color: '#a89878',
        },
      ],
    });
  }
}
