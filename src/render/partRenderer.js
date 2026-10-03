// @ts-check
/**
 * Draws a single component (Frame, Core, or Mod) as a tile, for the loot
 * tray, Cargo Hold, and Workbench sockets.
 */
import { riderFor } from '../game/model/card.js';
import { riderText } from '../game/model/cardText.js';
import { ELEMENT_STYLE, FONT, fillRound, label, wrapText } from './draw.js';

export const PART_W = 168;
export const PART_H = 104;

export const TIER_COLORS = {
  starter: '#7a6a5a',
  salvage: '#a8a090',
  refined: '#5ab0ff',
  prototype: '#d08aff',
};
const KIND_FILL = { frame: '#3a2e22', core: '#22303a', mod: '#3a3222' };

/**
 * One-line stat summary for a part.
 * @param {import('../game/core/registry.js').Registry} registry
 * @param {import('../game/model/card.js').ComponentInstance} part
 */
export function partSummary(registry, part) {
  const def = registry.get(part.defId);
  const kind = registry.kindOf(part.defId);
  const weight = Math.max(0, (def.weight ?? 0) - (part.tuned ? 1 : 0));
  if (kind === 'frame') {
    const cap = def.capacity + (part.capacityBonus ?? 0);
    if (def.verb === 'utility') return `Cost ${def.cost} · Cap ${cap} · Utility`;
    const target = def.target === 'all' ? ' · ALL' : def.target === 'random' ? ' · random' : '';
    return `Cost ${def.cost} · Cap ${cap} · ${def.verb === 'attack' ? 'Dmg' : 'Blk'} ${def.base}${def.hits > 1 ? `×${def.hits}` : ''}${target}`;
  }
  if (kind === 'core') {
    const rider = def.riderless ? null : riderFor(def.element, 'attack', def.rider);
    return `Power ${def.power} · Wt ${weight}${rider ? ` · ${riderText(rider).split(' (')[0]}` : ''}`;
  }
  return `Wt ${weight} · ${def.text}`;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../game/core/registry.js').Registry} registry
 * @param {import('../game/model/card.js').ComponentInstance} part
 * @param {number} x
 * @param {number} y
 * @param {{ selected?: boolean, dim?: boolean, hover?: boolean, badge?: string }} [opts]
 */
export function drawPart(ctx, registry, part, x, y, opts = {}) {
  const def = registry.get(part.defId);
  const kind = /** @type {'frame' | 'core' | 'mod'} */ (registry.kindOf(part.defId));
  ctx.save();
  ctx.globalAlpha = opts.dim ? 0.45 : 1;
  fillRound(ctx, x, y, PART_W, PART_H, 10, KIND_FILL[kind]);
  ctx.lineWidth = opts.selected ? 4 : 2;
  ctx.strokeStyle = opts.selected ? '#ffd27a' : opts.hover ? '#e8c070' : '#6a5030';
  ctx.stroke();
  // Tier stripe.
  fillRound(
    ctx,
    x,
    y,
    8,
    PART_H,
    4,
    TIER_COLORS[/** @type {keyof typeof TIER_COLORS} */ (def.tier)],
  );

  const kindLabel = kind.toUpperCase();
  label(ctx, x + 16, y + 20, kindLabel, { font: FONT.mono(11), color: '#a89878' });
  label(ctx, x + PART_W - 8, y + 20, def.tier === 'starter' ? 'starter' : def.tier, {
    font: FONT.mono(11),
    color: TIER_COLORS[/** @type {keyof typeof TIER_COLORS} */ (def.tier)],
    align: 'right',
  });
  if (kind === 'core') {
    const el = ELEMENT_STYLE[/** @type {keyof typeof ELEMENT_STYLE} */ (def.element)];
    ctx.beginPath();
    ctx.arc(x + PART_W - 20, y + 39, 11, 0, Math.PI * 2);
    ctx.fillStyle = el.color;
    ctx.fill();
    label(ctx, x + PART_W - 20, y + 44, el.glyph, {
      font: FONT.ui(14, 700),
      color: '#1a1410',
      align: 'center',
    });
  }
  ctx.font = FONT.ui(16, 700);
  let name = def.name;
  while (ctx.measureText(name).width > PART_W - (kind === 'core' ? 60 : 28) && name.length > 4)
    name = `${name.slice(0, -2)}…`;
  label(ctx, x + 16, y + 44, name, { font: FONT.ui(16, 700) });

  ctx.font = FONT.ui(12);
  const lines = wrapText(ctx, partSummary(registry, part), PART_W - 24).slice(0, 3);
  lines.forEach((line, i) =>
    label(ctx, x + 16, y + 66 + i * 14, line, { font: FONT.ui(12), color: '#cbbd9e' }),
  );

  const tags = [part.tuned ? 'TUNED' : '', part.rusted ? 'RUSTED' : '', opts.badge ?? '']
    .filter(Boolean)
    .join(' · ');
  if (tags)
    label(ctx, x + PART_W - 8, y + PART_H - 6, tags, {
      font: FONT.mono(10),
      color: '#e0a060',
      align: 'right',
    });
  ctx.restore();
}
