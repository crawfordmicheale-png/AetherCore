// @ts-check
/**
 * Graybox card compositing (docs/TECHNICAL_DESIGN.md §6.2): Frame layer, Core
 * layer clipped to the Frame's cutout, Mod badge, text, then state overlays.
 * Card images are cached by the derived hash, so re-derivation (EMP, Rust
 * Slag) automatically produces a fresh image.
 */
import { cardRulesText } from '../game/model/cardText.js';
import { ELEMENT_STYLE, FONT, roundRect, wrapText } from './draw.js';

export const CARD_W = 200;
export const CARD_H = 280;
const CACHE_SCALE = 2;
const CACHE_LIMIT = 80;

const VERB_STYLE = {
  attack: { fill: '#4f2a22', label: 'ATTACK' },
  defend: { fill: '#223a52', label: 'DEFEND' },
  utility: { fill: '#3a3722', label: 'UTILITY' },
};

/** @type {Map<string, HTMLCanvasElement | OffscreenCanvas>} */
const cache = new Map();

/**
 * @typedef {object} CardView
 * @property {'card'} kind
 * @property {import('../game/model/card.js').DerivedCard} derived
 * @property {boolean} affordable
 * @property {{ mod: string | null, modName: string | null }} parts
 *
 * @typedef {object} SlagView
 * @property {'slag'} kind
 * @property {string} key
 * @property {string} name
 * @property {string} text
 * @property {number | null} cost
 * @property {boolean} affordable
 */

/**
 * Draws a card with its top-left at (x, y).
 * @param {CanvasRenderingContext2D} ctx
 * @param {CardView | SlagView} view
 * @param {number} x
 * @param {number} y
 * @param {number} [scale]
 */
export function drawCard(ctx, view, x, y, scale = 1) {
  const key =
    view.kind === 'card'
      ? `c:${view.derived.hash}:${view.affordable}`
      : `s:${view.key}:${view.affordable}`;
  let image = cache.get(key);
  if (!image) {
    image = renderToImage(view);
    cache.set(key, image);
    if (cache.size > CACHE_LIMIT) cache.delete(/** @type {string} */ (cache.keys().next().value));
  } else {
    // Refresh LRU position.
    cache.delete(key);
    cache.set(key, image);
  }
  ctx.drawImage(image, x, y, CARD_W * scale, CARD_H * scale);
}

/** @param {CardView | SlagView} view */
function renderToImage(view) {
  const w = CARD_W * CACHE_SCALE;
  const h = CARD_H * CACHE_SCALE;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.scale(CACHE_SCALE, CACHE_SCALE);
  if (view.kind === 'card') paintComposite(ctx, view);
  else paintSlag(ctx, view);
  return canvas;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {CardView} view
 */
function paintComposite(ctx, view) {
  const d = view.derived;
  const verb = VERB_STYLE[d.verb];
  const element = ELEMENT_STYLE[/** @type {keyof typeof ELEMENT_STYLE} */ (d.element)];
  ctx.globalAlpha = view.affordable ? 1 : 0.6;

  // --- Frame layer -----------------------------------------------------------
  roundRect(ctx, 4, 4, CARD_W - 8, CARD_H - 8, 14);
  ctx.fillStyle = verb.fill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = d.overclock === 0 ? '#c9a86a' : d.overclock === 1 ? '#f0a020' : '#ff4a2a';
  ctx.stroke();
  if (d.overclock > 0) {
    // Overclock glow (GDD §2.3: amber at +1, red at +2).
    ctx.save();
    ctx.shadowColor = d.overclock === 1 ? '#f0a020' : '#ff4a2a';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
  }

  // --- Core layer: masked to the Frame's center cutout ------------------------
  const cx = CARD_W / 2;
  const cy = 124;
  const cutout = new Path2D();
  cutout.arc(cx, cy, 40, 0, Math.PI * 2);
  ctx.save();
  ctx.clip(cutout);
  const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 40);
  glow.addColorStop(0, '#fff8e8');
  glow.addColorStop(0.35, element.color);
  glow.addColorStop(1, '#1a1410');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - 44, cy - 44, 88, 88);
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#8a6a3a';
  ctx.stroke(cutout);
  ctx.font = FONT.ui(30, 700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#1a1410';
  ctx.fillText(element.glyph, cx, cy + 1);
  if (d.suppressed.coreRider) greyOut(ctx, cutout, cx - 40, cy - 40, 80, 80);

  // --- Mod badge (top-right socket) ------------------------------------------
  const badge = new Path2D();
  hexagon(badge, CARD_W - 30, 30, 18);
  if (view.parts.mod) {
    ctx.fillStyle = '#b58a3c';
    ctx.fill(badge);
    ctx.strokeStyle = '#3a2a14';
    ctx.lineWidth = 2;
    ctx.stroke(badge);
    ctx.fillStyle = '#2a1e0e';
    ctx.font = FONT.ui(13, 700);
    ctx.fillText((view.parts.modName ?? '?').slice(0, 2).toUpperCase(), CARD_W - 30, 31);
    if (d.suppressed.mod) greyOut(ctx, badge, CARD_W - 50, 10, 40, 40);
  } else {
    ctx.strokeStyle = 'rgba(201, 168, 106, 0.35)';
    ctx.setLineDash([3, 3]);
    ctx.stroke(badge);
    ctx.setLineDash([]);
  }

  // --- Text layer --------------------------------------------------------------
  // Cost gem.
  ctx.beginPath();
  ctx.arc(30, 30, 19, 0, Math.PI * 2);
  ctx.fillStyle = '#16120e';
  ctx.fill();
  ctx.strokeStyle = '#c9a86a';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = view.affordable ? '#9fe0ff' : '#ff7a6a';
  ctx.font = FONT.ui(22, 700);
  ctx.fillText(String(d.cost), 30, 31);

  // Name on its own row, shrunk to fit the card's width.
  ctx.fillStyle = '#f0e2c0';
  let nameSize = 17;
  ctx.font = FONT.ui(nameSize, 700);
  while (nameSize > 11 && ctx.measureText(d.name).width > CARD_W - 28) {
    nameSize--;
    ctx.font = FONT.ui(nameSize, 700);
  }
  ctx.fillText(d.name, CARD_W / 2, 66);

  // Rules text: shrink until it fits the text box (Mods can add long lines).
  ctx.textBaseline = 'alphabetic';
  /** @type {string[]} */
  let rows = [];
  let lineHeight = 15;
  for (const [size, lh, maxRows] of [
    [13, 15, 5],
    [12, 13, 6],
    [11, 12, 7],
  ]) {
    ctx.font = FONT.ui(size);
    rows = cardRulesText(d).flatMap((line) => wrapText(ctx, line, CARD_W - 24));
    lineHeight = lh;
    if (rows.length <= maxRows) break;
  }
  rows.slice(0, 7).forEach((row, i) => {
    ctx.fillStyle = row.startsWith('[') ? '#9a9a9a' : '#e4d6b8';
    ctx.fillText(row, CARD_W / 2, 186 + i * lineHeight);
  });

  // Footer: weight/capacity and verb.
  ctx.font = FONT.mono(11);
  ctx.textAlign = 'left';
  ctx.fillStyle = d.overclock > 0 ? '#ffb070' : '#a89878';
  ctx.fillText(`WT ${d.weight}/${d.capacity}`, 16, CARD_H - 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#a89878';
  ctx.fillText(verb.label, CARD_W - 16, CARD_H - 16);
  ctx.globalAlpha = 1;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {SlagView} view
 */
function paintSlag(ctx, view) {
  ctx.globalAlpha = view.affordable || view.cost === null ? 1 : 0.6;
  roundRect(ctx, 4, 4, CARD_W - 8, CARD_H - 8, 14);
  ctx.fillStyle = '#2b2622';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#6a5a4a';
  ctx.setLineDash([8, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Dripping ingot.
  ctx.fillStyle = '#7a4a2a';
  ctx.beginPath();
  ctx.moveTo(60, 120);
  ctx.lineTo(140, 120);
  ctx.lineTo(125, 85);
  ctx.lineTo(75, 85);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(95, 120, 6, 18);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d8c8b0';
  ctx.font = FONT.ui(17, 700);
  ctx.fillText(view.name, CARD_W / 2, 40);
  if (view.cost !== null) {
    ctx.font = FONT.ui(20, 700);
    ctx.fillStyle = '#9fe0ff';
    ctx.fillText(String(view.cost), 30, 31);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.font = FONT.ui(13);
  ctx.fillStyle = '#c8b8a0';
  wrapText(ctx, view.text, CARD_W - 26)
    .slice(0, 7)
    .forEach((row, i) => ctx.fillText(row, CARD_W / 2, 170 + i * 16));
  ctx.font = FONT.mono(11);
  ctx.fillStyle = '#8a7a68';
  ctx.fillText('SLAG', CARD_W / 2, CARD_H - 16);
  ctx.globalAlpha = 1;
}

/**
 * Desaturates a layer inside `path` and adds static noise (GDD §3.6).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Path2D} path
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function greyOut(ctx, path, x, y, w, h) {
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = 'rgba(70, 70, 70, 0.82)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(200, 200, 200, 0.35)';
  for (let i = 0; i < 40; i++) {
    // Deterministic noise so cached images are stable.
    const nx = x + ((i * 37) % w);
    const ny = y + ((i * 53) % h);
    ctx.fillRect(nx, ny, 3, 1);
  }
  ctx.strokeStyle = 'rgba(30, 30, 30, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 4);
  ctx.lineTo(x + w - 4, y + h - 4);
  ctx.stroke();
  ctx.restore();
}

/**
 * @param {Path2D} path
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 */
function hexagon(path, cx, cy, r) {
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
}
