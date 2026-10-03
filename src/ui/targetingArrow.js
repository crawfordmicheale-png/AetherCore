// @ts-check
/**
 * Bézier targeting arrow (docs/TECHNICAL_DESIGN.md §6.3): a quadratic curve
 * from the card to the cursor, drawn as animated chevrons.
 */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x: number, y: number }} from
 * @param {{ x: number, y: number }} to
 * @param {{ color: string, time: number }} opts
 */
export function drawTargetingArrow(ctx, from, to, { color, time }) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const cp = { x: mx, y: my - dist * 0.4 };

  /** @param {number} t */
  const point = (t) => ({
    x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cp.x + t * t * to.x,
    y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cp.y + t * t * to.y,
  });
  /** @param {number} t */
  const tangent = (t) =>
    Math.atan2(
      2 * (1 - t) * (cp.y - from.y) + 2 * t * (to.y - cp.y),
      2 * (1 - t) * (cp.x - from.x) + 2 * t * (to.x - cp.x),
    );

  const segments = Math.max(4, Math.floor(dist / 34));
  const phase = (time * 1.6) % 1;
  ctx.fillStyle = color;
  for (let i = 0; i < segments; i++) {
    const t = (i + phase) / segments;
    if (t > 0.97) continue;
    const p = point(t);
    drawChevron(ctx, p.x, p.y, tangent(t), 7 + t * 7);
  }
  // Arrowhead at the cursor.
  drawChevron(ctx, to.x, to.y, tangent(1), 18);
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} angle
 * @param {number} size
 */
function drawChevron(ctx, x, y, angle, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.75);
  ctx.lineTo(-size * 0.2, 0);
  ctx.lineTo(-size * 0.7, size * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
