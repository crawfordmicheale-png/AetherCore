# AetherCore

A deckbuilding roguelike where you don't find cards; you **build** them. Scavenge Frames, Cores, and Mods from destroyed machines, carry them in a limited Cargo Hold, and weld them into custom cards to survive a ruined clockwork-magic world.

**Platform:** PC (Windows/macOS/Linux) · **Stack:** Vanilla JavaScript + HTML5 Canvas, packaged with Electron

## Design Documents

| Document | Contents |
| --- | --- |
| [Game Design Document](docs/GDD.md) | Pillars, crafting rules, combat, map and loop, meta-progression, presentation, scope |
| [Content Catalog](docs/CONTENT.md) | Frames, Cores, Mods, Slag, Blueprints, enemies, bosses, and events with first-pass numbers |
| [Technical Design](docs/TECHNICAL_DESIGN.md) | Architecture, data schemas, card derivation engine, rendering, persistence, testing |
| [Production Roadmap](docs/ROADMAP.md) | Milestones M0–M7 with exit criteria and key risks |

## Getting Started

Requires Node.js 20+ (22 recommended).

```sh
npm install           # also downloads the Electron binary
npm start             # run the game in Electron
npm run dev           # or serve src/ at http://localhost:5173 for browser iteration
                      #   ?encounter=enc_foreman&seed=ABCD-1234&deck=starter jumps straight into a fight
npm run check         # lint, format check, typecheck, data validation, tests (what CI runs)
```

| Script                  | What it does                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `npm test`              | Unit tests with Node's built-in runner (`tests/**/*.test.js`)        |
| `npm run lint`          | ESLint, including the rule that keeps `src/game/` headless           |
| `npm run typecheck`     | `tsc` over JSDoc-annotated JavaScript (`// @ts-check`), no build step |
| `npm run validate-data` | Validates `src/data/*.json` fields, IDs, and cross-references        |
| `npm run format`        | Prettier                                                             |
| `npm run simulate`      | Balance simulator: `-- --runs 400 --seed s [--deck sandbox] [--json]` |

## Playing the Graybox

**New run** generates a Stratum map: pick a lit node on the next row (click, or `←` / `→` and `Enter`) and climb to the Crucible Engine at the top. Combats, Elites (harder, and they offer a Blueprint), Workbenches, Smelters, and Anomalies are marked on the map and in its legend; the side panel lists your Blueprints, Cargo, and deck. HP carries over and the run autosaves at every node and turn start (**Continue run** resumes it, even mid-fight). **Quick fight** jumps straight into one encounter. `T` on the title toggles between the Tinker starter deck and a Sandbox test deck.

- **Salvage:** drag parts into the Cargo Hold or onto the Crusher (click + `T` / `C` also work). Unclaimed parts are lost when you continue.
- **Workbench:** click a deck card to edit it (or start with an empty bench for a new card), double-click or drag Cargo parts onto the sockets, and **Weld**. Each changed socket costs 1 Tool Charge; Tune, Dismantle, and Field Repair are on the bench.
- **Smelter:** click an offer to buy it into Cargo. Select a deck card to Upgrade its Frame's Capacity or Remove it; select three same-tier Cargo parts and press a Fuse button to make a next-tier Frame, Core, or Mod.
- **Anomaly:** choose with the mouse or `1`–`9`; some choices ask you to pick a Cargo part.

Combat controls:

| Input | Action |
| --- | --- |
| Drag a card onto an enemy, or click a card then an enemy | Play a targeted card |
| Drag a card above the hand, or click it twice | Play an untargeted card |
| `1`–`9`, `0` | Select a card; press again or `Enter` to play it |
| `Q` / `E` or `←` / `→` | Cycle target |
| `Space` | End turn (press twice if you still have playable cards) |
| Right-click, or hold `Alt` | Exploded View: each component's exact contribution |
| `D` / `F` / `X` | View draw / discard / exhaust piles |
| `Esc` | Cancel selection, or return to the title |

## Project Layout

```
electron/        Electron main process (app:// protocol, atomic save IPC) and sandboxed preload
src/
  index.html     Page hosting the stacked canvases
  main.js        Boot: load content, create the stage, start the loop
  data/          Game content as JSON (vertical-slice subset of docs/CONTENT.md)
  game/core/     Headless logic: seeded RNG streams, event bus, content validation, registry
  game/model/    Card derivation (deriveCard), rules text, conditions, statuses, deck builders
  game/combat/   Combat engine (turns, intents, previews) and effect ops
  game/run/      Run state, map generator, Cargo, Workbench, Smelter, Anomalies, loot tables, economy constants
  render/        Letterboxed 1920x1080 canvas layers, loop, card compositing, FX, draw helpers
  input/         Rebindable hotkeys
  ui/            Widgets: button, Cargo Hold grid, Bézier targeting arrow
  scenes/        Title, map, combat, salvage (loot), Workbench, Smelter, Anomaly, run summary, shared run header
  platform/      Save/load bridge (Electron IPC, or localStorage in the browser)
tools/           Data validator, balance simulator, dev server, Node content loader
tests/           node --test suites
```

`src/game/` must never import from rendering, UI, platform, or Node modules, so it stays testable headlessly and reusable by the balance simulator. ESLint enforces this.
