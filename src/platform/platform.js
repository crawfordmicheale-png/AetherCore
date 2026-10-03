// @ts-check
/**
 * Persistence bridge (docs/TECHNICAL_DESIGN.md §8). In Electron, preload.cjs
 * exposes `window.aetherPlatform` backed by atomic file writes in userData.
 * In a plain browser (npm run dev) it falls back to localStorage.
 */

/** Files the game is allowed to persist. Mirrored in electron/main.js. */
export const SAVE_FILES = /** @type {const} */ (['settings.json', 'profile.json', 'run.json']);

/**
 * @typedef {object} Platform
 * @property {'electron' | 'browser'} kind
 * @property {(name: typeof SAVE_FILES[number]) => Promise<string | null>} load
 * @property {(name: typeof SAVE_FILES[number], text: string) => Promise<void>} save
 * @property {(name: typeof SAVE_FILES[number]) => Promise<void>} remove
 * @property {() => void} quit
 */

/** @returns {Platform} */
export function getPlatform() {
  const bridge = /** @type {any} */ (window).aetherPlatform;
  if (bridge) return { kind: 'electron', ...bridge };

  const key = (/** @type {string} */ name) => `aethercore:${name}`;
  return {
    kind: 'browser',
    load: async (name) => localStorage.getItem(key(name)),
    save: async (name, text) => localStorage.setItem(key(name), text),
    remove: async (name) => localStorage.removeItem(key(name)),
    quit: () => {},
  };
}
