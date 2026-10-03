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
npm run check         # lint, format check, typecheck, data validation, tests (what CI runs)
```

| Script                  | What it does                                                         |
| ----------------------- | -------------------------------------------------------------------- |
| `npm test`              | Unit tests with Node's built-in runner (`tests/**/*.test.js`)        |
| `npm run lint`          | ESLint, including the rule that keeps `src/game/` headless           |
| `npm run typecheck`     | `tsc` over JSDoc-annotated JavaScript (`// @ts-check`), no build step |
| `npm run validate-data` | Validates `src/data/*.json` fields, IDs, and cross-references        |
| `npm run format`        | Prettier                                                             |

## Project Layout

```
electron/        Electron main process (app:// protocol, atomic save IPC) and sandboxed preload
src/
  index.html     Page hosting the stacked canvases
  main.js        Boot: load content, create the stage, start the loop
  data/          Game content as JSON (vertical-slice subset of docs/CONTENT.md)
  game/core/     Headless logic: seeded RNG streams, event bus, content validation, registry
  render/        Letterboxed 1920x1080 canvas layers, fixed-timestep loop
  scenes/        Scene manager and the M0 boot scene
  platform/      Save/load bridge (Electron IPC, or localStorage in the browser)
tools/           Data validator, dev server, Node content loader
tests/           node --test suites
```

`src/game/` must never import from rendering, UI, platform, or Node modules, so it stays testable headlessly and reusable by the balance simulator. ESLint enforces this.
