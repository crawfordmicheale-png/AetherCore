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
│   │   ├── combat/            # combat.js (state machine, turn flow, intents, preview), ops.js (effect ops)
│   │   ├── run/               # run.js (run state), map.js (generator), rewards.js, nodes/ (workbench, smelter, anomaly)
│   │   └── meta/              # workshop.js (insight, R&D, unlocks), profile.js
│   ├── render/                # canvas.js (layers, scaling), cardRenderer.js, tween.js, particles.js, shake.js, text.js
│   ├── ui/                    # widgets: button, tooltip, panel, dragDrop, targetingArrow
│   ├── scenes/                # title, combat (M1); workshop, map, reward, workbench, smelter, anomaly (later)
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
* **Independent streams** derived from the run seed so that one system's consumption doesn't perturb another: `map`, `loot`, `shuffle`, `ai`, `events`, `smelter`, `combat` (random targeting).
* RNG state is serialized with the run, so reloading never rerolls outcomes (anti save-scum).

### 3.3 Event Bus & Effect Resolution

Commands (`playCard`, `endTurn`) resolve **synchronously and depth-first**: every effect is an op (§4.3), and an op that triggers more effects (a kill triggering an on-death effect) resolves them fully before the next op in its list. Depth-first ordering matches how players read cause and effect, and it is simpler to reason about than a FIFO queue.

```js
const combat = Combat.create({ registry, bus, encounterId, deck, player, seed });
combat.start();
combat.playCard('c3', 'e1'); // synchronous; mutates combat.state, emits events
combat.endTurn();            // enemy turn resolves immediately, then the next player turn starts
```

Each change emits a **GameEvent** onto the bus (`cardPlayed`, `damage`, `blockGained`, `statusApplied`, `componentSuppressed`, `suppressionExpired`, `cardExhausted`, `slagAdded`, `enemyMove`, `enemyDied`, `combatWon`, ...). The renderer subscribes and builds an **animation timeline** from these events. Input is locked only while the timeline has blocking animations (configurable by animation speed; "Instant" skips them). In the M1 graybox the timeline is simple: enemy actions are staggered by a fixed delay and HP bars tween.

**Previews run the real command on a clone.** `combat.preview(uid, target)` deep-clones `CombatState`, plays the card on the clone with no event bus, and diffs HP/Block/Energy. Preview and outcome therefore share one code path and cannot diverge; a property test plays thousands of random actions to confirm it. Random-target cards are flagged so the UI doesn't leak which enemy the RNG will pick.

**Hooks:** Components, statuses, Blueprints, and Slag register listeners on hook points:
`combatStart`, `turnStart`, `cardDrawn`, `beforeCardPlayed`, `cardPlayed`, `afterCardPlayed`, `damageDealt`, `damageTaken`, `statusApplied`, `cardExhausted`, `cardDiscarded`, `turnEnd`, `enemyDied`, `combatEnd`.
Listener order: Blueprints → player statuses → card in play → cards in hand (left to right) → enemies (left to right).

### 3.4 State Shape (abridged)

```js
/** @typedef {{ id: string, defId: string, tuned?: boolean, capacityBonus?: number }} ComponentInstance */
/** @typedef {{ uid: string, frame: ComponentInstance, core: ComponentInstance, mod?: ComponentInstance, flags?: string[] }} CardInstance */

// As implemented in src/game/run/run.js (M3). Pressure and Schematics arrive later.
RunState = {
  version: 2,
  seed: 'A7F3-K2QX',
  chassisId: 'chassis_tinker',
  rng: { map: [...], loot: [...], shuffle: [...], ai: [...], events: [...], smelter: [...], combat: [...] },
  hp: 65, maxHp: 65,
  aether: 0,
  nextId: 12,                       // card uids c<n>, part uids p<n>
  deck: [/* CardInstance */],
  cargo: { slots: 10, items: [/* ComponentInstance with uid */] },
  blueprints: ['bp_ballast_tank'],
  map: StratumMap,                  // { rows, cols, nodes: { [id]: { id, row, col, type, pool?, next } }, start, boss }
  position: 'n3_2' | null,          // current node
  visited: ['n0_1', 'n1_2', ...],
  phase: 'map',                     // map | combat | loot | workbench | smelter | event | won | lost
  encounterId: 'enc_drones',
  combat: null | CombatState,       // the live combat; saving the run saves the fight
  loot: null | { items: [...], aether, pick, blueprints },   // pick: boss Prototype choice; blueprints: Elite/boss choice
  smelter: null | { offers: [{ uid, defId, price, sale, sold }] },
  event: null | { id, result },
  seenEvents: [...],
  counters: { capacityUpgrades, removals },   // escalating Smelter prices
  workbench: null | { charges: 3, used: 0, repaired: false },
  flags: { fieldKitUsed: false },
  stats: { combatsWon, elitesDefeated, nodesVisited, aetherEarned, partsCrushed, cardsAssembled },
};
// ComponentInstance = { defId, uid?, tuned?, capacityBonus?, rusted? }

// As implemented in src/game/combat/combat.js (plain JSON; round-trips through JSON.stringify).
CombatState = {
  version: 1,
  encounterId: 'enc_foreman',
  turn: 1,
  phase: 'player',          // player | enemy | won | lost
  energy: 3, energyPerTurn: 3, drawPerTurn: 5, maxHand: 10,
  rng: { shuffle: [...], ai: [...], combat: [...] },
  nextId: 1,                // for Slag instance uids (s1, s2, ...)
  cards: { [uid]: { kind: 'card', uid, frame, core, mod? } | { kind: 'slag', uid, defId } },
  piles: { draw: [...], hand: [...], discard: [...], exhaust: [...] }, // uids; top of draw = end
  player: { hp, maxHp, block: 0, statuses: { burn: 2, charge: 1 } },  // zero statuses are removed
  enemies: [{ uid: 'e1', defId, name, hp, maxHp, block, statuses, patternIndex, alive }],
  suppression: [{ slot: 'mod' | 'coreRider' | 'frame', source: 'e1', untilTurn: 2, cardUid? }], // frame: Seizure on one card
  mods: { startBlock, firstTurnEnergy, heatSink, faraday, slagFilter },  // from Blueprints
  used: { heatSink: true },  // once-per-combat Blueprint effects spent
  timesPlayed: { [uid]: count },
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

**Modifiers** (on Frames, Cores, and Mods): `{ stat, add | mul, per?, when? }` where `stat` is `cost`, `power`, `value`, `hits`, or `damageMult` (`mul` only), and `per` scales `add` by `otherSameElementInHand` or `timesPlayed`. Other behavior fields: Frame `utility` (`conduit` / `relay`), Core `adjective` (for generated card names) and `riderless`, Mod `keywords` and `unsuppressable`.

```jsonc
// slag.json — reactions while the Slag sits in hand
{
  "id": "slag_molten",
  "cost": null,                         // null = unplayable
  "onCardPlayedInHand": [{ "when": { "coreElement": "kinetic" }, "ops": [{ "op": "damage", "amount": 3, "target": "player" }] }],
  "endOfTurnInHand": [{ "op": "applyStatus", "status": "burn", "stacks": 1, "target": "player" }]
}
// Rust Slag uses "capacityInHand": -1 instead.

// enemies.json — moves are op lists; the pattern cycles
{
  "id": "el_foreman_gantry",
  "tier": "elite",                      // normal | elite | boss
  "hp": [80, 80],                       // rolled on the ai stream
  "start": "first",                     // or "random" pattern offset
  "moves": [
    { "id": "emp", "name": "EMP Pulse", "intent": "suppress", "ops": [{ "op": "suppress", "slot": "mod", "duration": 1 }] },
    { "id": "slam", "name": "Gantry Slam", "intent": "attack", "ops": [{ "op": "damage", "amount": 12 }] }
  ],
  "pattern": ["emp", "slam"],
  "onDeath": []                         // optional ops (Boiler Mite burns you)
}

// encounters.json
{ "id": "enc_foreman", "name": "The Foreman", "kind": "elite", "enemies": ["el_foreman_gantry"] }
```

### 4.3 Effect Ops Vocabulary

Ops are small, composable, and individually unit-tested. Every op is `(combat, op, ctx)` in `src/game/combat/ops.js`, where `ctx` has `source` (`'player'`, an enemy uid, or `null` for Slag/Burn), the card's `target`, and per-card tallies (damage dealt, entities hit). Targets: `player`, `self`, `target` (default for hostile ops: the card's target, or the player when an enemy is the source), `allEnemies`, `randomEnemy`.

| Op | Params | Status | Notes |
| --- | --- | --- | --- |
| `damage` | `amount`, `hits?`, `target?`, `pierce?` | M1 | Strength, Shock, Chill, multipliers, Plated, then Block (Crush doubles damage to Block). |
| `block` | `amount`, `target?` | M1 | |
| `applyStatus` | `status`, `stacks`, `target?` | M1 | Ward on the player blocks the next debuff. |
| `draw` | `n` | M1 | Reshuffles the discard pile when empty; overdraw past 10 is discarded. |
| `gainEnergy` | `n` | M1 | |
| `heal` | `amount`, `target?` | M1 | |
| `addSlag` | `slag`, `count`, `pile` | M1 | `pile`: hand / draw (seeded random position) / discard. `fused?` arrives with Fused Slag. |
| `suppress` | `slot`, `duration` | M1 | `slot`: `mod` (EMP) or `coreRider` (Dampening Field). Lasts through the player's next `duration` turns. |
| `exhaustSlag` | `count` | M1 | Grounding Rod. |
| `ricochet` | `pct` | M1 | Repeats the card's hit on a random other enemy. |
| `siphon` | `per`, `max` | M1 | Heals from unblocked damage the card dealt. |
| `bonusLoot` | `n` | M2 | Extra post-combat loot rolls (Scavenger's Hook, via the `enemyKilled` hook). |
| `summon` | `enemy`, `count?` | M3 | Adds enemies mid-fight (max 5 alive). Foreman Gantry's 50% trigger. |
| `setPattern` | `pattern` | M3 | Replaces the source enemy's move pattern (boss phases); restarts it at the first move. |
| `gainAether` | `amount` | Planned (M2) | |
| `script` | `name`, `params` | Planned | Escape hatch: named JS function in `combat/scripts/`. Use sparingly; every script needs a test. |

**Enemy triggers** (M3): an enemy may list `triggers: [{ id, when: { hpBelowPct }, text, ops }]`. Each fires once, right after the damage that crosses its threshold, and emits `enemyPhase` for the renderer. The Crucible Engine's phases are two triggers.

**Blueprints** (M3, `blueprints.json`) are passive run modifiers with a closed set of `effects` keys validated in `content.js`: integers (`toolCharges`, `cargoSlots`, `crushBonusPct`, `fieldRepairBonusPct`, `eliteBonusLoot`, `smelterDiscountPct`, `startBlock`, `firstTurnEnergy`) and once-per-combat or always-on flags (`heatSink`, `faraday`, `slagFilter`). Run-level effects are read through `Run.effect(key)`; combat-level ones are passed to `Combat.create({ mods })`.

**Anomalies** (M3, `events.json`) hold text and choices; each choice's logic is a small handler in `src/game/run/events.js` (`blocked?(run)` and `resolve(run, params)` returning the result text).

**Conditions** (`when`) are a closed set of predicates in `src/game/model/conditions.js`: `targetHas`, `targetHpBelowPct`, `playerHas`, `coreElement`, `componentSuppressed`, `handCountAtLeast`, combined with `all` / `any` / `not`. Target conditions only apply once a target is known (hover preview or resolution).

### 4.4 Validation

`tools/validate-data.js` (run in CI) and the `Registry` constructor (at boot) run the same validator in `src/game/core/content.js`:
* Field rules per content type (types, ranges, enums, no unknown fields).
* Every op's params against `OP_SCHEMAS`, every modifier and condition, in Mods, Frames, Cores, Slag triggers, enemy moves, and on-death effects.
* Cross-references resolve (encounter → enemy IDs, enemy pattern → move IDs, `addSlag` → Slag IDs, starting decks → component IDs; R&D unlocks later).
* Sanity rules: weights 0–3, capacity 0–4, starter decks within capacity and at least 8 cards, stacking-element Cores have a numeric rider, every elite has at least one `suppress` or `addSlag` move. (Art presence warnings arrive with the art pipeline.)

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

**Target-dependent preview:** When a target is hovered, the scene calls `combat.preview(uid, target)`, which plays the card on a cloned state (§3.3). Resolution itself re-derives the card per target, so conditional Mods (Kindling, Executioner) see each target's state, and preview and outcome can never diverge (enforced by a property-based test).

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
| Current run | `userData/run.json` | After every run change (node entry, loot, Workbench action) and on each combat `turnReady` (after the new hand is drawn) |

* Saves are written atomically (write to `.tmp`, then rename) via Electron IPC from `preload.cjs`. In the browser build, `platform.js` falls back to `localStorage`.
* Every save has a `version`; `game/core/migrations.js` upgrades old saves.
* The run save is deleted on run end (death/extraction/victory) after the profile is updated.

---

## 9. Testing & Tooling

* **Unit tests** for every op, status, and derivation rule. Golden tests for each starter deck card.
* **Property tests** (hand-rolled generators, `tests/combatProperties.test.js`): across 60 random games per property, preview equals actual resolution, invariants hold after every action (HP in range, no card lost or duplicated across piles), same seed + inputs reproduce identical state and event logs, and a JSON round-trip mid-combat resumes identically.
* **Replay tests:** a recorded `(seed, inputs[])` log must reproduce the same final state hash.
* **Balance simulator** (`tools/simulate.js`, `npm run simulate -- --runs 400 --seed s`): a greedy bot plays N full runs headlessly (combat, salvage, Workbench, map choices, Smelter, Anomalies) and reports win rate, rows reached, Aether, Blueprints, Cargo crush rate, and per-encounter HP lost, turns, and death rate (`--json` for machine output). Used to catch outliers before human playtests. Pick rates per component are still to come.
* **CI** (GitHub Actions): lint, typecheck, data validation, tests, and a 50-run simulator smoke test on each PR.

---

## 10. Packaging & Distribution

* `electron-builder` config in `package.json`; artifacts for Win x64, macOS universal, Linux x64 AppImage.
* Steam integration (post-slice) via `steamworks.js` for achievements and cloud saves; isolated behind `platform.js` so the browser build keeps working.
* Code signing: Windows (EV cert) and macOS notarization are release-milestone tasks.
* All user-facing strings live in `src/data/strings/en.json` for future localization.
