// @ts-check
/**
 * Balance simulator v1 (docs/TECHNICAL_DESIGN.md §9): a scripted bot plays
 * full Stratum runs headlessly and reports where runs are won and lost.
 *
 *   node tools/simulate.js --runs 200 [--seed SIM] [--deck starter|sandbox] [--json]
 *
 * The bot is deliberately simple (greedy, no lookahead). Its win rate is a
 * floor for a careful player; what matters is how numbers move between builds.
 */
import { Registry } from '../src/game/core/registry.js';
import { Rng } from '../src/game/core/rng.js';
import { deriveCard } from '../src/game/model/card.js';
import { Run, RunError } from '../src/game/run/run.js';
import { loadContentFromDisk } from './load-content.js';

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ runs: number, seed: string, deck: 'starter' | 'sandbox', json: boolean, quiet: boolean }} */
  const opts = { runs: 100, seed: 'SIM', deck: 'starter', json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runs') opts.runs = Number(argv[++i]);
    else if (arg === '--seed') opts.seed = argv[++i];
    else if (arg === '--deck') opts.deck = /** @type {'starter' | 'sandbox'} */ (argv[++i]);
    else if (arg === '--json') opts.json = true;
    else if (arg === '--quiet') opts.quiet = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1)
    throw new Error('--runs must be a positive integer');
  return opts;
}

// ---------------------------------------------------------------------------
// Bot policy
// ---------------------------------------------------------------------------

/**
 * Plays one combat greedily: block when the incoming hit is bigger than
 * current Block, otherwise attack the weakest enemy.
 * @param {import('../src/game/combat/combat.js').Combat} c
 */
function playCombat(c) {
  for (let guard = 0; guard < 2000 && !c.over; guard++) {
    const incoming = c
      .aliveEnemies()
      .map((e) => c.intentOf(e.uid))
      .reduce((n, i) => n + (i?.damage ?? 0) * (i?.hits ?? 1), 0);
    const playable = c.state.piles.hand.filter((uid) => c.canPlay(uid).ok);
    if (playable.length === 0) {
      c.endTurn();
      continue;
    }
    const target = [...c.aliveEnemies()].sort((a, b) => a.hp - b.hp)[0]?.uid ?? null;
    // Molten Slag in hand punishes Kinetic plays; a sensible player avoids them.
    const molten = c.state.piles.hand.filter((u) => {
      const x = c.state.cards[u];
      return x.kind === 'slag' && x.defId === 'slag_molten';
    }).length;
    const score = (/** @type {string} */ uid) => {
      const card = c.state.cards[uid];
      if (card.kind === 'slag') return 1; // Sludge: clear it when nothing better
      const d = c.derive(uid, c.needsTarget(uid) ? target : null);
      if (molten && d.element === 'kinetic' && c.state.player.hp <= molten * 3 + 5) return -1;
      const value = d.valuePerHit * d.hits + (d.rider?.stacks ?? 0) * 2 + d.draw * 3;
      const wantsBlock = incoming > c.state.player.block;
      const bias = d.verb === 'defend' ? (wantsBlock ? 2 : 0.3) : 1;
      return (value * bias) / Math.max(1, d.cost) + d.onPlay.length;
    };
    const best = playable.sort((a, b) => score(b) - score(a))[0];
    if (score(best) < 0) {
      c.endTurn();
      continue;
    }
    c.playCard(best, c.needsTarget(best) ? target : null);
  }
}

/**
 * Spends Workbench charges on simple upgrades: heavier Cores into Scrap
 * cards, then Mods onto cards without one. Repairs instead when hurt.
 * @param {Run} run
 */
function useWorkbench(run) {
  const s = run.state;
  if (s.hp < s.maxHp * 0.5) {
    try {
      run.fieldRepair();
    } catch {
      /* already used a charge */
    }
    return;
  }
  const kind = (/** @type {string} */ id) => run.registry.kindOf(id);
  const power = (/** @type {string} */ id) => run.registry.get(id).power ?? 0;
  for (let guard = 0; guard < 10 && run.chargesLeft > 0; guard++) {
    let did = false;
    // Assemble a new card when Cargo has a Frame and a Core that fit together.
    const frames = s.cargo.items.filter((p) => kind(p.defId) === 'frame');
    for (const frame of frames) {
      const core = s.cargo.items
        .filter((p) => kind(p.defId) === 'core')
        .sort((a, b) => power(b.defId) - power(a.defId))
        .find(
          (c) =>
            deriveCard(
              { uid: 'x', frame: Run.socketed(frame), core: Run.socketed(c) },
              { registry: run.registry },
            ).overclock === 0,
        );
      if (core) {
        run.assemble({
          frame: /** @type {string} */ (frame.uid),
          core: /** @type {string} */ (core.uid),
        });
        did = true;
        break;
      }
    }
    if (did) continue;
    const cores = s.cargo.items
      .filter((p) => kind(p.defId) === 'core')
      .sort((a, b) => power(b.defId) - power(a.defId));
    const mods = s.cargo.items.filter((p) => kind(p.defId) === 'mod');
    for (const core of cores) {
      const target = [...s.deck]
        .filter((c) => power(c.core.defId) < power(core.defId))
        .sort((a, b) => power(a.core.defId) - power(b.core.defId))
        .find(
          (c) =>
            deriveCard({ ...c, core: Run.socketed(core) }, { registry: run.registry }).overclock ===
            0,
        );
      if (target) {
        run.modify(target.uid, { core: /** @type {string} */ (core.uid) });
        did = true;
        break;
      }
    }
    if (!did) {
      for (const mod of mods) {
        const target = s.deck.find(
          (c) =>
            !c.mod &&
            deriveCard({ ...c, mod: Run.socketed(mod) }, { registry: run.registry }).overclock ===
              0,
        );
        if (target) {
          run.modify(target.uid, { mod: /** @type {string} */ (mod.uid) });
          did = true;
          break;
        }
      }
    }
    if (!did) break;
  }
}

/**
 * @param {Run} run
 * @param {Rng} rng
 */
function chooseNode(run, rng) {
  const s = run.state;
  const options = run.availableNodes().map((id) => s.map.nodes[id]);
  const hurt = s.hp < s.maxHp * 0.55;
  const weight = (/** @type {import('../src/game/run/map.js').MapNode} */ n) => {
    if (n.type === 'workbench') return hurt ? 6 : 2;
    if (n.type === 'elite') return hurt ? 0.2 : 1.5;
    if (n.type === 'smelter') return s.aether >= 60 ? 2 : 0.5;
    return 1;
  };
  return rng.weighted(options, weight).id;
}

/**
 * @param {Registry} registry
 * @param {string} seed
 * @param {'starter' | 'sandbox'} deck
 */
function playRun(registry, seed, deck) {
  const run = Run.create({ registry, chassisId: 'chassis_tinker', seed, deck });
  const rng = Rng.fromSeed(`${seed}:bot`);
  /** @type {Array<{ encounterId: string, kind: string, hpLost: number, turns: number }>} */
  const fights = [];
  let acquired = 0;
  for (let guard = 0; guard < 500 && !run.over; guard++) {
    const s = run.state;
    switch (s.phase) {
      case 'map':
        run.travel(chooseNode(run, rng));
        break;
      case 'combat': {
        const before = s.hp;
        const combat = run.startCombat();
        playCombat(combat);
        const turns = combat.state.turn;
        const encounterId = /** @type {string} */ (s.encounterId);
        run.finishCombat();
        fights.push({
          encounterId,
          kind: registry.get(encounterId).kind,
          hpLost: before - s.hp,
          turns,
        });
        break;
      }
      case 'loot': {
        const loot = /** @type {NonNullable<typeof s.loot>} */ (s.loot);
        if (loot.blueprints?.length) run.takeBlueprint(loot.blueprints[0]);
        if (loot.pick?.length) {
          if (run.cargoFree <= 0) run.crush(/** @type {string} */ (s.cargo.items[0].uid));
          run.choosePick(/** @type {string} */ (loot.pick[0].uid));
          acquired++;
        }
        for (const item of [...loot.items]) {
          if (run.cargoFree > 0) {
            run.takeLoot(/** @type {string} */ (item.uid));
            acquired++;
          } else run.crush(/** @type {string} */ (item.uid));
        }
        run.leaveLoot();
        break;
      }
      case 'workbench':
        useWorkbench(run);
        run.leaveWorkbench();
        break;
      case 'smelter': {
        const offers = s.smelter?.offers ?? [];
        for (const o of offers) {
          if (s.aether - run.smelterPrice(o.price) < 30 || run.cargoFree <= 0) continue;
          if (run.registry.kindOf(o.defId) === 'frame') continue;
          run.buy(o.uid);
          acquired++;
        }
        run.leaveSmelter();
        break;
      }
      case 'event': {
        const ev = registry.get(/** @type {any} */ (s.event).id);
        const choice = ev.choices.find((/** @type {any} */ c) => !run.eventChoiceBlocked(c.id));
        try {
          run.chooseEvent(choice.id, { cargoUid: s.cargo.items[0]?.uid });
        } catch (err) {
          if (!(err instanceof RunError)) throw err;
        }
        if (run.state.phase === 'event') run.leaveEvent();
        break;
      }
    }
  }
  return { run, fights, acquired };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const registry = new Registry(await loadContentFromDisk());
  const started = performance.now();

  let wins = 0;
  /** @type {Record<string, number>} */
  const deathsBy = {};
  /** @type {Record<string, { fights: number, hpLost: number, turns: number, deaths: number }>} */
  const byEncounter = {};
  let crushed = 0;
  let acquiredTotal = 0;
  let aether = 0;
  let cardsAssembled = 0;
  let blueprints = 0;
  let rowsReached = 0;

  for (let i = 0; i < opts.runs; i++) {
    const { run, fights, acquired } = playRun(registry, `${opts.seed}-${i}`, opts.deck);
    const s = run.state;
    if (s.phase === 'won') wins++;
    else {
      const last = fights.at(-1);
      const key = last ? last.encounterId : 'other';
      deathsBy[key] = (deathsBy[key] ?? 0) + 1;
    }
    fights.forEach((f, idx) => {
      const e = (byEncounter[f.encounterId] ??= { fights: 0, hpLost: 0, turns: 0, deaths: 0 });
      e.fights++;
      e.hpLost += f.hpLost;
      e.turns += f.turns;
      if (s.phase === 'lost' && idx === fights.length - 1) e.deaths++;
    });
    crushed += s.stats.partsCrushed;
    acquiredTotal += acquired;
    aether += s.stats.aetherEarned;
    cardsAssembled += s.stats.cardsAssembled;
    blueprints += s.blueprints.length;
    rowsReached += s.visited.length;
  }

  const n = opts.runs;
  const report = {
    runs: n,
    deck: opts.deck,
    winRate: wins / n,
    avgRowsReached: rowsReached / n,
    avgAetherEarned: aether / n,
    avgBlueprints: blueprints / n,
    avgCardsAssembled: cardsAssembled / n,
    crushRate: crushed / Math.max(1, crushed + acquiredTotal),
    deathsBy,
    encounters: Object.fromEntries(
      Object.entries(byEncounter)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, e]) => [
          id,
          {
            fights: e.fights,
            avgHpLost: +(e.hpLost / e.fights).toFixed(1),
            avgTurns: +(e.turns / e.fights).toFixed(1),
            deathRate: +(e.deaths / e.fights).toFixed(3),
          },
        ]),
    ),
    seconds: +((performance.now() - started) / 1000).toFixed(2),
  };

  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else if (!opts.quiet) {
    console.log(`AetherCore balance simulator: ${n} runs, ${opts.deck} deck, seed ${opts.seed}`);
    console.log(`  win rate            ${(report.winRate * 100).toFixed(1)}%`);
    console.log(`  rows reached (avg)  ${report.avgRowsReached.toFixed(1)} / ${15}`);
    console.log(`  Aether earned (avg) ${report.avgAetherEarned.toFixed(0)}`);
    console.log(`  Blueprints (avg)    ${report.avgBlueprints.toFixed(2)}`);
    console.log(`  crush rate          ${(report.crushRate * 100).toFixed(1)}%`);
    console.log('  encounter                 fights  HP lost  turns  death rate');
    for (const [id, e] of Object.entries(report.encounters)) {
      console.log(
        `  ${id.padEnd(25)} ${String(e.fights).padStart(6)}  ${e.avgHpLost.toFixed(1).padStart(7)}  ${e.avgTurns.toFixed(1).padStart(5)}  ${(e.deathRate * 100).toFixed(1).padStart(9)}%`,
      );
    }
    console.log(`  (${report.seconds}s)`);
  } else {
    console.log(
      `simulated ${n} runs: win rate ${(report.winRate * 100).toFixed(1)}% (${report.seconds}s)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
