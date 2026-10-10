// @ts-check
/**
 * Procedural Stratum map (GDD §4.2): a lattice of nodes joined by upward
 * conveyor paths that never cross. Pure: same RNG state, same map.
 */

/**
 * @typedef {'combat' | 'elite' | 'workbench' | 'smelter' | 'event' | 'boss'} NodeType
 * @typedef {{ id: string, row: number, col: number, type: NodeType, pool?: string, next: string[] }} MapNode
 * @typedef {{ rows: number, cols: number, nodes: Record<string, MapNode>, start: string[], boss: string }} StratumMap
 */

export const MAP_DEFAULTS = Object.freeze({ rows: 15, cols: 7, paths: 6 });

/** Node weights for rows without fixed rules (GDD §4.2). */
export const NODE_WEIGHTS = Object.freeze({
  combat: 45,
  event: 18,
  workbench: 14,
  elite: 12,
  smelter: 11,
});

/** Earliest row (0-based) each type may appear on. */
const MIN_ROW = { combat: 0, event: 1, workbench: 1, elite: 4, smelter: 2 };
/** Combats on these early rows draw from the easy encounter pool. */
const EASY_ROWS = 3;

/** @param {number} row @param {number} col */
const nodeId = (row, col) => `n${row}_${col}`;

/**
 * @param {import('../core/rng.js').Rng} rng
 * @param {{ rows?: number, cols?: number, paths?: number }} [opts]
 * @returns {StratumMap}
 */
export function generateMap(rng, opts = {}) {
  const { rows, cols, paths } = { ...MAP_DEFAULTS, ...opts };
  const lastRow = rows - 2; // the final row holds only the boss
  const workbenchRows = new Set([Math.floor(rows / 2), lastRow]);

  // --- Paths ------------------------------------------------------------------
  /** @type {Map<string, Set<string>>} edges from a node id to the ids it leads to */
  const edges = new Map();
  /** @type {Array<Array<[number, number]>>} edges per row as [fromCol, toCol] */
  const rowEdges = Array.from({ length: rows }, () => /** @type {Array<[number, number]>} */ ([]));
  const crosses = (/** @type {number} */ r, /** @type {number} */ c, /** @type {number} */ d) =>
    rowEdges[r].some(([a, b]) => (a < c && b > d) || (a > c && b < d));

  /** @type {number[]} */
  const starts = [];
  for (let p = 0; p < paths; p++) {
    // The first two paths start in different columns so the first choice is real.
    let col = rng.int(0, cols - 1);
    if (p === 1) while (col === starts[0]) col = rng.int(0, cols - 1);
    starts.push(col);
    for (let r = 0; r < lastRow; r++) {
      const options = [col - 1, col, col + 1].filter(
        (d) => d >= 0 && d < cols && !crosses(r, col, d),
      );
      // A straight step can still cross a diagonal; reuse an existing edge from here if so.
      const existing = rowEdges[r].filter(([a]) => a === col).map(([, b]) => b);
      const next = options.length ? rng.pick(options) : (existing[0] ?? col);
      const from = nodeId(r, col);
      const to = nodeId(r + 1, next);
      if (!edges.has(from)) edges.set(from, new Set());
      const set = /** @type {Set<string>} */ (edges.get(from));
      if (!set.has(to)) {
        set.add(to);
        rowEdges[r].push([col, next]);
      }
      col = next;
    }
  }

  // --- Nodes ------------------------------------------------------------------
  /** @type {Record<string, MapNode>} */
  const nodes = {};
  const boss = `n${rows - 1}_boss`;
  const ensure = (/** @type {string} */ id) => {
    if (!nodes[id]) {
      const [, r, c] = /** @type {RegExpMatchArray} */ (id.match(/^n(\d+)_(\d+)$/));
      nodes[id] = { id, row: Number(r), col: Number(c), type: 'combat', next: [] };
    }
    return nodes[id];
  };
  for (const [from, tos] of edges) {
    const node = ensure(from);
    for (const to of tos) {
      ensure(to);
      node.next.push(to);
    }
  }
  for (const node of Object.values(nodes)) {
    node.next.sort();
    if (node.row === lastRow) node.next = [boss];
  }
  nodes[boss] = {
    id: boss,
    row: rows - 1,
    col: Math.floor(cols / 2),
    type: 'boss',
    pool: 'boss',
    next: [],
  };

  /** @type {Map<string, string[]>} */
  const parents = new Map();
  for (const node of Object.values(nodes)) {
    for (const child of node.next) parents.set(child, [...(parents.get(child) ?? []), node.id]);
  }
  const ancestorsWithin = (/** @type {string} */ id, /** @type {number} */ depth) => {
    /** @type {Set<string>} */
    const out = new Set();
    let frontier = [id];
    for (let d = 0; d < depth; d++) {
      frontier = frontier.flatMap((n) => parents.get(n) ?? []);
      for (const n of frontier) out.add(n);
    }
    return [...out].map((n) => nodes[n]);
  };

  // --- Types (assigned row by row, so parents are already typed) -------------
  const ordered = Object.values(nodes)
    .filter((n) => n.type !== 'boss')
    .sort((a, b) => a.row - b.row || a.col - b.col);
  for (const node of ordered) {
    if (node.row === 0) node.type = 'combat';
    else if (workbenchRows.has(node.row)) node.type = 'workbench';
    else {
      const parentTypes = new Set((parents.get(node.id) ?? []).map((p) => nodes[p].type));
      const nextRowIsWorkbench = workbenchRows.has(node.row + 1);
      const eliteNearby = ancestorsWithin(node.id, 3).some((n) => n.type === 'elite');
      const allowed = /** @type {NodeType[]} */ (Object.keys(NODE_WEIGHTS)).filter((type) => {
        if (node.row < MIN_ROW[/** @type {keyof typeof MIN_ROW} */ (type)]) return false;
        // No two Workbenches (or Smelters) in a row along a path.
        if ((type === 'workbench' || type === 'smelter') && parentTypes.has(type)) return false;
        if (type === 'workbench' && nextRowIsWorkbench) return false;
        // At most one Elite per four-row stretch of a path.
        if (type === 'elite' && eliteNearby) return false;
        return true;
      });
      node.type = rng.weighted(
        allowed,
        (t) => NODE_WEIGHTS[/** @type {keyof typeof NODE_WEIGHTS} */ (t)],
      );
    }
    if (node.type === 'combat') node.pool = node.row < EASY_ROWS ? 'easy' : 'normal';
    if (node.type === 'elite') node.pool = 'elite';
  }

  const start = [...new Set(starts)].map((c) => nodeId(0, c)).sort();
  return { rows, cols, nodes, start, boss };
}

/**
 * Every node reachable from the start row (sanity checks and tests).
 * @param {StratumMap} map
 */
export function reachable(map) {
  /** @type {Set<string>} */
  const seen = new Set();
  const stack = [...map.start];
  while (stack.length) {
    const id = /** @type {string} */ (stack.pop());
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...map.nodes[id].next);
  }
  return seen;
}
