// @ts-check
import { CONTENT_KINDS } from './game/core/content.js';
import { Registry } from './game/core/registry.js';
import { makeRunSeed } from './game/core/rng.js';
import { Stage } from './render/canvas.js';
import { startLoop } from './render/loop.js';
import { getPlatform } from './platform/platform.js';
import { SceneManager } from './scenes/sceneManager.js';
import { BootScene } from './scenes/bootScene.js';

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

  container.addEventListener('pointermove', (e) => {
    scenes.input({ type: 'pointermove', ...stage.toLogical(e.clientX, e.clientY) });
  });
  container.addEventListener('pointerdown', (e) => {
    scenes.input({ type: 'pointerdown', ...stage.toLogical(e.clientX, e.clientY) });
  });
  window.addEventListener('keydown', (e) => scenes.input({ type: 'keydown', key: e.key }));

  const loop = startLoop({
    update: (dt) => scenes.update(dt),
    render: () => scenes.render(stage),
  });

  const seed = makeRunSeed(`${Date.now()}:${Math.random()}`);
  scenes.change(new BootScene({ registry, seed, fps: loop.fps, platform: platform.kind }));
}

boot().catch(showFatal);
