// @ts-check
import { CONTENT_KINDS } from './game/core/content.js';
import { Registry } from './game/core/registry.js';
import { makeRunSeed } from './game/core/rng.js';
import { Stage } from './render/canvas.js';
import { startLoop } from './render/loop.js';
import { getPlatform } from './platform/platform.js';
import { SceneManager } from './scenes/sceneManager.js';
import { TitleScene } from './scenes/titleScene.js';
import { CombatScene } from './scenes/combatScene.js';

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

  // Dev conveniences: ?encounter=enc_foreman&seed=ABCD-1234&deck=starter jumps straight into a fight.
  const params = new URLSearchParams(location.search);
  const encounters = registry.all('encounter').map((e) => e.id);
  const newSeed = () => makeRunSeed(`${Date.now()}:${Math.random()}`);

  /** @type {'starter' | 'sandbox'} */
  let deck = params.get('deck') === 'starter' ? 'starter' : 'sandbox';

  /** @param {number} [selected] */
  const showTitle = (selected = 0) =>
    scenes.change(
      new TitleScene({
        registry,
        fps: loop.fps,
        platform: platform.kind,
        selected,
        deck,
        onStart: (id, chosen) => {
          deck = chosen;
          startCombat(id);
        },
      }),
    );

  /**
   * @param {string} encounterId
   * @param {string} [seed]
   */
  const startCombat = (encounterId, seed = newSeed()) => {
    scenes.change(
      new CombatScene({
        registry,
        encounterId,
        seed,
        deck,
        onExit: (action) => {
          const i = encounters.indexOf(encounterId);
          if (action === 'retry') startCombat(encounterId);
          else if (action === 'next') startCombat(encounters[(i + 1) % encounters.length]);
          else showTitle(i);
        },
      }),
    );
  };

  // Debug/automation handle: lets devtools and smoke tests inspect the live scene.
  /** @type {any} */ (window).aether = { registry, scenes };

  const requested = params.get('encounter');
  if (requested && registry.has(requested)) startCombat(requested, params.get('seed') ?? undefined);
  else showTitle();
}

boot().catch(showFatal);
