// @ts-check
import { GAUNTLET } from '../game/run/gauntlet.js';
import { LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, fillRound, label } from '../render/draw.js';

/**
 * Run-level header shown on every non-combat run screen: node progress,
 * HP, Aether, and deck size.
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('../game/run/run.js').Run} run
 * @param {string} title
 */
export function drawRunHeader(ctx, run, title) {
  const s = run.state;
  fillRound(ctx, 0, 0, LOGICAL_WIDTH, 110, 0, 'rgba(10, 8, 6, 0.7)');
  label(ctx, 40, 58, title, { font: FONT.title(40) });
  label(
    ctx,
    42,
    90,
    `Gauntlet node ${Math.min(s.step + 1, GAUNTLET.length)}/${GAUNTLET.length} · seed ${s.seed}`,
    {
      font: FONT.mono(15),
      color: '#8a7a60',
    },
  );

  // Node pips.
  GAUNTLET.forEach((step, i) => {
    const x = 520 + i * 54;
    const done = i < s.step;
    const current = i === s.step;
    ctx.beginPath();
    if (step.type === 'workbench') ctx.rect(x - 11, 44, 22, 22);
    else ctx.arc(x, 55, step.type === 'combat' && step.pool === 'elite' ? 14 : 11, 0, Math.PI * 2);
    ctx.fillStyle = done ? '#6a5a3a' : current ? '#ffd27a' : '#2a2218';
    ctx.fill();
    ctx.strokeStyle = step.type === 'combat' && step.pool === 'elite' ? '#ff8a6a' : '#8a6a3a';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (i < GAUNTLET.length - 1) {
      ctx.fillStyle = '#4a3a24';
      ctx.fillRect(x + 15, 54, 24, 3);
    }
  });

  // HP bar.
  const hx = 1000;
  fillRound(ctx, hx, 38, 300, 26, 8, '#2a1a18');
  fillRound(ctx, hx, 38, (300 * s.hp) / s.maxHp, 26, 8, '#b8322a');
  label(ctx, hx + 150, 58, `HP ${s.hp}/${s.maxHp}`, {
    font: FONT.ui(17, 700),
    align: 'center',
    color: '#fff4e0',
  });
  label(ctx, 1340, 60, `◆ ${s.aether} Aether`, { font: FONT.ui(22, 700), color: '#ffd27a' });
  label(ctx, 1560, 60, `Deck ${s.deck.length}`, { font: FONT.ui(20, 600) });
  label(ctx, 1700, 60, `Cargo ${s.cargo.items.length}/${s.cargo.slots}`, {
    font: FONT.ui(20, 600),
  });
}
