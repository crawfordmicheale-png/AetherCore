// @ts-check
import { LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, fillRound, label } from '../render/draw.js';

/** Map node presentation: label, glyph, and color (shape + letter, so it reads without color). */
export const NODE_STYLE = Object.freeze({
  combat: { name: 'Scrap Heap', glyph: '⚔', color: '#c8a070' },
  elite: { name: 'Elite Wreck', glyph: '☠', color: '#ff7a5a' },
  workbench: { name: 'Workbench', glyph: '⚒', color: '#ffd27a' },
  smelter: { name: 'Smelter', glyph: '◆', color: '#7ad0ff' },
  event: { name: 'Anomaly', glyph: '?', color: '#c08aff' },
  boss: { name: 'The Crucible Engine', glyph: '⚙', color: '#ff4a2a' },
});

/**
 * Run-level header shown on every non-combat run screen: Stratum progress,
 * HP, Aether, deck size, Cargo, and Blueprints.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../game/run/run.js').Run} run
 * @param {string} title
 */
export function drawRunHeader(ctx, run, title) {
  const s = run.state;
  fillRound(ctx, 0, 0, LOGICAL_WIDTH, 110, 0, 'rgba(10, 8, 6, 0.7)');
  label(ctx, 40, 58, title, { font: FONT.title(40) });
  const row = run.node ? run.node.row + 1 : 0;
  label(ctx, 42, 90, `Stratum 1 · The Foundry Floor · row ${row}/${s.map.rows} · seed ${s.seed}`, {
    font: FONT.mono(15),
    color: '#8a7a60',
  });

  // Stratum progress bar.
  const px = 600;
  const pw = 340;
  fillRound(ctx, px, 50, pw, 10, 5, '#2a2218');
  fillRound(ctx, px, 50, (pw * row) / s.map.rows, 10, 5, '#ffd27a');
  label(ctx, px + pw + 14, 60, '⚙', { font: FONT.ui(20, 700), color: '#ff4a2a' });

  // HP bar.
  const hx = 1000;
  fillRound(ctx, hx, 38, 280, 26, 8, '#2a1a18');
  fillRound(ctx, hx, 38, (280 * s.hp) / s.maxHp, 26, 8, '#b8322a');
  label(ctx, hx + 140, 58, `HP ${s.hp}/${s.maxHp}`, {
    font: FONT.ui(17, 700),
    align: 'center',
    color: '#fff4e0',
  });
  label(ctx, 1310, 60, `◆ ${s.aether}`, { font: FONT.ui(22, 700), color: '#ffd27a' });
  label(ctx, 1430, 60, `Deck ${s.deck.length}`, { font: FONT.ui(20, 600) });
  label(ctx, 1560, 60, `Cargo ${s.cargo.items.length}/${s.cargo.slots}`, {
    font: FONT.ui(20, 600),
  });
  label(ctx, 1730, 60, `Blueprints ${s.blueprints.length}`, {
    font: FONT.ui(20, 600),
    color: '#9fe0ff',
  });
}
