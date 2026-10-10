// @ts-check
/**
 * The Smelter (GDD §4.5): spend Aether on parts, Frame Capacity, Fusion,
 * or removing a card from the deck.
 */
import { deriveCard } from '../game/model/card.js';
import { RunError } from '../game/run/run.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, fillRound, inRect, label, wrapText } from '../render/draw.js';
import { PART_H, PART_W, drawPart } from '../render/partRenderer.js';
import { Button } from '../ui/button.js';
import { CargoGrid } from '../ui/cargoGrid.js';
import { drawRunHeader } from './runHud.js';

const DECK = { x: 40, y: 150, rowH: 34 };
const OFFERS = { x: 470, y: 190 };
const OFFER_GAP = 26;

export class SmelterScene {
  /**
   * @param {object} opts
   * @param {import('../game/run/run.js').Run} opts.run
   * @param {() => void} opts.onChange
   * @param {() => void} opts.onDone
   */
  constructor({ run, onChange, onDone }) {
    this.run = run;
    this.registry = run.registry;
    this.onChange = onChange;
    this.onDone = onDone;
    this.time = 0;
    this.pointer = { x: 0, y: 0 };
    /** @type {string | null} selected deck card */ this.card = null;
    /** @type {string[]} selected Cargo parts (up to 3, for Fusion) */ this.parts = [];
    /** @type {{ text: string, color: string, until: number } | null} */ this.message = null;
    this.cargo = new CargoGrid({
      registry: this.registry,
      cargo: () => this.run.state.cargo,
      x: 1500,
      y: 150,
    });

    const selectedFrame = () => this.selectedFrame();
    this.buttons = [
      new Button({
        rect: { x: 470, y: 690, w: 300, h: 56 },
        label: () => `Upgrade Capacity · ◆${this.run.capacityUpgradeCost()}`,
        enabled: () => !!selectedFrame(),
        onClick: () =>
          this.attempt(() => {
            const target = /** @type {any} */ (selectedFrame());
            this.run.upgradeCapacity(target);
            this.say('Frame Capacity +1.', '#ffd27a');
          }),
      }),
      new Button({
        rect: { x: 790, y: 690, w: 280, h: 56 },
        label: () => `Remove card · ◆${this.run.removalCost()}`,
        enabled: () => !!this.card,
        style: 'danger',
        onClick: () =>
          this.attempt(() => {
            const name = deriveCard(this.run.card(/** @type {string} */ (this.card)), {
              registry: this.registry,
            }).name;
            this.run.removeCard(/** @type {string} */ (this.card));
            this.card = null;
            this.say(`${name} removed from your deck for good.`, '#ffd27a');
          }),
      }),
      .../** @type {const} */ (['frame', 'core', 'mod']).map(
        (kind, i) =>
          new Button({
            rect: { x: 470 + i * 205, y: 830, w: 190, h: 52 },
            label: () => `Fuse → ${kind[0].toUpperCase()}${kind.slice(1)}`,
            enabled: () => this.parts.length === 3,
            onClick: () =>
              this.attempt(() => {
                const { part } = this.run.fuse(this.parts, kind);
                this.parts = [];
                this.say(`Fusion produced ${this.registry.get(part.defId).name}.`, '#d08aff');
              }),
          }),
      ),
      new Button({
        rect: { x: 1500, y: 940, w: 360, h: 70 },
        label: 'Leave the Smelter [Enter]',
        keys: ['Enter'],
        style: 'primary',
        onClick: () => {
          this.attempt(() => this.run.leaveSmelter());
          this.onDone();
        },
      }),
    ];
  }

  get offers() {
    return this.run.state.smelter?.offers ?? [];
  }

  /** The Frame a Capacity Upgrade would target: the selected deck card's, or one selected Cargo Frame. */
  selectedFrame() {
    if (this.card) return { cardUid: this.card };
    if (
      this.parts.length === 1 &&
      this.registry.kindOf(this.run.cargoItem(this.parts[0]).defId) === 'frame'
    ) {
      return { cargoUid: this.parts[0] };
    }
    return null;
  }

  /**
   * @param {string} text
   * @param {string} [color]
   */
  say(text, color = '#e8d6b0') {
    this.message = { text, color, until: this.time + 3 };
  }

  /** @param {() => void} fn */
  attempt(fn) {
    try {
      fn();
      this.parts = this.parts.filter((uid) =>
        this.run.state.cargo.items.some((p) => p.uid === uid),
      );
      this.onChange();
    } catch (err) {
      if (!(err instanceof RunError)) throw err;
      this.say(err.message, '#ff9a8a');
    }
  }

  /** @param {number} i */
  offerRect(i) {
    return {
      x: OFFERS.x + (i % 3) * (PART_W + OFFER_GAP),
      y: OFFERS.y + Math.floor(i / 3) * (PART_H + 64),
      w: PART_W,
      h: PART_H,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  deckRowAt(x, y) {
    const i = Math.floor((y - DECK.y - 40) / DECK.rowH);
    if (x < DECK.x || x > DECK.x + 380 || i < 0 || i >= this.run.state.deck.length) return null;
    return this.run.state.deck[i].uid;
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
  }

  /** @param {import('./sceneManager.js').InputEvent} event */
  onInput(event) {
    if (event.x !== undefined && event.y !== undefined) this.pointer = { x: event.x, y: event.y };
    const { x, y } = this.pointer;
    if (event.type === 'keydown') {
      for (const b of this.buttons) if (b.key(/** @type {string} */ (event.key))) return;
      return;
    }
    if (event.type !== 'pointerdown' || event.button !== 0) return;
    for (const b of this.buttons) if (b.click(x, y)) return;
    const offerIndex = this.offers.findIndex((_, i) => inRect(this.offerRect(i), x, y));
    if (offerIndex >= 0) {
      const offer = this.offers[offerIndex];
      this.attempt(() => {
        const { cost } = this.run.buy(offer.uid);
        this.say(`Bought ${this.registry.get(offer.defId).name} for ◆${cost}.`, '#ffd27a');
      });
      return;
    }
    const part = this.cargo.itemAt(x, y);
    if (part) {
      this.card = null;
      if (this.parts.includes(part)) this.parts = this.parts.filter((p) => p !== part);
      else if (this.parts.length < 3) this.parts.push(part);
      return;
    }
    const row = this.deckRowAt(x, y);
    if (row) {
      this.parts = [];
      this.card = this.card === row ? null : row;
      return;
    }
    this.card = null;
    this.parts = [];
  }

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    const bg = stage.ctx('bg');
    bg.fillStyle = '#0f1216';
    bg.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    for (const layer of /** @type {const} */ (['world', 'hand', 'fx', 'ui'])) stage.clear(layer);
    const ctx = stage.ctx('world');
    drawRunHeader(ctx, this.run, 'Smelter');

    // Deck list (select a card to upgrade its Frame or remove it).
    const deck = this.run.state.deck;
    label(ctx, DECK.x, DECK.y + 28, `Deck (${deck.length})`, { font: FONT.ui(20, 700) });
    deck.forEach((card, i) => {
      const yy = DECK.y + 40 + i * DECK.rowH;
      const d = deriveCard(card, { registry: this.registry });
      const active = card.uid === this.card;
      fillRound(
        ctx,
        DECK.x,
        yy,
        380,
        DECK.rowH - 4,
        6,
        active ? '#2a4a5a' : 'rgba(40, 32, 24, 0.6)',
      );
      label(ctx, DECK.x + 12, yy + 21, d.name, { font: FONT.ui(15, 600) });
      label(
        ctx,
        DECK.x + 370,
        yy + 21,
        `cap ${d.capacity}${card.frame.capacityBonus ? ` (+${card.frame.capacityBonus})` : ''}`,
        {
          font: FONT.mono(12),
          align: 'right',
          color: '#7ad0ff',
        },
      );
    });

    // Offers.
    label(ctx, OFFERS.x, OFFERS.y - 20, 'For sale (click to buy)', {
      font: FONT.ui(22, 700),
      color: '#7ad0ff',
    });
    this.offers.forEach((o, i) => {
      const r = this.offerRect(i);
      const price = this.run.smelterPrice(o.price);
      drawPart(ctx, this.registry, { defId: o.defId }, r.x, r.y, {
        dim: o.sold,
        hover: !o.sold && inRect(r, this.pointer.x, this.pointer.y),
        badge: o.sold ? 'SOLD' : o.sale ? 'SALE' : '',
      });
      label(ctx, r.x + r.w / 2, r.y + r.h + 26, o.sold ? 'sold' : `◆ ${price}`, {
        font: FONT.ui(18, 700),
        align: 'center',
        color: o.sold ? '#5a5040' : price > this.run.state.aether ? '#ff7a6a' : '#ffd27a',
      });
    });

    // Services.
    label(ctx, 470, 660, 'Services', { font: FONT.ui(22, 700), color: '#7ad0ff' });
    label(
      ctx,
      470,
      800,
      `Fusion · ◆${this.run.fusionCost()}: select three same-tier parts in Cargo, then choose what to make (next tier up)`,
      {
        font: FONT.ui(15),
        color: '#a8c0d0',
      },
    );
    this.cargo.draw(ctx, {
      selected: null,
      hover: this.cargo.itemAt(this.pointer.x, this.pointer.y),
      badges: Object.fromEntries(this.parts.map((uid, i) => [uid, `SELECTED ${i + 1}`])),
    });
    // Outline selected Cargo parts.
    this.run.state.cargo.items.forEach((p, i) => {
      if (!this.parts.includes(/** @type {string} */ (p.uid))) return;
      const r = this.cargo.slotRect(i);
      ctx.strokeStyle = '#d08aff';
      ctx.lineWidth = 4;
      ctx.strokeRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
    });

    const ui = stage.ctx('ui');
    for (const b of this.buttons) b.draw(ui, this.pointer);
    const hint = this.card
      ? 'Selected a deck card: upgrade its Frame or remove it.'
      : this.parts.length
        ? `${this.parts.length} part(s) selected${this.parts.length === 1 ? ' (a single Frame can also be upgraded)' : ''}.`
        : 'Select a deck card or Cargo parts to use a service.';
    label(ui, 470, 960, hint, { font: FONT.ui(17), color: '#a89878' });
    if (this.message && this.message.until > this.time) {
      ctx.font = FONT.ui(19, 600);
      wrapText(ctx, this.message.text, 980).forEach((line, i) =>
        label(ui, 470, 1000 + i * 24, line, {
          font: FONT.ui(19, 600),
          color: /** @type {any} */ (this.message).color,
        }),
      );
    }
  }
}
