# AETHERCORE: Technical Design

> Companion to the [Game Design Document](GDD.md). Describes how the game is built: architecture, data formats, the card derivation engine, rendering, and packaging.

---

## 1. Stack & Principles

| Concern | Choice |
| --- | --- |
| Language | Vanilla JavaScript (ES2022 modules). Type safety via JSDoc + `// @ts-check` checked by `tsc --noEmit` (no TS compile step). |
| Rendering | HTML5 Canvas 2D API. No game framework. |
| Desktop shell | Electron (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). |
| Packaging | `electron-builder`: Windows (NSIS), macOS (DMG, universal), Linux (AppImage). |
| Dev server | Any static server (`npx serve src`) for browser iteration; Electron for full builds. No bundler required in development. |
| Tests | Node's built-in test runner (`node --test`). |
| Lint/format | ESLint + Prettier. |

**Guiding principles:**

1. **Logic is headless.** Everything in `src/game/` runs in plain Node with no DOM or Canvas. This enables unit tests, a balance simulator, and deterministic replays.
2. **Logic emits events; rendering consumes them.** Game state changes instantly; the renderer animates a queue of events at its own pace. Logic never waits on animation.
3. **Content is data.** Components, enemies, Blueprints, and events live in JSON. Behavior is composed from a small vocabulary of effect ops (§4.3), with a narrow escape hatch for bespoke scripts.
4. **Deterministic by seed.** All randomness flows through seeded RNG streams. Same seed + same inputs = same run.

---

## 2. Project Structure

```
AetherCore/
├── docs/                      # Design docs (this folder)
├── electron/
│   ├── main.js                # Window creation, IPC handlers (save/load, settings, quit)
│   └── preload.cjs             # contextBridge: exposes window.platform.{save,load,...}
├── src/
│   ├── index.html             # Single page; hosts the stacked canvases
│   ├── main.js                # Bootstrap: load data, create Game, start loop
│   ├── data/                  # JSON content (frames, cores, mods, slag, enemies, blueprints, events, encounters)
│   ├── game/                  # HEADLESS logic only (no DOM)
│   │   ├── core/              # rng.js, events.js (bus), ids.js, registry.js (content lookup)
│   │   ├── model/             # component.js, card.js (derivation), deck.js, cargo.js, statuses.js
│   │   ├── combat/            # combat.js (state machine), actionQueue.js, ops.js, intents.js, ai.js
│   │   ├── run/               # run.js (run state), map.js (generator), rewards.js, nodes/ (workbench, smelter, anomaly)
│   │   └── meta/              # workshop.js (insight, R&D, unlocks), profile.js
│   ├── render/                # canvas.js (layers, scaling), cardRenderer.js, tween.js, particles.js, shake.js, text.js
│   ├── ui/                    # widgets: button, tooltip, panel, dragDrop, targetingArrow
│   ├── scenes/                # title, workshop, map, combat, reward, workbench, smelter, anomaly
│   ├── input/                 # mouse.js, keyboard.js, hotkeys.js (rebindable)
│   ├── audio/                 # audio.js (Web Audio, buses: music/sfx/ui)
│   └── platform/              # platform.js: Electron IPC or localStorage fallback in browser
├── assets/                    # art, audio, fonts
├── tools/
│   ├── simulate.js            # Headless balance simulator (bot plays N runs)
│   └── validate-data.js       # Schema + cross-reference validation for src/data
└── tests/                     # node --test suites mirroring src/game
```

**Dependency rule:** `game/` imports nothing from `render/`, `ui/`, `scenes/`, `input/`, `audio/`, or `platform/`. Scenes glue game state to rendering and input.

---

## 3. Core Runtime

### 3.1 Game Loop

* `requestAnimationFrame` loop with a **fixed-timestep update** (60 Hz accumulator) for tweens/particles and **variable render**.
* Game *logic* is not tick-based; it advances only on player commands and resolves synchronously.
* The active `Scene` implements `enter(params)`, `exit()`, `update(dt)`, `render(ctx)`, `onInput(evt)`. A `SceneManager` handles transitions (fade/wipe).

### 3.2 Seeded RNG

* Algorithm: `sfc32` seeded via `cyrb128(seedString)`.
* **Independent streams** derived from the run seed so that one system's consumption doesn't perturb another: `map`, `loot`, `shuffle`, `ai`, `events`, `smelter`.
* RNG state is serialized with the run, so reloading never rerolls outcomes (anti save-scum).

### 3.3 Event Bus & Action Queue

All combat effects are **Actions** pushed onto an `ActionQueue`. Resolving an action may push more actions (e.g., `Damage` → `OnKill` → `DropLoot`).

```js
// Example action resolution flow for playing a card
queue.push({ type: 'PlayCard', cardId, targetId });
queue.resolveAll(state);   // synchronous; mutates state, emits events
```

Each resolved action emits one or more **GameEvents** onto the bus (`cardPlayed`, `damageDealt`, `statusApplied`, `componentSuppressed`, `cardExhausted`, `slagAdded`, `enemyDied`, ...). The renderer subscribes and builds an **animation timeline** from these events. Input is locked only while the timeline has blocking animations (configurable by animation speed; "Instant" skips them).

**Hooks:** Components, statuses, Blueprints, and Slag register listeners on hook points:
`combatStart`, `turnStart`, `cardDrawn`, `beforeCardPlayed`, `cardPlayed`, `afterCardPlayed`, `damageDealt`, `damageTaken`, `statusApplied`, `cardExhausted`, `cardDiscarded`, `turnEnd`, `enemyDied`, `combatEnd`.
Listener order: Blueprints → player statuses → card in play → cards in hand (left to right) → enemies (left to right).

### 3.4 State Shape (abridged)

```js
/** @typedef {{ id: string, defId: string, tuned?: boolean, capacityBonus?: number }} ComponentInstance */
/** @typedef {{ uid: string, frame: ComponentInstance, core: ComponentInstance, mod?: ComponentInstance, flags?: string[] }} CardInstance */

RunState = {
  version: 1,
  seed: 'A7F3-...',
  rng: { map: [...], loot: [...], shuffle: [...], ai: [...], events: [...], smelter: [...] },
  chassis: 'tinker',
  pressure: 0,
  hp: 65, maxHp: 65,
  aether: 99,
  deck: [/* CardInstance */],
  cargo: { slots: 10, items: [/* ComponentInstance | { kind: 'schematic', stratum } */] },
  blueprints: ['bp_heat_sink'],
  map: { stratum: 1, nodes: [...], edges: [...], position: 'n_3_2', visited: [...] },
  counters: { smelterCapacityUpgrades: 0, slagRemovals: 0 },
  combat: null | CombatState,
};

CombatState = {
  turn: 1,
  energy: 3,
  piles: { draw: [...], hand: [...], discard: [...], exhaust: [...] }, // card uids or slag instances
  player: { block: 0, statuses: { burn: 0, charge: 0, ... } },
  enemies: [{ uid, defId, hp, maxHp, block, statuses, intent, patternIndex }],
  suppression: [{ slot: 'mod', source: 'el_foreman_gantry', expiresAtTurnEnd: 2, scope: 'hand' }],
  perCombat: { overclockSaved: false, played: { [uid]: count } },
};
```

---

## 4. Data & Content

### 4.1 Content Files

One JSON file per content type in `src/data/`. IDs follow `kind_name` (see [Content Catalog](CONTENT.md)). A `registry.js` loads all files at boot and validates them (§4.4).

### 4.2 Component Schemas

```jsonc
// frames.json
{
  "id": "frame_heavy_strike",
  "name": "Heavy Strike",
  "tier": "salvage",
  "verb": "attack",           // attack | defend | utility
  "cost": 2,
  "capacity": 3,
  "target": "single",         // single | all | random | self
  "base": 6,
  "hits": 1,
  "coreScaling": 1.0,
  "keywords": [],
  "unlock": "base",           // base | rnd:<nodeId>
  "art": "frames/heavy_strike"
}

// cores.json
{
  "id": "core_furnace",
  "name": "Furnace Core",
  "tier": "refined",
  "element": "thermal",
  "power": 6,
  "rider": 2,
  "weight": 2,
  "art": "cores/furnace"
}

// mods.json — declarative modifiers + hooks + conditions
{
  "id": "mod_kindling",
  "name": "Kindling",
  "tier": "salvage",
  "weight": 1,
  "modifiers": [
    { "stat": "value", "add": 3, "when": { "targetHas": "burn" } }
  ]
}
{
  "id": "mod_spring_loaded",
  "name": "Spring-Loaded",
  "tier": "salvage",
  "weight": 1,
  "hooks": { "cardPlayed": [ { "op": "draw", "n": 1 } ] }
}
```

### 4.3 Effect Ops Vocabulary

Ops are small, composable, and individually unit-tested. Every op takes `(state, ctx, params)` where `ctx` has `source`, `target`, `card`, and `derived`.

| Op | Params | Notes |
| --- | --- | --- |
| `damage` | `amount`, `hits?`, `target?`, `pierce?` | Applies Strength, Shock, Chill, Plated, Block, Crush in that order. |
| `block` | `amount`, `retain?` | |
| `applyStatus` | `status`, `stacks`, `target?` | |
| `draw` | `n` | |
| `gainEnergy` | `n`, `nextTurn?` | |
| `heal` | `amount` | |
| `addSlag` | `slagId`, `count`, `pile` | `pile`: hand/draw/discard; `fused?` for permanent. |
| `suppress` | `slot`, `duration`, `scope` | Emits `componentSuppressed`; triggers re-derivation. |
| `exhaust` | `selector` | e.g., `{ "slag": true, "count": 1 }`. |
| `summon` | `enemyId`, `position?` | |
| `gainAether` | `amount` | |
| `script` | `name`, `params` | Escape hatch: named JS function in `combat/scripts/`. Use sparingly; every script needs a test. |

**Conditions** (`when`) are a closed set of predicates: `targetHas`, `targetHpBelowPct`, `playerHas`, `handContains`, `handCount`, `isLastCardInHand`, `componentSuppressed`, `elementCountInHand`, `turnNumber`. Combine with `all` / `any` / `not`.

### 4.4 Validation

`tools/validate-data.js` (run in CI and at boot in dev):
* JSON Schema validation per content type.
* Cross-references resolve (encounter → enemy IDs, R&D unlocks → content IDs, starting decks → component IDs).
* Sanity rules: weights 0–3, capacity 0–4, every elite has at least one `suppress` or `addSlag` op, every component has art (warn only).

---

## 5. Card Derivation Engine

The heart of the game. Implemented as a **pure function** in `game/model/card.js`:

```js
/**
 * @param {CardInstance} card
 * @param {DerivationContext} ctx  // { suppression, hand, player, target?, blueprints }
 * @returns {DerivedCard}
 */
export function deriveCard(card, ctx) { ... }

// DerivedCard
{
  cost: 2,
  verb: 'attack',
  target: 'single',
  valuePerHit: 12,
  hits: 1,
  rider: { kind: 'burn', stacks: 2 },
  keywords: ['exhaust'],
  weight: 3, capacity: 3,
  overclock: 0,               // 0, 1, or 2 (amount over capacity)
  suppressed: { frame: false, core: false, mod: true },
  breakdown: [                // drives the Exploded View tooltip
    { source: 'frame', label: 'Heavy Strike base', value: 6 },
    { source: 'core',  label: 'Furnace Core', value: 6 },
    { source: 'mod',   label: 'Spring-Loaded (suppressed)', value: 0 }
  ],
  hash: 'c1f9…'               // stable key for render caching
}
```

**Order of operations** (mirrors [GDD §2.2](GDD.md#22-card-stat-derivation)):
1. Resolve active components (drop suppressed ones; Fail-Safe ignores suppression).
2. Compute capacity (frame capacity + upgrades − Seizure − Rust Slag) and weight (active core + active mod, honoring Counterbalance and Tune).
3. Cost (frame + modifiers + Jammed/Overheat preview, min 0).
4. Value per hit = `base + floor(power × coreScaling)` + additive modifiers whose `when` conditions pass.
5. Hits, rider, target modifications.
6. Keywords; add `exhaust` if `weight > capacity` or a mod forces it.
7. Build `breakdown` and `hash`.

**Target-dependent preview:** When a target is hovered, the scene calls `previewResolution(derived, target, state)` to compute final damage including statuses. This uses the same functions as real resolution so preview and outcome can never diverge (enforced by a property-based test).

**Re-derivation triggers:** The combat scene re-derives all cards in hand on any of: `cardDrawn`, `cardPlayed`, `cardDiscarded`, `statusApplied` (player or hovered target), `componentSuppressed`, `suppressionExpired`, `slagAdded`, `energyChanged`. Derivation is cheap (< 0.05 ms/card); memoize by `(card.uid, ctxVersion)`.

---

## 6. Rendering

### 6.1 Canvas Layers

Stacked `<canvas>` elements, all at the same logical resolution (1920×1080), scaled to fit the window with letterboxing and `devicePixelRatio` support:

| Layer | Contents | Redraw |
| --- | --- | --- |
| `bg` | Parallax background, floor | On scene enter / resize, plus slow parallax |
| `world` | Enemies, player, intents, HP bars | Every frame during animation, else on change |
| `hand` | Cards in hand, piles, energy orb | Every frame while hovered/animating |
| `fx` | Particles, screen flashes, targeting arrow | Every frame when active |
| `ui` | Tooltips, panels, map side panel, modals | On change |

Screen shake is applied as a transform on `world`, `hand`, and `fx` (not `ui`, to keep text readable).

### 6.2 Card Compositing

`cardRenderer.js` draws a card to an `OffscreenCanvas` (fallback: detached `<canvas>`) and caches it by `derived.hash` + scale bucket:

1. **Frame layer:** Frame art (background + border).
2. **Core layer:** Core art clipped to the Frame's center cutout using a `Path2D` mask defined per Frame (`ctx.clip(path)`), plus element glow (`globalCompositeOperation = 'lighter'`).
3. **Mod layer:** Badge sprite drawn at the top-right socket anchor.
4. **Text layer:** Cost gem, name (auto-generated, e.g., "Searing Heavy Strike"), rules text from `derived`, value numbers. Numbers modified from their base are tinted (green up / red down).
5. **State overlays:** Suppressed layers redrawn with `ctx.filter = 'grayscale(1) brightness(0.6)'` plus a static-noise pattern; overclock glow (amber/red) as an outer stroke.

Cache invalidation is automatic via the hash. Target ≤ 40 cached bitmaps (LRU).

**Card naming:** Generated as `[Core adjective] [Frame name]` (+ `of [Mod noun]`), e.g., *Searing Heavy Strike of Springs*. Adjectives/nouns are defined per component in data.

### 6.3 Targeting Arrow

A quadratic Bézier from the card's top-center to the cursor, with the control point raised above the midpoint (`cp = midpoint − (0, distance × 0.4)`). Rendered as segmented chevrons along the curve that animate toward the target; color is element-tinted; turns red over invalid targets.

### 6.4 Particles & Juice

* Pooled particle system (fixed array, no per-frame allocation), max 2,000 particles.
* Shake uses trauma-based decay (`offset = maxOffset × trauma² × noise(t)`), trauma added per event (Overclock +1: 0.35; +2: 0.6), scaled by the accessibility slider.

### 6.5 Performance Budget

* 60 FPS at 1080p on integrated graphics (Intel UHD 620 class).
* Frame budget: < 6 ms render, < 1 ms logic on input.
* Memory < 400 MB.

---

## 7. Input

* Unified pointer handling (mouse) with hit-testing against a per-frame list of interactive rects/paths in reverse draw order.
* Drag-and-drop system shared by combat (card → target), loot (tray → cargo), and Workbench (cargo → socket).
* Hotkeys defined in `input/hotkeys.js` as a rebindable map (persisted in settings). Defaults listed in [GDD §3.2](GDD.md#32-pc-ui--controls).

---

## 8. Persistence

| Data | Location | When Saved |
| --- | --- | --- |
| Settings | `userData/settings.json` | On change |
| Profile (Insight, unlocks, Codex, records) | `userData/profile.json` | On run end, on R&D purchase |
| Current run | `userData/run.json` | On node entry, on node exit, at the start of each combat turn |

* Saves are written atomically (write to `.tmp`, then rename) via Electron IPC from `preload.cjs`. In the browser build, `platform.js` falls back to `localStorage`.
* Every save has a `version`; `game/core/migrations.js` upgrades old saves.
* The run save is deleted on run end (death/extraction/victory) after the profile is updated.

---

## 9. Testing & Tooling

* **Unit tests** for every op, status, and derivation rule. Golden tests for each starter deck card.
* **Property tests** (hand-rolled generators): `previewResolution` equals actual resolution; derivation never yields negative cost or value; serialization round-trips.
* **Replay tests:** a recorded `(seed, inputs[])` log must reproduce the same final state hash.
* **Balance simulator** (`tools/simulate.js`): a greedy bot plays N runs headlessly and reports win rate per Stratum, average HP lost per encounter, Cargo crush rate, and pick rates per component. Used to catch outliers before human playtests.
* **CI** (GitHub Actions): lint, typecheck, data validation, tests, and a 200-run simulator smoke test on each PR.

---

## 10. Packaging & Distribution

* `electron-builder` config in `package.json`; artifacts for Win x64, macOS universal, Linux x64 AppImage.
* Steam integration (post-slice) via `steamworks.js` for achievements and cloud saves; isolated behind `platform.js` so the browser build keeps working.
* Code signing: Windows (EV cert) and macOS notarization are release-milestone tasks.
* All user-facing strings live in `src/data/strings/en.json` for future localization.
