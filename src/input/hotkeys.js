// @ts-check
/**
 * Default combat key bindings (GDD §3.2). Kept as data so a settings screen
 * can rebind them later.
 */
export const DEFAULT_BINDINGS = Object.freeze({
  endTurn: [' '],
  cancel: ['Escape'],
  confirm: ['Enter'],
  prevTarget: ['q', 'Q', 'ArrowLeft'],
  nextTarget: ['e', 'E', 'ArrowRight'],
  viewDraw: ['d', 'D'],
  viewDiscard: ['f', 'F'],
  viewExhaust: ['x', 'X'],
  explode: ['Alt'],
  retry: ['r', 'R'],
  next: ['n', 'N'],
});

/**
 * Maps a key to a hand index for the number-row hotkeys (1-9, then 0 for the 10th card).
 * @param {string} key
 * @returns {number | null}
 */
export function handIndexForKey(key) {
  if (key >= '1' && key <= '9' && key.length === 1) return Number(key) - 1;
  if (key === '0') return 9;
  return null;
}

/**
 * @param {Record<string, readonly string[]>} bindings
 * @param {string} key
 * @returns {string | null} the action bound to `key`
 */
export function actionForKey(bindings, key) {
  for (const [action, keys] of Object.entries(bindings)) if (keys.includes(key)) return action;
  return null;
}
