// @ts-check
/**
 * Fixed-timestep update with variable-rate rendering (docs/TECHNICAL_DESIGN.md §3.1).
 * Game logic itself is command-driven; `update` drives tweens, particles, and timers.
 */

export const STEP_SECONDS = 1 / 60;
const MAX_FRAME_SECONDS = 0.25; // avoid a spiral of death after tab switches or breakpoints

/**
 * @param {{ update: (dt: number) => void, render: (alpha: number) => void }} handlers
 * @returns {{ stop: () => void, fps: () => number }}
 */
export function startLoop({ update, render }) {
  let last = performance.now();
  let accumulator = 0;
  let running = true;
  let frames = 0;
  let fpsWindowStart = last;
  let fps = 0;

  /** @param {number} now */
  function frame(now) {
    if (!running) return;
    accumulator += Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
    last = now;
    while (accumulator >= STEP_SECONDS) {
      update(STEP_SECONDS);
      accumulator -= STEP_SECONDS;
    }
    render(accumulator / STEP_SECONDS);

    frames++;
    if (now - fpsWindowStart >= 1000) {
      fps = (frames * 1000) / (now - fpsWindowStart);
      frames = 0;
      fpsWindowStart = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    stop: () => {
      running = false;
    },
    fps: () => fps,
  };
}
