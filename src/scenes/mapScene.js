// @ts-check
/**
 * The Stratum map (GDD §4.2): pick the next node along the conveyor paths.
 * A side panel shows the run at a glance: Blueprints, Cargo, and the deck.
 */
import { deriveCard } from '../game/model/card.js';
import { RunError } from '../game/run/run.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, label, panel, wrapText } from '../render/draw.js';
import { NODE_STYLE, drawRunHeader } from './runHud.js';

const MAP = { x: 120, y: 140, w: 980, h: 900 };
const PANEL_X = 1180;
const NODE_R = 22;

export class MapScene {
  /**
   * @param {object} opts
   * @param {import('../game/run/run.js').Run} opts.run
   * @param {() => void} opts.onTravel  Called after moving to a node (route to its scene).
   * @param {() => void} opts.onTitle
   */
  constructor({ run, onTravel, onTitle }) {
    this.run = run;
    this.registry = run.registry;
    this.onTravel = onTravel;
    this.onTitle = onTitle;
    this.time = 0;
    this.pointer = { x: 0, y: 0 };
    /** @type {string | null} keyboard focus among available nodes */ this.focus =
      run.availableNodes()[0] ?? null;
    /** @type {string | null} */ this.error = null;
  }

  /** @param {import('../game/run/map.js').MapNode} node */
  pos(node) {
    const map = this.run.state.map;
    const colW = MAP.w / map.cols;
    const rowH = MAP.h / map.rows;
    // Row 0 at the bottom; a gentle per-node jitter keeps the grid from looking ruled.
    const jitter = node.type === 'boss' ? 0 : (((node.row * 7 + node.col * 13) % 5) - 2) * 4;
    return {
      x: MAP.x + colW * (node.col + 0.5) + jitter,
      y: MAP.y + MAP.h - rowH * (node.row + 0.5),
    };
  }

  nodeAt(/** @type {number} */ x, /** @type {number} */ y) {
    for (const node of Object.values(this.run.state.map.nodes)) {
      const p = this.pos(node);
      const r = node.type === 'boss' ? NODE_R * 2 : NODE_R + 6;
      if (Math.hypot(p.x - x, p.y - y) <= r) return node.id;
    }
    return null;
  }

  /** @param {string} id */
  travel(id) {
    try {
      this.run.travel(id);
      this.onTravel();
    } catch (err) {
      if (!(err instanceof RunError)) throw err;
      this.error = err.message;
    }
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
  }

  /** @param {import('./sceneManager.js').InputEvent} event */
  onInput(event) {
    if (event.x !== undefined && event.y !== undefined) this.pointer = { x: event.x, y: event.y };
    const available = this.run.availableNodes();
    if (event.type === 'pointermove') {
      const id = this.nodeAt(this.pointer.x, this.pointer.y);
      if (id && available.includes(id)) this.focus = id;
    } else if (event.type === 'pointerdown' && event.button === 0) {
      const id = this.nodeAt(this.pointer.x, this.pointer.y);
      if (id && available.includes(id)) this.travel(id);
      else if (id) this.error = 'You can only move along a conveyor to the next row.';
    } else if (event.type === 'keydown') {
      const i = this.focus ? available.indexOf(this.focus) : -1;
      if (event.key === 'ArrowLeft' || event.key === 'a')
        this.focus = available[(i - 1 + available.length) % available.length];
      else if (event.key === 'ArrowRight' || event.key === 'd')
        this.focus = available[(i + 1) % available.length];
      else if (event.key === 'Enter' && this.focus) this.travel(this.focus);
      else if (event.key === 'Escape') this.onTitle();
    }
  }

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    const bg = stage.ctx('bg');
    bg.fillStyle = '#100d0a';
    bg.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    for (const layer of /** @type {const} */ (['world', 'hand', 'fx', 'ui'])) stage.clear(layer);
    const ctx = stage.ctx('world');
    drawRunHeader(ctx, this.run, 'The Foundry Floor');
    this.renderMap(ctx);
    this.renderPanel(ctx);
    const ui = stage.ctx('ui');
    this.renderTooltip(ui);
    label(
      ui,
      MAP.x + MAP.w / 2,
      LOGICAL_HEIGHT - 14,
      'Click a glowing node (or ←/→ and Enter) to travel · Esc: title (the run is saved)',
      {
        font: FONT.ui(16),
        align: 'center',
        color: '#7a6a55',
      },
    );
    if (this.error) label(ui, MAP.x, 132, this.error, { font: FONT.ui(18, 600), color: '#ff9a8a' });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderMap(ctx) {
    const s = this.run.state;
    const nodes = Object.values(s.map.nodes);
    const available = new Set(this.run.availableNodes());
    const visited = new Set(s.visited);
    // Conveyor paths.
    for (const node of nodes) {
      const a = this.pos(node);
      for (const next of node.next) {
        const b = this.pos(s.map.nodes[next]);
        const walked = visited.has(node.id) && visited.has(next);
        const open = node.id === s.position && available.has(next);
        ctx.strokeStyle = walked
          ? '#ffd27a'
          : open
            ? 'rgba(255, 210, 122, 0.7)'
            : 'rgba(138, 106, 58, 0.35)';
        ctx.lineWidth = walked ? 5 : open ? 4 : 2;
        ctx.setLineDash(walked || open ? [] : [6, 8]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    // Nodes.
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);
    for (const node of nodes) {
      const p = this.pos(node);
      const style = NODE_STYLE[node.type];
      const r = node.type === 'boss' ? NODE_R * 2 : NODE_R;
      const isAvailable = available.has(node.id);
      const isCurrent = node.id === s.position;
      const done = visited.has(node.id);
      if (isAvailable) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8 + pulse * 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 210, 122, ${0.15 + 0.2 * pulse})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = done ? '#3a2e20' : '#1c1612';
      ctx.fill();
      ctx.lineWidth = isCurrent ? 5 : this.focus === node.id && isAvailable ? 4 : 2;
      ctx.strokeStyle = isCurrent
        ? '#ffffff'
        : this.focus === node.id && isAvailable
          ? '#ffd27a'
          : style.color;
      ctx.globalAlpha = done || isAvailable || isCurrent ? 1 : 0.6;
      ctx.stroke();
      label(ctx, p.x, p.y + (node.type === 'boss' ? 14 : 8), style.glyph, {
        font: FONT.ui(node.type === 'boss' ? 40 : 22, 700),
        align: 'center',
        color: style.color,
      });
      ctx.globalAlpha = 1;
    }
    // Legend.
    let lx = MAP.x;
    for (const [, style] of Object.entries(NODE_STYLE)) {
      label(ctx, lx, MAP.y + MAP.h + 34, `${style.glyph} ${style.name}`, {
        font: FONT.ui(15, 600),
        color: style.color,
      });
      lx += style.name.length * 8 + 60;
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderPanel(ctx) {
    const s = this.run.state;
    let y = 150;
    const heading = (/** @type {string} */ text) => {
      label(ctx, PANEL_X, y, text, { font: FONT.ui(20, 700), color: '#e8d6b0' });
      y += 30;
    };
    heading(`Blueprints (${s.blueprints.length})`);
    if (s.blueprints.length === 0) {
      label(ctx, PANEL_X, y, 'Defeat Elites to earn Blueprints.', {
        font: FONT.ui(15),
        color: '#7a6a55',
      });
      y += 24;
    }
    for (const id of s.blueprints) {
      const bp = this.registry.get(id);
      label(ctx, PANEL_X, y, bp.name, { font: FONT.ui(16, 700), color: '#9fe0ff' });
      ctx.font = FONT.ui(14);
      for (const line of wrapText(ctx, bp.text, 680)) {
        y += 19;
        label(ctx, PANEL_X + 12, y, line, { font: FONT.ui(14), color: '#a8c0d0' });
      }
      y += 26;
    }
    y += 10;
    heading(`Cargo Hold (${s.cargo.items.length}/${s.cargo.slots})`);
    const names = s.cargo.items.map((p) => this.registry.get(p.defId).name);
    ctx.font = FONT.ui(15);
    for (const line of wrapText(ctx, names.length ? names.join(' · ') : 'Empty', 700)) {
      label(ctx, PANEL_X, y, line, { font: FONT.ui(15), color: '#cbbd9e' });
      y += 21;
    }
    y += 16;
    heading(`Deck (${s.deck.length})`);
    const deck = s.deck.map((c) => {
      const d = deriveCard(c, { registry: this.registry });
      return {
        name: d.name,
        cost: d.cost,
        mod: c.mod ? this.registry.get(c.mod.defId).name : '',
        over: d.overclock > 0,
      };
    });
    deck.forEach((c, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = PANEL_X + col * 360;
      const yy = y + row * 26;
      if (yy > LOGICAL_HEIGHT - 40) return;
      label(ctx, x, yy, `${c.cost}`, { font: FONT.ui(15, 800), color: '#9fe0ff' });
      label(ctx, x + 20, yy, `${c.name}${c.mod ? ` + ${c.mod}` : ''}`, {
        font: FONT.ui(15),
        color: c.over ? '#ffb070' : '#e8d6b0',
      });
    });
  }

  /** @param {CanvasRenderingContext2D} ctx */
  renderTooltip(ctx) {
    const id = this.nodeAt(this.pointer.x, this.pointer.y);
    if (!id) return;
    const node = this.run.state.map.nodes[id];
    const style = NODE_STYLE[node.type];
    /** @type {Record<string, string>} */
    const about = {
      combat:
        node.pool === 'easy'
          ? 'A light fight. Drops basic parts and some Aether.'
          : 'A standard fight. Drops parts and Aether.',
      elite:
        'A dangerous machine that interferes with your cards. Drops a Refined+ Mod and a Blueprint choice.',
      workbench: 'Assemble and modify cards (3 Tool Charges), or rest for a Field Repair.',
      smelter: 'Spend Aether: buy parts, upgrade Frame Capacity, fuse parts, or remove a card.',
      event: 'Something unusual. Choices with risks and rewards.',
      boss: 'The guardian of this Stratum. Beat it to clear the Foundry Floor.',
    };
    const p = this.pos(node);
    panel(ctx, Math.min(p.x + 30, MAP.x + MAP.w - 340), Math.max(140, p.y - 60), 340, {
      title: style.name,
      lines: [about[node.type], { text: `Row ${node.row + 1}`, color: '#7a6a55' }],
    });
  }
}
