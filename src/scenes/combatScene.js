// @ts-check
/**
 * Graybox combat scene (GDD §3, ROADMAP M1). Glue between the headless
 * combat engine, the renderer, and input. All rules live in src/game; this
 * file only decides what to show and which command to send.
 */
import { Combat } from '../game/combat/combat.js';
import { EventBus } from '../game/core/events.js';
import { buildSandboxDeck, buildStarterDeck } from '../game/model/deck.js';
import { STATUS_DEFS } from '../game/model/statuses.js';
import { riderText } from '../game/model/cardText.js';
import { DEFAULT_BINDINGS, actionForKey, handIndexForKey } from '../input/hotkeys.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { CARD_H, CARD_W, drawCard } from '../render/cardRenderer.js';
import { ELEMENT_STYLE, FONT, fillRound, inRect, label, panel } from '../render/draw.js';
import { Fx } from '../render/fx.js';
import { drawTargetingArrow } from '../ui/targetingArrow.js';

/**
 * @typedef {import('../render/canvas.js').Stage} Stage
 * @typedef {{ type: string, x?: number, y?: number, key?: string, button?: number }} InputEvent
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {{ uid: string, cx: number, cy: number, angle: number, scale: number, rect: Rect }} HandSlot
 */

const PLAY_LINE_Y = 720; // drag a non-targeted card above this line to play it
const END_TURN_BUTTON = { x: 1690, y: 760, w: 200, h: 64 };
const DRAW_PILE = { x: 40, y: 960, w: 90, h: 90 };
const DISCARD_PILE = { x: 1790, y: 960, w: 90, h: 90 };
const EXHAUST_PILE = { x: 1790, y: 860, w: 90, h: 80 };
const PLAYER_BODY = { x: 300, y: 330, w: 170, h: 230 };
const ENEMY_DELAY = 0.55; // seconds between enemy actions in the feedback timeline

const STATUS_COLORS = {
  burn: '#ff8a4a',
  shock: '#5ae0ff',
  chill: '#9fd4ff',
  strength: '#ff6a6a',
  charge: '#ffe066',
  jammed: '#c08aff',
  searing: '#ffa060',
  ward: '#b89aff',
  plated: '#c0c0c0',
  fortified: '#a0b0c0',
};

export class CombatScene {
  /**
   * @param {object} opts
   * @param {import('../game/core/registry.js').Registry} opts.registry
   * @param {string} opts.encounterId
   * @param {string} opts.seed
   * @param {string} [opts.chassisId]
   * @param {'starter' | 'sandbox'} [opts.deck]
   * @param {(action: 'retry' | 'next' | 'title') => void} opts.onExit
   */
  constructor({
    registry,
    encounterId,
    seed,
    chassisId = 'chassis_tinker',
    deck = 'starter',
    onExit,
  }) {
    this.registry = registry;
    this.encounterId = encounterId;
    this.seed = seed;
    this.chassisId = chassisId;
    this.onExit = onExit;
    this.bindings = DEFAULT_BINDINGS;

    this.bus = new EventBus();
    this.fx = new Fx();
    const chassis = registry.get(chassisId);
    this.combat = Combat.create({
      registry,
      bus: this.bus,
      encounterId,
      deck: deck === 'sandbox' ? buildSandboxDeck(registry) : buildStarterDeck(registry, chassisId),
      player: { hp: chassis.hp, maxHp: chassis.hp },
      seed,
      energyPerTurn: chassis.energy,
      drawPerTurn: chassis.draw,
    });

    this.time = 0;
    this.pointer = { x: 0, y: 0 };
    /** @type {string | null} */ this.selected = null;
    /** @type {string | null} */ this.target = null;
    /** @type {string | null} */ this.hoverCard = null;
    /** @type {string | null} */ this.hoverEnemy = null;
    this.dragging = false;
    this.dragFrom = { x: 0, y: 0 };
    this.explodedToggle = false;
    this.altHeld = false;
    /** @type {'draw' | 'discard' | 'exhaust' | null} */ this.pileView = null;
    this.endConfirmUntil = 0;
    /** Input is locked while the enemy-turn feedback plays out. */
    this.lockedUntil = 0;
    /** Running delay so enemy actions read one after another. */
    this.eventDelay = 0;
    /** @type {{ text: string, until: number, color: string }[]} */ this.toasts = [];
    /** @type {Record<string, number>} entity id -> displayed HP (tweened) */ this.displayHp = {};
    /** @type {Record<string, number>} enemy uid -> time of its last action (for the lunge) */ this.lunge =
      {};
    this.suppressFlash = 0;
    this.stateVersion = 0;
    this.bgVersion = -1;
    /** Time the combat ended; end-screen input is ignored briefly so a mashed key can't skip it. */
    /** @type {number | null} */ this.overAt = null;
    /** @type {{ key: string, value: ReturnType<Combat['preview']> } | null} */ this.previewCache =
      null;

    this.subscribe();
  }

  enter() {
    this.combat.start();
    this.syncDisplayHp(true);
  }

  // ---------------------------------------------------------------------------
  // Event feedback
  // ---------------------------------------------------------------------------

  subscribe() {
    const bus = this.bus;
    bus.on('*', () => this.stateVersion++);
    bus.on('enemyMove', (e) => {
      this.eventDelay += ENEMY_DELAY;
      this.lunge[/** @type {string} */ (e.uid)] = this.time + this.eventDelay;
    });
    bus.on('damage', (e) => {
      const pos = this.anchorOf(/** @type {string} */ (e.targetId));
      const amount = /** @type {number} */ (e.amount);
      const blocked = /** @type {number} */ (e.blocked);
      if (amount > 0)
        this.fx.float(
          pos.x,
          pos.y,
          `-${amount}`,
          e.kind === 'burn' ? '#ff9a4a' : '#ff5a4a',
          this.eventDelay,
        );
      if (blocked > 0)
        this.fx.float(pos.x + 60, pos.y + 30, `(${blocked})`, '#8ab4ff', this.eventDelay);
      if (e.targetId === 'player' && amount > 0) this.fx.shake(Math.min(0.5, 0.1 + amount / 40));
    });
    bus.on('blockGained', (e) => {
      const pos = this.anchorOf(/** @type {string} */ (e.targetId));
      this.fx.float(pos.x, pos.y + 40, `+${e.amount} Block`, '#8ab4ff', this.eventDelay);
    });
    bus.on('statusApplied', (e) => {
      const pos = this.anchorOf(/** @type {string} */ (e.targetId));
      const status = /** @type {string} */ (e.status);
      const color = /** @type {Record<string, string>} */ (STATUS_COLORS)[status] ?? '#ffffff';
      this.fx.float(
        pos.x,
        pos.y + 80,
        `+${e.stacks} ${STATUS_DEFS[status]?.name ?? status}`,
        color,
        this.eventDelay,
      );
    });
    bus.on('statusBlocked', () => {
      const pos = this.anchorOf('player');
      this.fx.float(pos.x, pos.y + 80, 'Warded!', '#b89aff', this.eventDelay);
    });
    bus.on('heal', (e) => {
      const pos = this.anchorOf(/** @type {string} */ (e.targetId));
      this.fx.float(pos.x, pos.y, `+${e.amount}`, '#7aff8a', this.eventDelay);
    });
    bus.on('enemyDied', (e) => {
      const pos = this.anchorOf(/** @type {string} */ (e.uid));
      this.fx.float(pos.x, pos.y - 40, 'DESTROYED', '#ffd27a', this.eventDelay);
      this.fx.sparks(pos.x, pos.y + 80, 60);
    });
    bus.on('cardExhausted', (e) => {
      const overclock = /** @type {number} */ (e.overclock);
      if (overclock > 0) {
        // Overclock feedback (GDD §3.6): shake scales with the tier, sparks fly.
        this.fx.shake(overclock === 1 ? 0.45 : 0.75);
        this.fx.sparks(LOGICAL_WIDTH / 2, 640, overclock === 1 ? 50 : 110);
        this.fx.float(LOGICAL_WIDTH / 2, 600, 'OVERCLOCKED', '#ffb040');
      }
    });
    bus.on('componentSuppressed', (e) => {
      const who = this.combat.enemy(/** @type {string} */ (e.source))?.name ?? 'Enemy';
      const what =
        e.slot === 'mod'
          ? 'EMP: your Mods are offline next turn'
          : 'Dampening Field: Core riders are offline next turn';
      this.toast(`${who} · ${what}`, '#ffe066', 3.2);
    });
    bus.on('turnStarted', () => {
      if (this.combat.state.suppression.length) this.suppressFlash = 1;
    });
    bus.on('slagAdded', (e) => {
      const def = this.registry.get(/** @type {string} */ (e.defId));
      const where =
        e.pile === 'draw'
          ? 'your draw pile'
          : e.pile === 'hand'
            ? 'your hand'
            : 'your discard pile';
      this.toast(`${def.name} added to ${where}`, '#d0a070', 2.6);
    });
    bus.on('shuffled', () =>
      this.toast('Discard pile shuffled into the draw pile', '#c8b8a0', 1.8),
    );
    bus.on('combatWon', () => this.toast('Victory!', '#ffd27a', 2));
    bus.on('combatLost', () => this.fx.shake(1));
  }

  /**
   * @param {string} text
   * @param {string} color
   * @param {number} seconds
   */
  toast(text, color, seconds) {
    this.toasts.push({ text, color, until: this.time + this.eventDelay + seconds });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  /** @returns {Array<{ uid: string, rect: Rect, alive: boolean, elite: boolean }>} */
  enemyLayout() {
    const enemies = this.combat.state.enemies;
    const spacing = 760 / enemies.length;
    return enemies.map((e, i) => {
      const elite = this.registry.get(e.defId).tier !== 'normal';
      const w = elite ? 220 : 150;
      const h = elite ? 280 : 200;
      const cx = 1020 + spacing * (i + 0.5);
      return { uid: e.uid, rect: { x: cx - w / 2, y: 560 - h, w, h }, alive: e.alive, elite };
    });
  }

  /** @param {string} id */
  anchorOf(id) {
    if (id === 'player') return { x: PLAYER_BODY.x + PLAYER_BODY.w / 2, y: PLAYER_BODY.y + 40 };
    const slot = this.enemyLayout().find((s) => s.uid === id);
    if (!slot) return { x: LOGICAL_WIDTH / 2, y: 300 };
    return { x: slot.rect.x + slot.rect.w / 2, y: slot.rect.y + 40 };
  }

  /** @returns {HandSlot[]} in draw order (hovered card last) */
  handLayout() {
    const hand = this.combat.state.piles.hand;
    const n = hand.length;
    const spacing = Math.min(172, 1150 / Math.max(n, 1));
    const startX = LOGICAL_WIDTH / 2 - (spacing * (n - 1)) / 2;
    /** @type {HandSlot[]} */
    const slots = hand.map((uid, i) => {
      const offset = i - (n - 1) / 2;
      let cx = startX + i * spacing;
      let cy = 912 + offset * offset * 3;
      let angle = (offset * 3 * Math.PI) / 180;
      let scale = 1;
      if (uid === this.hoverCard && !this.dragging) {
        scale = 1.3;
        cy = LOGICAL_HEIGHT - (CARD_H * scale) / 2 - 8;
        angle = 0;
      } else if (uid === this.selected) {
        cy -= 46;
        angle = 0;
      }
      const w = CARD_W * scale;
      const h = CARD_H * scale;
      return { uid, cx, cy, angle, scale, rect: { x: cx - w / 2, y: cy - h / 2, w, h } };
    });
    const hovered = slots.findIndex((s) => s.uid === this.hoverCard);
    if (hovered >= 0) slots.push(...slots.splice(hovered, 1));
    return slots;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  cardAt(x, y) {
    const slots = this.handLayout();
    // Topmost first. Use the un-hovered fan to avoid flicker at the lifted card's edges.
    for (let i = slots.length - 1; i >= 0; i--) {
      if (inRect(slots[i].rect, x, y)) return slots[i].uid;
    }
    return null;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  enemyAt(x, y) {
    for (const slot of this.enemyLayout()) {
      const r = slot.rect;
      if (slot.alive && inRect({ x: r.x - 20, y: r.y - 70, w: r.w + 40, h: r.h + 140 }, x, y))
        return slot.uid;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  get locked() {
    return this.time < this.lockedUntil || this.combat.over;
  }

  /** @param {string} uid */
  select(uid) {
    const check = this.combat.canPlay(uid);
    if (!check.ok) {
      this.toast(check.reason, '#ff9a8a', 1.4);
      this.selected = null;
      return false;
    }
    this.selected = uid;
    if (this.combat.needsTarget(uid)) {
      const alive = this.combat.aliveEnemies();
      if (!this.target || !this.combat.enemy(this.target)?.alive)
        this.target = alive[0]?.uid ?? null;
      if (this.hoverEnemy) this.target = this.hoverEnemy;
    }
    return true;
  }

  /**
   * @param {string} uid
   * @param {string | null} target
   */
  play(uid, target) {
    if (this.locked) return;
    const needsTarget = this.combat.needsTarget(uid);
    if (needsTarget && !target) {
      this.toast('Choose a target', '#ff9a8a', 1.2);
      return;
    }
    const check = this.combat.canPlay(uid, target);
    if (!check.ok) {
      this.toast(check.reason, '#ff9a8a', 1.4);
      return;
    }
    this.eventDelay = 0;
    this.combat.playCard(uid, needsTarget ? target : null);
    this.selected = null;
    this.dragging = false;
    this.syncDisplayHp(false);
  }

  requestEndTurn() {
    if (this.locked || this.combat.state.phase !== 'player') return;
    const playable = this.combat.state.piles.hand.some((uid) => this.combat.canPlay(uid).ok);
    if (playable && this.time > this.endConfirmUntil) {
      this.endConfirmUntil = this.time + 1.6;
      this.toast(
        'You still have playable cards. Press Space again to end your turn.',
        '#e8d6b0',
        1.6,
      );
      return;
    }
    this.endConfirmUntil = 0;
    this.selected = null;
    this.eventDelay = 0.2;
    this.combat.endTurn();
    this.lockedUntil = this.time + this.eventDelay + 0.25;
    this.eventDelay = 0;
  }

  /** @param {number} dir */
  cycleTarget(dir) {
    const alive = this.combat.aliveEnemies();
    if (alive.length === 0) return;
    const i = alive.findIndex((e) => e.uid === this.target);
    this.target = alive[(i + dir + alive.length) % alive.length].uid;
  }

  /** The target the current selection would hit (hover beats keyboard). */
  activeTarget() {
    if (!this.selected || !this.combat.needsTarget(this.selected)) return null;
    if (this.dragging) return this.hoverEnemy;
    return this.hoverEnemy ?? this.target;
  }

  currentPreview() {
    if (!this.selected) return null;
    const target = this.activeTarget();
    if (this.combat.needsTarget(this.selected) && !target) return null;
    const key = `${this.selected}|${target}|${this.stateVersion}`;
    if (this.previewCache?.key !== key) {
      this.previewCache = { key, value: this.combat.preview(this.selected, target) };
    }
    return this.previewCache.value;
  }

  /** @param {boolean} snap */
  syncDisplayHp(snap) {
    const s = this.combat.state;
    if (snap || this.displayHp.player === undefined) this.displayHp.player = s.player.hp;
    for (const e of s.enemies)
      if (snap || this.displayHp[e.uid] === undefined) this.displayHp[e.uid] = e.hp;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  /** @param {InputEvent} event */
  onInput(event) {
    if (event.x !== undefined && event.y !== undefined) this.pointer = { x: event.x, y: event.y };
    switch (event.type) {
      case 'pointermove':
        this.onPointerMove();
        break;
      case 'pointerdown':
        if (event.button === 2) this.explodedToggle = !this.explodedToggle;
        else if (event.button === 0) this.onPointerDown();
        break;
      case 'pointerup':
        if (event.button === 0) this.onPointerUp();
        break;
      case 'keydown':
        this.onKeyDown(/** @type {string} */ (event.key));
        break;
      case 'keyup':
        if (event.key === 'Alt') this.altHeld = false;
        break;
    }
  }

  onPointerMove() {
    const { x, y } = this.pointer;
    this.hoverEnemy = this.enemyAt(x, y);
    if (!this.dragging) this.hoverCard = this.pileView ? null : this.cardAt(x, y);
  }

  onPointerDown() {
    const { x, y } = this.pointer;
    if (this.pileView) {
      this.pileView = null;
      return;
    }
    if (this.combat.over) return;
    if (inRect(END_TURN_BUTTON, x, y)) {
      this.endConfirmUntil = this.time + 10; // clicking the button is deliberate
      this.requestEndTurn();
      return;
    }
    if (inRect(DRAW_PILE, x, y)) return void (this.pileView = 'draw');
    if (inRect(DISCARD_PILE, x, y)) return void (this.pileView = 'discard');
    if (inRect(EXHAUST_PILE, x, y)) return void (this.pileView = 'exhaust');

    const card = this.cardAt(x, y);
    if (card) {
      if (card === this.selected && !this.combat.needsTarget(card)) {
        this.play(card, null);
        return;
      }
      if (this.select(card)) {
        this.dragging = true;
        this.dragFrom = { x, y };
      }
      return;
    }
    const enemy = this.enemyAt(x, y);
    if (enemy && this.selected && this.combat.needsTarget(this.selected)) {
      this.play(this.selected, enemy);
      return;
    }
    if (enemy) {
      this.target = enemy;
      return;
    }
    this.selected = null;
  }

  onPointerUp() {
    if (!this.dragging || !this.selected) {
      this.dragging = false;
      return;
    }
    this.dragging = false;
    const { x, y } = this.pointer;
    const moved = Math.hypot(x - this.dragFrom.x, y - this.dragFrom.y) > 30;
    if (!moved) return; // a click: stay selected (click a target, or click the card again)
    if (this.combat.needsTarget(this.selected)) {
      if (this.hoverEnemy) this.play(this.selected, this.hoverEnemy);
      else this.selected = null;
    } else if (y < PLAY_LINE_Y) {
      this.play(this.selected, null);
    } else {
      this.selected = null;
    }
  }

  /** @param {string} key */
  onKeyDown(key) {
    const action = actionForKey(this.bindings, key);
    if (action === 'explode') {
      this.altHeld = true;
      return;
    }
    if (this.combat.over) {
      if (this.overAt === null || this.time - this.overAt < 0.8 || this.time < this.lockedUntil)
        return;
      if (action === 'retry') this.onExit('retry');
      else if (action === 'next' || action === 'confirm') this.onExit('next');
      else if (action === 'cancel') this.onExit('title');
      return;
    }
    if (this.pileView) {
      if (
        action === 'cancel' ||
        action === 'viewDraw' ||
        action === 'viewDiscard' ||
        action === 'viewExhaust'
      ) {
        this.pileView = null;
      }
      return;
    }
    const index = handIndexForKey(key);
    if (index !== null) {
      const uid = this.combat.state.piles.hand[index];
      if (!uid) return;
      if (uid === this.selected) this.play(uid, this.activeTarget());
      else this.select(uid);
      return;
    }
    switch (action) {
      case 'confirm':
        if (this.selected) this.play(this.selected, this.activeTarget());
        break;
      case 'cancel':
        if (this.selected) this.selected = null;
        else if (this.explodedToggle) this.explodedToggle = false;
        else this.onExit('title');
        break;
      case 'prevTarget':
        this.cycleTarget(-1);
        break;
      case 'nextTarget':
        this.cycleTarget(1);
        break;
      case 'endTurn':
        this.requestEndTurn();
        break;
      case 'viewDraw':
        this.pileView = 'draw';
        break;
      case 'viewDiscard':
        this.pileView = 'discard';
        break;
      case 'viewExhaust':
        this.pileView = 'exhaust';
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Update & render
  // ---------------------------------------------------------------------------

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
    if (this.combat.over && this.overAt === null)
      this.overAt = Math.max(this.time, this.lockedUntil);
    this.fx.update(dt);
    this.suppressFlash = Math.max(0, this.suppressFlash - dt * 0.9);
    this.toasts = this.toasts.filter((t) => t.until > this.time);
    // HP bars drain toward the real value once the feedback timeline reaches them.
    const s = this.combat.state;
    const rate = 60 * dt;
    const approach = (/** @type {string} */ id, /** @type {number} */ hp) => {
      const shown = this.displayHp[id] ?? hp;
      this.displayHp[id] = shown > hp ? Math.max(hp, shown - rate) : Math.min(hp, shown + rate);
    };
    if (this.time >= this.lockedUntil - 0.25) {
      approach('player', s.player.hp);
      for (const e of s.enemies) approach(e.uid, e.hp);
    }
  }

  /** @param {Stage} stage */
  render(stage) {
    this.renderBackground(stage);
    const shake = this.fx.shakeOffset();

    stage.clear('world');
    const world = stage.ctx('world');
    world.save();
    world.translate(shake.x, shake.y);
    this.renderPlayer(world);
    this.renderEnemies(world);
    world.restore();

    stage.clear('hand');
    const hand = stage.ctx('hand');
    hand.save();
    hand.translate(shake.x, shake.y);
    this.renderHud(hand);
    this.renderHand(hand);
    hand.restore();

    stage.clear('fx');
    const fx = stage.ctx('fx');
    fx.save();
    fx.translate(shake.x, shake.y);
    this.renderTargeting(fx);
    this.fx.render(fx);
    fx.restore();

    stage.clear('ui');
    const ui = stage.ctx('ui');
    this.renderTooltips(ui);
    this.renderToasts(ui);
    if (this.pileView) this.renderPileView(ui);
    if (this.combat.over) this.renderEndScreen(ui);
  }

  /** @param {Stage} stage */
  renderBackground(stage) {
    if (this.bgVersion === stage.resizeVersion) return;
    this.bgVersion = stage.resizeVersion;
    const ctx = stage.ctx('bg');
    const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
    grad.addColorStop(0, '#221b15');
    grad.addColorStop(0.6, '#15110d');
    grad.addColorStop(1, '#0c0a08');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    // Floor line separating the battlefield (top 60%) from the hand (bottom 40%).
    ctx.fillStyle = '#2a2018';
    ctx.fillRect(0, 590, LOGICAL_WIDTH, 6);
    ctx.strokeStyle = 'rgba(138, 106, 58, 0.06)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= LOGICAL_WIDTH; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 590);
      ctx.stroke();
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderPlayer(ctx) {
    const p = this.combat.state.player;
    const r = PLAYER_BODY;
    fillRound(ctx, r.x, r.y, r.w, r.h, 18, '#4a3c2a');
    ctx.strokeStyle = '#c9a86a';
    ctx.lineWidth = 3;
    ctx.stroke();
    // A glowing core in the Chassis' chest.
    const glow = ctx.createRadialGradient(r.x + r.w / 2, r.y + 90, 2, r.x + r.w / 2, r.y + 90, 34);
    glow.addColorStop(0, '#e0f0ff');
    glow.addColorStop(1, 'rgba(90, 140, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(r.x, r.y + 50, r.w, 80);
    label(ctx, r.x + r.w / 2, r.y + r.h - 18, this.registry.get(this.chassisId).name, {
      font: FONT.ui(17, 600),
      align: 'center',
    });
    const preview = this.currentPreview();
    this.renderBars(ctx, r, 'player', p, preview?.player ?? null);
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderEnemies(ctx) {
    const preview = this.currentPreview();
    const target = this.activeTarget();
    for (const slot of this.enemyLayout()) {
      const enemy = /** @type {import('../game/combat/combat.js').EnemyState} */ (
        this.combat.enemy(slot.uid)
      );
      if (!enemy.alive && (this.displayHp[enemy.uid] ?? 0) <= 0) continue;
      const r = { ...slot.rect };
      const lungeAt = this.lunge[slot.uid];
      if (lungeAt !== undefined) {
        const t = this.time - lungeAt;
        if (t >= 0 && t < 0.3) r.x -= Math.sin((t / 0.3) * Math.PI) * 40;
      }
      ctx.globalAlpha = enemy.alive ? 1 : 0.35;
      fillRound(ctx, r.x, r.y, r.w, r.h, 16, slot.elite ? '#4a2626' : '#3a3030');
      const highlighted = slot.uid === target || slot.uid === this.hoverEnemy;
      ctx.strokeStyle = highlighted ? '#ffd27a' : '#806050';
      ctx.lineWidth = highlighted ? 4 : 2;
      ctx.stroke();
      label(ctx, r.x + r.w / 2, r.y + r.h - 16, enemy.name, {
        font: FONT.ui(16, 600),
        align: 'center',
      });
      if (enemy.alive) this.renderIntent(ctx, slot.uid, r);
      const p =
        preview && !preview.random
          ? (preview.enemies.find((e) => e.uid === slot.uid) ?? null)
          : null;
      this.renderBars(ctx, r, enemy.uid, enemy, p);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * HP bar with ghosted damage preview, Block badge, and status chips.
   * @param {CanvasRenderingContext2D} ctx
   * @param {Rect} r
   * @param {string} id
   * @param {import('../game/combat/combat.js').Entity} e
   * @param {{ hpAfter: number, blockAfter: number, dies: boolean } | null} preview
   */
  renderBars(ctx, r, id, e, preview) {
    const w = Math.max(180, r.w);
    const x = r.x + r.w / 2 - w / 2;
    const y = r.y + r.h + 18;
    const shown = this.displayHp[id] ?? e.hp;
    fillRound(ctx, x, y, w, 20, 6, '#2a1a18');
    const frac = (/** @type {number} */ hp) => Math.max(0, Math.min(1, hp / e.maxHp));
    fillRound(ctx, x, y, w * frac(shown), 20, 6, '#b8322a');
    if (preview && preview.hpAfter < e.hp) {
      // Ghosted segment: the exact HP this play would remove.
      const pulse = 0.55 + 0.35 * Math.sin(this.time * 8);
      ctx.fillStyle = `rgba(255, 220, 200, ${pulse})`;
      ctx.fillRect(x + w * frac(preview.hpAfter), y, w * (frac(e.hp) - frac(preview.hpAfter)), 20);
    }
    const hpText =
      preview && preview.hpAfter !== e.hp
        ? `${e.hp} → ${preview.hpAfter}${preview.dies ? ' ✖' : ''}`
        : `${Math.round(shown)}/${e.maxHp}`;
    label(ctx, x + w / 2, y + 15, hpText, {
      font: FONT.ui(15, 700),
      align: 'center',
      color: '#fff4e0',
    });

    const block = preview ? preview.blockAfter : e.block;
    if (e.block > 0 || block > 0) {
      fillRound(ctx, x - 52, y - 8, 44, 36, 8, '#2a4a7a');
      const text =
        preview && preview.blockAfter !== e.block ? `${e.block}→${block}` : String(e.block);
      label(ctx, x - 30, y + 16, text, {
        font: FONT.ui(text.length > 3 ? 13 : 18, 700),
        align: 'center',
        color: '#dfeaff',
      });
    }

    let cx = x;
    for (const [status, stacks] of Object.entries(e.statuses)) {
      const color = /** @type {Record<string, string>} */ (STATUS_COLORS)[status] ?? '#ffffff';
      const text = `${STATUS_DEFS[status]?.name ?? status} ${stacks}`;
      ctx.font = FONT.ui(14, 600);
      const tw = ctx.measureText(text).width + 14;
      fillRound(ctx, cx, y + 28, tw, 24, 6, 'rgba(0, 0, 0, 0.55)');
      label(ctx, cx + 7, y + 45, text, { font: FONT.ui(14, 600), color });
      cx += tw + 6;
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {string} uid
   * @param {Rect} r
   */
  renderIntent(ctx, uid, r) {
    const intent = this.combat.intentOf(uid);
    if (!intent) return;
    const { text, color } = intentLabel(intent, this.registry);
    ctx.font = FONT.ui(20, 700);
    const w = ctx.measureText(text).width + 24;
    const x = r.x + r.w / 2 - w / 2;
    const y = r.y - 50;
    fillRound(ctx, x, y, w, 34, 17, 'rgba(0, 0, 0, 0.6)');
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    label(ctx, x + w / 2, y + 24, text, { font: FONT.ui(20, 700), align: 'center', color });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderHud(ctx) {
    const s = this.combat.state;
    const encounter = this.registry.get(this.encounterId);
    label(ctx, 40, 44, `${encounter.name}`, { font: FONT.title(28) });
    label(ctx, 40, 72, `Turn ${s.turn} · seed ${this.seed}`, {
      font: FONT.mono(15),
      color: '#8a7a60',
    });

    // Energy orb.
    ctx.beginPath();
    ctx.arc(170, 800, 54, 0, Math.PI * 2);
    ctx.fillStyle = s.energy > 0 ? '#2a5a8a' : '#2a2a30';
    ctx.fill();
    ctx.strokeStyle = '#9fd0ff';
    ctx.lineWidth = 4;
    ctx.stroke();
    label(ctx, 170, 814, `${s.energy}/${s.energyPerTurn}`, {
      font: FONT.ui(34, 800),
      align: 'center',
      color: '#eaf6ff',
    });

    // Piles.
    const pile = (
      /** @type {Rect} */ r,
      /** @type {string} */ name,
      /** @type {number} */ n,
      /** @type {string} */ key,
    ) => {
      fillRound(ctx, r.x, r.y, r.w, r.h, 12, 'rgba(40, 32, 24, 0.9)');
      ctx.strokeStyle = '#8a6a3a';
      ctx.lineWidth = 2;
      ctx.stroke();
      label(ctx, r.x + r.w / 2, r.y + r.h / 2 + 4, String(n), {
        font: FONT.ui(28, 800),
        align: 'center',
      });
      label(ctx, r.x + r.w / 2, r.y + r.h - 8, `${name} [${key}]`, {
        font: FONT.ui(12),
        align: 'center',
        color: '#a89878',
      });
    };
    pile(DRAW_PILE, 'Draw', s.piles.draw.length, 'D');
    pile(DISCARD_PILE, 'Discard', s.piles.discard.length, 'F');
    pile(EXHAUST_PILE, 'Exhaust', s.piles.exhaust.length, 'X');

    // End turn button.
    const enabled = s.phase === 'player' && !this.locked;
    const confirming = this.time < this.endConfirmUntil;
    fillRound(
      ctx,
      END_TURN_BUTTON.x,
      END_TURN_BUTTON.y,
      END_TURN_BUTTON.w,
      END_TURN_BUTTON.h,
      14,
      enabled ? (confirming ? '#7a5a1a' : '#5a4220') : '#2a2420',
    );
    ctx.strokeStyle = enabled ? '#e8c070' : '#5a4a3a';
    ctx.lineWidth = 3;
    ctx.stroke();
    label(
      ctx,
      END_TURN_BUTTON.x + END_TURN_BUTTON.w / 2,
      END_TURN_BUTTON.y + 40,
      this.locked && !this.combat.over ? 'Enemy turn…' : 'End Turn [Space]',
      {
        font: FONT.ui(20, 700),
        align: 'center',
        color: enabled ? '#fff0c8' : '#7a6a5a',
      },
    );

    // Suppression banner and the static wave across the hand.
    if (s.suppression.length) {
      const names = s.suppression
        .map((x) => (x.slot === 'mod' ? 'Mods' : 'Core riders'))
        .join(' and ');
      label(ctx, LOGICAL_WIDTH / 2, 640, `⚡ ${names} suppressed this turn`, {
        font: FONT.ui(20, 700),
        align: 'center',
        color: '#ffe066',
      });
    }
    if (this.suppressFlash > 0) {
      const wave = (1 - this.suppressFlash) * (LOGICAL_WIDTH + 400) - 200;
      const grad = ctx.createLinearGradient(wave - 200, 0, wave + 200, 0);
      grad.addColorStop(0, 'rgba(255, 230, 100, 0)');
      grad.addColorStop(0.5, `rgba(255, 230, 100, ${0.35 * this.suppressFlash})`);
      grad.addColorStop(1, 'rgba(255, 230, 100, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 660, LOGICAL_WIDTH, 420);
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderHand(ctx) {
    for (const slot of this.handLayout()) {
      if (this.dragging && slot.uid === this.selected && !this.combat.needsTarget(slot.uid)) {
        // Non-targeted cards follow the cursor while dragged.
        slot.cx = this.pointer.x;
        slot.cy = this.pointer.y;
        slot.angle = 0;
      }
      ctx.save();
      ctx.translate(slot.cx, slot.cy);
      ctx.rotate(slot.angle);
      const w = CARD_W * slot.scale;
      const h = CARD_H * slot.scale;
      if (slot.uid === this.selected) {
        ctx.shadowColor = '#ffd27a';
        ctx.shadowBlur = 24;
      }
      drawCard(ctx, this.viewOf(slot.uid), -w / 2, -h / 2, slot.scale);
      ctx.restore();
      const index = this.combat.state.piles.hand.indexOf(slot.uid);
      if (slot.scale === 1 && index < 10) {
        label(ctx, slot.cx, slot.cy - CARD_H / 2 - 8, String((index + 1) % 10), {
          font: FONT.mono(14),
          align: 'center',
          color: '#8a7a60',
        });
      }
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderTargeting(ctx) {
    if (!this.selected) return;
    if (!this.combat.needsTarget(this.selected)) {
      if (this.dragging) {
        ctx.strokeStyle =
          this.pointer.y < PLAY_LINE_Y ? 'rgba(255, 210, 122, 0.6)' : 'rgba(255, 210, 122, 0.2)';
        ctx.setLineDash([12, 10]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, PLAY_LINE_Y);
        ctx.lineTo(LOGICAL_WIDTH, PLAY_LINE_Y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      return;
    }
    const slot = this.handLayout().find((s) => s.uid === this.selected);
    if (!slot) return;
    const from = { x: slot.cx, y: slot.rect.y + 20 };
    const target = this.activeTarget();
    let to = this.pointer;
    if (!this.dragging || target) {
      if (!target) return;
      const a = this.anchorOf(target);
      to = this.dragging ? this.pointer : { x: a.x, y: a.y + 70 };
    }
    const d = this.combat.derive(this.selected);
    const color = ELEMENT_STYLE[/** @type {keyof typeof ELEMENT_STYLE} */ (d.element)].color;
    drawTargetingArrow(ctx, from, to, { color: target ? color : '#ff6a5a', time: this.time });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderTooltips(ctx) {
    if (this.pileView || this.combat.over) return;
    // Exploded view of the hovered (or selected) card.
    const uid = this.hoverCard ?? this.selected;
    if ((this.altHeld || this.explodedToggle) && uid) {
      const lines = this.explodedLines(uid);
      const slot = this.handLayout().find((s) => s.uid === uid);
      const x = slot ? Math.min(slot.rect.x + slot.rect.w + 12, LOGICAL_WIDTH - 430) : 60;
      panel(ctx, x, 300, 420, lines);
      return;
    }
    if (this.hoverEnemy && !this.dragging) {
      const enemy = /** @type {import('../game/combat/combat.js').EnemyState} */ (
        this.combat.enemy(this.hoverEnemy)
      );
      const intent = this.combat.intentOf(enemy.uid);
      /** @type {Array<string | { text: string, color?: string }>} */
      const lines = [
        `HP ${enemy.hp}/${enemy.maxHp}${enemy.block ? ` · Block ${enemy.block}` : ''}`,
      ];
      if (intent)
        lines.push({
          text: `Next: ${intent.name}. ${intentSentence(intent, this.registry)}`,
          color: '#ffd27a',
        });
      for (const [status, stacks] of Object.entries(enemy.statuses)) {
        lines.push({
          text: `${STATUS_DEFS[status]?.name} ${stacks}: ${STATUS_DEFS[status]?.text}`,
          color: /** @type {Record<string, string>} */ (STATUS_COLORS)[status],
        });
      }
      const slot = this.enemyLayout().find((s) => s.uid === enemy.uid);
      const x = slot ? Math.max(20, Math.min(slot.rect.x - 100, LOGICAL_WIDTH - 400)) : 1200;
      panel(ctx, x, 80, 380, { title: enemy.name, lines });
    }
    if (
      !this.selected &&
      this.hoverCard === null &&
      !this.hoverEnemy &&
      inRect(PLAYER_BODY, this.pointer.x, this.pointer.y)
    ) {
      const p = this.combat.state.player;
      const lines = Object.entries(p.statuses).map(
        ([s, n]) => `${STATUS_DEFS[s]?.name} ${n}: ${STATUS_DEFS[s]?.text}`,
      );
      panel(ctx, PLAYER_BODY.x + PLAYER_BODY.w + 20, 200, 360, {
        title: 'Your Chassis',
        lines: [`HP ${p.hp}/${p.maxHp}`, ...lines],
      });
    }
  }

  /**
   * Exploded View (GDD §3.2): each component's exact contribution.
   * @param {string} uid
   */
  explodedLines(uid) {
    const card = this.combat.card(uid);
    if (card.kind === 'slag') {
      const def = this.registry.get(card.defId);
      return { title: def.name, lines: [def.text] };
    }
    const d = this.combat.derive(uid);
    const frame = this.registry.get(card.frame.defId);
    const core = this.registry.get(card.core.defId);
    const mod = card.mod ? this.registry.get(card.mod.defId) : null;
    /** @type {Array<string | { text: string, color?: string }>} */
    const lines = [
      {
        text: `FRAME  ${frame.name}: cost ${frame.cost}, capacity ${frame.capacity}${frame.base !== null ? `, base ${frame.base}` : ''}${frame.hits > 1 ? ` ×${frame.hits}` : ''}`,
        color: '#e8d6b0',
      },
      {
        text: `CORE   ${core.name}: ${core.element}, power ${core.power}, weight ${core.weight}${d.rider ? ` · ${riderText(d.rider)}` : ''}${d.suppressed.coreRider ? ' · RIDER SUPPRESSED' : ''}`,
        color: ELEMENT_STYLE[/** @type {keyof typeof ELEMENT_STYLE} */ (core.element)].color,
      },
      mod
        ? {
            text: `MOD    ${mod.name}: weight ${mod.weight} · ${mod.text}${d.suppressed.mod ? ' · SUPPRESSED' : ''}`,
            color: d.suppressed.mod ? '#8a8a8a' : '#d8b070',
          }
        : { text: 'MOD    (empty socket)', color: '#7a6a5a' },
      ' ',
    ];
    for (const line of d.breakdown) {
      const sign = line.value !== undefined ? `${line.value >= 0 ? '+' : ''}${line.value} ` : '';
      lines.push(
        `${sign}${line.label}${line.stat && line.stat !== 'value' ? ` (${line.stat})` : ''}${line.note ? ` · ${line.note}` : ''}`,
      );
    }
    if (d.verb !== 'utility')
      lines.push({
        text: `= ${d.valuePerHit} per hit${d.hits > 1 ? ` × ${d.hits}` : ''}`,
        color: '#fff0c8',
      });
    lines.push({
      text: `Weight ${d.weight} / Capacity ${d.capacity} · ${d.overclock ? `OVERCLOCKED +${d.overclock} (Exhausts)` : 'stable'}`,
      color: d.overclock ? '#ffb070' : '#a8c890',
    });
    if (d.hasTargetConditions)
      lines.push({
        text: 'Has target-dependent effects: hover an enemy to preview.',
        color: '#a89878',
      });
    return { title: `${d.name}  (right-click / hold Alt)`, lines };
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderToasts(ctx) {
    this.toasts.forEach((t, i) => {
      ctx.font = FONT.ui(20, 600);
      const w = ctx.measureText(t.text).width + 40;
      const x = LOGICAL_WIDTH / 2 - w / 2;
      const y = 96 + i * 46;
      fillRound(ctx, x, y, w, 38, 19, 'rgba(10, 8, 6, 0.85)');
      label(ctx, LOGICAL_WIDTH / 2, y + 26, t.text, {
        font: FONT.ui(20, 600),
        align: 'center',
        color: t.color,
      });
    });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderPileView(ctx) {
    const pileName = /** @type {'draw' | 'discard' | 'exhaust'} */ (this.pileView);
    ctx.fillStyle = 'rgba(8, 6, 4, 0.88)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    const uids = [...this.combat.state.piles[pileName]];
    // The draw pile is shown sorted so its order stays hidden.
    if (pileName === 'draw') uids.sort((a, b) => this.nameOf(a).localeCompare(this.nameOf(b)));
    const title = {
      draw: 'Draw pile (order hidden)',
      discard: 'Discard pile',
      exhaust: 'Exhausted this combat',
    }[pileName];
    label(ctx, LOGICAL_WIDTH / 2, 70, `${title} · ${uids.length}`, {
      font: FONT.title(34),
      align: 'center',
    });
    const perRow = 7;
    const scale = 0.85;
    uids.forEach((uid, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      drawCard(ctx, this.viewOf(uid, true), 120 + col * 245, 110 + row * 250, scale);
    });
    if (uids.length === 0)
      label(ctx, LOGICAL_WIDTH / 2, 500, 'Empty', {
        font: FONT.ui(24),
        align: 'center',
        color: '#8a7a60',
      });
    label(ctx, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT - 30, 'Click or press Esc to close', {
      font: FONT.ui(18),
      align: 'center',
      color: '#a89878',
    });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderEndScreen(ctx) {
    if (this.time < this.lockedUntil) return;
    const won = this.combat.state.phase === 'won';
    ctx.fillStyle = 'rgba(8, 6, 4, 0.72)';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    label(ctx, LOGICAL_WIDTH / 2, 430, won ? 'VICTORY' : 'CHASSIS DESTROYED', {
      font: FONT.title(96),
      align: 'center',
      color: won ? '#ffd27a' : '#ff6a5a',
    });
    const s = this.combat.state;
    label(
      ctx,
      LOGICAL_WIDTH / 2,
      500,
      `Turn ${s.turn} · HP ${s.player.hp}/${s.player.maxHp} · ${s.piles.exhaust.length} card(s) exhausted`,
      {
        font: FONT.ui(24),
        align: 'center',
        color: '#cbbd9e',
      },
    );
    label(ctx, LOGICAL_WIDTH / 2, 580, '[N] Next encounter   ·   [R] Retry   ·   [Esc] Title', {
      font: FONT.ui(26, 600),
      align: 'center',
    });
  }

  /**
   * @param {string} uid
   * @param {boolean} [ignoreEnergy]
   * @returns {import('../render/cardRenderer.js').CardView | import('../render/cardRenderer.js').SlagView}
   */
  viewOf(uid, ignoreEnergy = false) {
    const card = this.combat.card(uid);
    const cost = this.combat.costOf(uid);
    const affordable =
      ignoreEnergy ||
      (cost !== null && cost <= this.combat.state.energy && this.combat.state.phase === 'player');
    if (card.kind === 'slag') {
      const def = this.registry.get(card.defId);
      return {
        kind: 'slag',
        key: `${card.defId}:${cost}`,
        name: def.name,
        text: def.text,
        cost,
        affordable,
      };
    }
    const mod = card.mod ? this.registry.get(card.mod.defId) : null;
    return {
      kind: 'card',
      derived: this.combat.derive(uid),
      affordable,
      parts: { mod: card.mod?.defId ?? null, modName: mod?.name ?? null },
    };
  }

  /** @param {string} uid */
  nameOf(uid) {
    const card = this.combat.card(uid);
    return card.kind === 'slag' ? this.registry.get(card.defId).name : this.combat.derive(uid).name;
  }
}

/**
 * @param {import('../game/combat/combat.js').IntentView} intent
 * @param {import('../game/core/registry.js').Registry} registry
 */
function intentLabel(intent, registry) {
  switch (intent.intent) {
    case 'attack':
      return {
        text: `ATK ${intent.damage}${(intent.hits ?? 1) > 1 ? `×${intent.hits}` : ''}`,
        color: '#ff7a6a',
      };
    case 'defend':
      return { text: `DEF ${intent.block}`, color: '#8ab4ff' };
    case 'buff':
      return {
        text: `BUFF +${intent.stacks} ${STATUS_DEFS[intent.status ?? '']?.name ?? ''}`,
        color: '#7aff8a',
      };
    case 'debuff':
      return { text: `DEBUFF ${STATUS_DEFS[intent.status ?? '']?.name ?? ''}`, color: '#c08aff' };
    case 'suppress':
      return {
        text: intent.slot === 'mod' ? '⚡ EMP: Mods' : '⚡ DAMPEN: Riders',
        color: '#ffe066',
      };
    case 'slag':
      return {
        text: `SLAG ×${intent.count} ${registry.get(intent.slag ?? '').name.split(' ')[0]}`,
        color: '#d0a070',
      };
    default:
      return { text: '?', color: '#ffffff' };
  }
}

/**
 * @param {import('../game/combat/combat.js').IntentView} intent
 * @param {import('../game/core/registry.js').Registry} registry
 */
function intentSentence(intent, registry) {
  switch (intent.intent) {
    case 'attack':
      return `Attacks for ${intent.damage}${(intent.hits ?? 1) > 1 ? ` × ${intent.hits}` : ''}.`;
    case 'defend':
      return `Gains ${intent.block} Block.`;
    case 'buff':
    case 'debuff':
      return `Applies ${intent.stacks} ${STATUS_DEFS[intent.status ?? '']?.name}.`;
    case 'suppress':
      return intent.slot === 'mod'
        ? 'Disables all Mods on your cards during your next turn.'
        : 'Disables Core element riders on your cards during your next turn.';
    case 'slag':
      return `Adds ${intent.count} ${registry.get(intent.slag ?? '').name} to your piles.`;
    default:
      return '';
  }
}
