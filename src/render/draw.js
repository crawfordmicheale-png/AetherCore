// @ts-check
/** Small Canvas 2D drawing helpers shared by scenes and widgets. */

export const FONT = {
  ui: (/** @type {number} */ size, weight = 400) =>
    `${weight} ${size}px "Segoe UI", system-ui, sans-serif`,
  title: (/** @type {number} */ size) => `600 ${size}px Georgia, serif`,
  mono: (/** @type {number} */ size) => `${size}px ui-monospace, monospace`,
};

/** Element colors (GDD §7.1) plus their colorblind-safe glyphs. */
export const ELEMENT_STYLE = {
  kinetic: { color: '#b8bcc4', glyph: '■', label: 'Kinetic' },
  thermal: { color: '#e8743a', glyph: '▲', label: 'Thermal' },
  voltaic: { color: '#3ad1e8', glyph: 'ϟ', label: 'Voltaic' },
  aether: { color: '#a77bf0', glyph: '◆', label: 'Aether' },
  cryo: { color: '#9fd4ff', glyph: '❄', label: 'Cryo' },
};

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Word-wraps `text` to `maxWidth`, returning the lines.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxWidth
 */
export function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  /** @type {string[]} */
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {string} text
 * @param {{ font?: string, color?: string, align?: CanvasTextAlign, baseline?: CanvasTextBaseline }} [opts]
 */
export function label(ctx, x, y, text, opts = {}) {
  ctx.font = opts.font ?? FONT.ui(18);
  ctx.fillStyle = opts.color ?? '#e8d6b0';
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = opts.baseline ?? 'alphabetic';
  ctx.fillText(text, x, y);
}

/**
 * A panel with a title and body lines; returns its height. Used for tooltips.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {{ title: string, lines: Array<string | { text: string, color?: string }> }} content
 */
export function panel(ctx, x, y, w, content) {
  ctx.font = FONT.ui(16);
  /** @type {Array<{ text: string, color?: string }>} */
  const rows = [];
  for (const line of content.lines) {
    const item = typeof line === 'string' ? { text: line } : line;
    for (const wrapped of wrapText(ctx, item.text, w - 28))
      rows.push({ text: wrapped, color: item.color });
  }
  const h = 46 + rows.length * 22 + 8;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = 'rgba(16, 13, 10, 0.94)';
  ctx.fill();
  ctx.strokeStyle = '#8a6a3a';
  ctx.lineWidth = 2;
  ctx.stroke();
  label(ctx, x + 14, y + 30, content.title, { font: FONT.ui(19, 600) });
  rows.forEach((row, i) =>
    label(ctx, x + 14, y + 58 + i * 22, row.text, {
      font: FONT.ui(16),
      color: row.color ?? '#cbbd9e',
    }),
  );
  return h;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {string} fill
 */
export function fillRound(ctx, x, y, w, h, r, fill) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {number} px
 * @param {number} py
 */
export function inRect(rect, px, py) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}
