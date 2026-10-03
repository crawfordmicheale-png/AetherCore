// @ts-check
// Validates src/data/*.json (docs/TECHNICAL_DESIGN.md §4.4). Exits non-zero on problems.
import { validateContent } from '../src/game/core/content.js';
import { loadContentFromDisk } from './load-content.js';

try {
  const bundle = await loadContentFromDisk();
  const problems = validateContent(bundle);
  if (problems.length > 0) {
    console.error(`Content validation failed with ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const counts = Object.entries(bundle)
    .map(([kind, defs]) => `${defs.length} ${kind}`)
    .join(', ');
  console.log(`Content OK: ${counts}`);
} catch (err) {
  console.error(/** @type {Error} */ (err).message);
  process.exit(1);
}
