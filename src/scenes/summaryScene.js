// @ts-check
import { deriveCard } from '../game/model/card.js';
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from '../render/canvas.js';
import { FONT, label } from '../render/draw.js';

/** End-of-run summary: result, stats, and the final deck. */
export class SummaryScene {
  /**
   * @param {object} opts
   * @param {import('../game/run/run.js').Run} opts.run
   * @param {() => void} opts.onDone
   */
  constructor({ run, onDone }) {
    this.run = run;
    this.onDone = onDone;
    this.time = 0;
  }

  /** @param {number} dt */
  update(dt) {
    this.time += dt;
  }

  /** @param {import('./sceneManager.js').InputEvent} event */
  onInput(event) {
    if (this.time < 0.8) return;
    if (
      (event.type === 'keydown' && (event.key === 'Enter' || event.key === 'Escape')) ||
      (event.type === 'pointerdown' && event.button === 0)
    ) {
      this.onDone();
    }
  }

  /** @param {import('../render/canvas.js').Stage} stage */
  render(stage) {
    for (const layer of /** @type {const} */ (['world', 'hand', 'fx', 'ui'])) stage.clear(layer);
    const bg = stage.ctx('bg');
    bg.fillStyle = '#0e0b09';
    bg.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    const ctx = stage.ctx('world');
    const s = this.run.state;
    const won = s.phase === 'won';
    label(ctx, LOGICAL_WIDTH / 2, 200, won ? 'GAUNTLET CLEARED' : 'RUN ENDED', {
      font: FONT.title(84),
      align: 'center',
      color: won ? '#ffd27a' : '#ff6a5a',
    });
    const lines = [
      `Combats won: ${s.stats.combatsWon}`,
      `HP: ${s.hp}/${s.maxHp}`,
      `Aether earned: ${s.stats.aetherEarned} (holding ${s.aether})`,
      `Cards assembled: ${s.stats.cardsAssembled} · Parts crushed: ${s.stats.partsCrushed}`,
    ];
    lines.forEach((line, i) =>
      label(ctx, LOGICAL_WIDTH / 2, 290 + i * 36, line, {
        font: FONT.ui(24),
        align: 'center',
        color: '#cbbd9e',
      }),
    );

    label(ctx, LOGICAL_WIDTH / 2, 470, `Final deck (${s.deck.length})`, {
      font: FONT.ui(24, 700),
      align: 'center',
    });
    const names = s.deck.map((card) => {
      const d = deriveCard(card, { registry: this.run.registry });
      return `${d.name}${card.mod ? ` + ${this.run.registry.get(card.mod.defId).name}` : ''}${d.overclock ? ' (Overclocked)' : ''}`;
    });
    const cols = 2;
    names.forEach((name, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      label(ctx, LOGICAL_WIDTH / 2 + (col === 0 ? -40 : 40), 515 + row * 30, name, {
        font: FONT.ui(19),
        align: col === 0 ? 'right' : 'left',
        color: '#e8d6b0',
      });
    });
    label(ctx, LOGICAL_WIDTH / 2, 1030, 'Press Enter to return to the title', {
      font: FONT.ui(20),
      align: 'center',
      color: '#8a7a60',
    });
  }
}
