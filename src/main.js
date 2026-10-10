// @ts-check
import { CONTENT_KINDS } from './game/core/content.js';
import { Registry } from './game/core/registry.js';
import { makeRunSeed } from './game/core/rng.js';
import { Stage } from './render/canvas.js';
import { startLoop } from './render/loop.js';
import { getPlatform } from './platform/platform.js';
import { Combat } from './game/combat/combat.js';
import { buildSandboxDeck, buildStarterDeck } from './game/model/deck.js';
import { GAUNTLET } from './game/run/gauntlet.js';
import { RUN_VERSION, Run } from './game/run/run.js';
import { SceneManager } from './scenes/sceneManager.js';
import { TitleScene } from './scenes/titleScene.js';
import { CombatScene } from './scenes/combatScene.js';
import { LootScene } from './scenes/lootScene.js';
import { WorkbenchScene } from './scenes/workbenchScene.js';
import { SummaryScene } from './scenes/summaryScene.js';

/** Keys the game uses that the browser would otherwise act on (scrolling, focus, menus). */
const CAPTURED_KEYS = new Set([
  ' ',
  'Tab',
  'Alt',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/** @returns {Promise<import('./game/core/content.js').ContentBundle>} */
async function loadContent() {
  const entries = await Promise.all(
    Object.entries(CONTENT_KINDS).map(async ([kind, { file }]) => {
      const res = await fetch(`./data/${file}`);
      if (!res.ok) throw new Error(`Failed to load data/${file}: ${res.status}`);
      return [kind, await res.json()];
    }),
  );
  return Object.fromEntries(entries);
}

/** @param {unknown} err */
function showFatal(err) {
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f88;padding:24px;font:14px monospace;white-space:pre-wrap';
  pre.textContent = `AetherCore failed to start:\n\n${err instanceof Error ? err.message : String(err)}`;
  document.body.replaceChildren(pre);
}

async function boot() {
  const registry = new Registry(await loadContent());
  const platform = getPlatform();
  const container = document.getElementById('stage');
  if (!container) throw new Error('#stage element missing');
  const stage = new Stage(container);
  const scenes = new SceneManager();

  /** @param {string} type @param {PointerEvent} e */
  const pointer = (type, e) =>
    scenes.input({ type, button: e.button, ...stage.toLogical(e.clientX, e.clientY) });
  container.addEventListener('pointermove', (e) => pointer('pointermove', e));
  container.addEventListener('pointerdown', (e) => pointer('pointerdown', e));
  window.addEventListener('pointerup', (e) => pointer('pointerup', e));
  container.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (CAPTURED_KEYS.has(e.key)) e.preventDefault();
    if (!e.repeat) scenes.input({ type: 'keydown', key: e.key });
  });
  window.addEventListener('keyup', (e) => scenes.input({ type: 'keyup', key: e.key }));
  window.addEventListener('blur', () => scenes.input({ type: 'keyup', key: 'Alt' }));

  const loop = startLoop({
    update: (dt) => scenes.update(dt),
    render: () => scenes.render(stage),
  });

  const encounters = registry.all('encounter');
  const newSeed = () => makeRunSeed(`${Date.now()}:${Math.random()}`);
  const params = new URLSearchParams(location.search);
  /** @type {'starter' | 'sandbox'} */
  let deck = params.get('deck') === 'sandbox' ? 'sandbox' : 'starter';

  // ---------------------------------------------------------------------------
  // Run flow: each run phase maps to a scene; the run autosaves after every change.
  // ---------------------------------------------------------------------------

  /** @param {Run} run */
  const save = (run) => {
    platform
      .save('run.json', JSON.stringify(run.state))
      .catch((err) => console.error('Save failed', err));
  };

  /** @returns {Promise<Run | null>} */
  const loadSavedRun = async () => {
    try {
      const text = await platform.load('run.json');
      if (!text) return null;
      const state = JSON.parse(text);
      if (state.version !== RUN_VERSION) return null;
      return new Run(state, { registry });
    } catch (err) {
      console.warn('Ignoring unreadable run save', err);
      return null;
    }
  };

  /** @param {Run} run */
  const routeRun = (run) => {
    const { phase } = run.state;
    if (run.over) {
      platform.remove('run.json').catch(() => {});
      scenes.change(new SummaryScene({ run, onDone: () => showTitle() }));
      return;
    }
    save(run);
    const onChange = () => save(run);
    const onDone = () => routeRun(run);
    if (phase === 'combat') {
      scenes.change(
        new CombatScene({
          registry,
          chassisId: run.state.chassisId,
          mode: 'run',
          subtitle: `Gauntlet node ${run.state.step + 1}/${GAUNTLET.length} · HP carries over · seed ${run.state.seed}`,
          makeCombat: (bus) => {
            // Save once each turn is set up, so a closed window resumes mid-fight.
            bus.on('turnReady', onChange);
            return run.startCombat(bus);
          },
          onExit: (action) => {
            if (action === 'continue') {
              run.finishCombat();
              routeRun(run);
            } else {
              save(run);
              showTitle();
            }
          },
        }),
      );
    } else if (phase === 'loot') {
      scenes.change(new LootScene({ run, onChange, onDone }));
    } else if (phase === 'workbench') {
      scenes.change(new WorkbenchScene({ run, onChange, onDone }));
    }
  };

  /** @param {string} [seed] */
  const startRun = (seed = newSeed()) => {
    routeRun(Run.create({ registry, chassisId: 'chassis_tinker', seed, deck }));
  };

  // ---------------------------------------------------------------------------
  // Quick fights (graybox): a single encounter with a fresh deck.
  // ---------------------------------------------------------------------------

  /**
   * @param {string} encounterId
   * @param {string} [seed]
   */
  const startQuickFight = (encounterId, seed = newSeed()) => {
    const chassis = registry.get('chassis_tinker');
    scenes.change(
      new CombatScene({
        registry,
        subtitle: `Quick fight · seed ${seed}`,
        makeCombat: (bus) =>
          Combat.create({
            registry,
            bus,
            encounterId,
            deck:
              deck === 'sandbox'
                ? buildSandboxDeck(registry)
                : buildStarterDeck(registry, chassis.id),
            player: { hp: chassis.hp, maxHp: chassis.hp },
            seed,
            energyPerTurn: chassis.energy,
            drawPerTurn: chassis.draw,
          }),
        onExit: (action) => {
          const i = encounters.findIndex((e) => e.id === encounterId);
          if (action === 'retry') startQuickFight(encounterId);
          else if (action === 'next') startQuickFight(encounters[(i + 1) % encounters.length].id);
          else showTitle();
        },
      }),
    );
  };

  // ---------------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------------

  const showTitle = async () => {
    const saved = await loadSavedRun();
    /** @returns {import('./scenes/titleScene.js').MenuItem[]} */
    const items = () => [
      ...(saved
        ? [
            {
              label: 'Continue run',
              detail: `node ${saved.state.step + 1}/${GAUNTLET.length} · ${saved.state.phase} · HP ${saved.state.hp}/${saved.state.maxHp} · ◆ ${saved.state.aether}`,
              accent: '#ffd27a',
              action: () => routeRun(saved),
            },
          ]
        : []),
      {
        label: 'New Gauntlet run',
        detail: saved
          ? 'replaces the saved run'
          : `The Tinker · ${GAUNTLET.length} nodes · combats, salvage, Workbenches`,
        accent: '#ffd27a',
        action: () => startRun(),
      },
      ...encounters.map((enc) => ({
        label: `Quick fight: ${enc.name}`,
        detail: `${enc.kind} · ${enc.enemies.map((/** @type {string} */ id) => registry.get(id).name).join(', ')}`,
        accent: enc.kind === 'elite' ? '#ff9a7a' : undefined,
        action: () => startQuickFight(enc.id),
      })),
    ];
    scenes.change(
      new TitleScene({
        items,
        fps: loop.fps,
        platform: platform.kind,
        footer: () =>
          `Deck: ${deck === 'sandbox' ? 'Sandbox (starter + modded test cards)' : 'Tinker starter'}  ·  [T] toggle`,
        onKey: (key) => {
          if (key === 't' || key === 'T') deck = deck === 'sandbox' ? 'starter' : 'sandbox';
        },
      }),
    );
  };

  // Debug/automation handle: lets devtools and smoke tests inspect the live scene.
  /** @type {any} */ (window).aether = { registry, scenes, platform };

  // Dev conveniences: ?encounter=enc_foreman&seed=ABCD-1234 jumps into a quick fight;
  // ?run=new&seed=ABCD-1234 starts a Gauntlet run; add &deck=sandbox for the test deck.
  const requested = params.get('encounter');
  if (requested && registry.has(requested))
    startQuickFight(requested, params.get('seed') ?? undefined);
  else if (params.get('run') === 'new') startRun(params.get('seed') ?? undefined);
  else showTitle();
}

boot().catch(showFatal);
