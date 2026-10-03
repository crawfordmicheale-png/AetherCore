// @ts-check
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_KINDS } from '../src/game/core/content.js';

export const DATA_DIR = fileURLToPath(new URL('../src/data/', import.meta.url));

/**
 * Reads every content file from src/data/ into a bundle keyed by kind.
 * @param {string} [dir]
 * @returns {Promise<import('../src/game/core/content.js').ContentBundle>}
 */
export async function loadContentFromDisk(dir = DATA_DIR) {
  /** @type {import('../src/game/core/content.js').ContentBundle} */
  const bundle = {};
  for (const [kind, { file }] of Object.entries(CONTENT_KINDS)) {
    const text = await readFile(join(dir, file), 'utf8');
    try {
      bundle[kind] = JSON.parse(text);
    } catch (err) {
      throw new Error(`${file}: invalid JSON (${/** @type {Error} */ (err).message})`);
    }
  }
  return bundle;
}
