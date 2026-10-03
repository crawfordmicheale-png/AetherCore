# AETHERCORE: Production Roadmap

> Milestones are ordered so that the riskiest design question, "is building cards fun?", is answered first, in graybox, before art or content investment.

Each milestone has **exit criteria**; do not start the next milestone's content work until they are met (engineering may overlap).

---

## M0: Foundations (1 week)

* Repo scaffold per [Technical Design §2](TECHNICAL_DESIGN.md#2-project-structure): `src/`, `electron/`, `tests/`, `tools/`.
* ESLint, Prettier, `tsc --noEmit` JSDoc checking, `node --test`, GitHub Actions CI.
* Seeded RNG with streams, event bus, content registry, data validator.
* Electron shell that opens a 1920×1080 letterboxed canvas; browser dev mode via static server.

**Exit:** CI green; `npm start` opens an empty window; `npm test` runs.

## M1: Combat Graybox (2–3 weeks)

* Card derivation engine (`deriveCard`) with full test coverage.
* Combat state machine, action queue, ops (`damage`, `block`, `applyStatus`, `draw`, `gainEnergy`, `addSlag`, `suppress`).
* Statuses: Block, Burn, Shock, Chill, Charge, Strength, Jammed.
* Graybox rendering: rectangles and text for cards/enemies; hand fan; Bézier targeting arrow; intents; hotkeys.
* Tinker starter deck vs. 3 Stratum 1 enemies; Foreman Gantry (EMP) to test Suppression.
* Exploded View tooltip (data-only, no art).

**Exit:** A full fight is playable with mouse and keyboard only; preview damage always matches actual damage; EMP visibly recalculates hand cards.

## M2: Crafting Loop (2 weeks)

* Cargo Hold model + UI (drag/drop, crush).
* Loot tray after combat.
* Workbench scene: Assemble, Swap, Dismantle, Tune, Field Repair; live preview card; capacity gauge; Overclock.
* Overclock feedback: shake + particles (graybox).

**Exit:** Playtesters can chain 3 combats with a Workbench between them, and at least half of them build an Overclocked card voluntarily.

## M3: The Run (2–3 weeks)

* Map generator (7-column grid, path rules, node weights) and map scene/side panel.
* Smelter (buy, Capacity Upgrade, Fusion, Slag removal); 4 Anomalies.
* Elites (3) and Blueprints (10); Boss: The Crucible Engine.
* Run save/load at node boundaries and combat turn start.
* Balance simulator v1.

**Exit:** A full Stratum 1 run is completable start to finish in 25–35 minutes; save/quit/resume works mid-combat.

## M4: Vertical Slice (3–4 weeks)

* Final art pipeline for cards: Frame/Core/Mod layers, masks, element glows, suppression overlays.
* Art for Stratum 1 enemies, background, UI kit.
* Audio pass: socket sounds, combat SFX, 1 music track with intensity layers.
* Content at slice targets ([GDD §8.1](GDD.md#81-mvp-vertical-slice-definition)).
* Accessibility settings: shake/particle sliders, animation speed, text size.

**Exit:** External playtest (10–20 players). Target metrics: median session ≥ 2 runs; ≥ 60% of players say crafting is the most memorable part; no "I didn't know why that happened" reports on Suppression.

## M5: Meta-Progression (2 weeks)

* Workshop scene, Insight economy, Extraction Lifts, Encrypted Schematics.
* R&D board (3 branches, Tier 1–2 nodes) and Pool Config.
* Machinist Chassis.
* Codex and Records.

**Exit:** Insight pacing gives a new unlock every 1–2 runs for the first ~10 runs.

## M6: Strata 2 & 3 (6–8 weeks)

* Pressure Vaults and Aether Spire enemies, Elites, bosses (Arbiter of Gears, Aetherheart).
* Spark-Weaver Chassis; Cryo element; Echo Mods.
* Content to 1.0 targets ([GDD §8.2](GDD.md#82-launch-10-target)); Pressure levels 1–10.

**Exit:** Simulator and human win rates within target bands: Pressure 0 ≈ 25–35% for experienced players.

## M7: Release (3–4 weeks)

* Steam integration (achievements, cloud saves), code signing and notarization.
* Performance pass against the [budget](TECHNICAL_DESIGN.md#65-performance-budget).
* Onboarding: first-run tutorial combat and guided first Workbench.
* Early Access launch.

---

## Key Risks

| Risk | Mitigation |
| --- | --- |
| Crafting is tedious rather than exciting | Tool Charges cap Workbench time; live preview; one-click "Weld". Measure Workbench time per visit in M2. |
| Suppression feels unfair | Always telegraph a turn ahead; exact intents; counterplay Mods/Blueprints in the slice. |
| Combinatorial balance explosion | Headless simulator from M3; data validation rules; conservative Overclock limit. |
| Canvas UI work balloons | Build a small widget kit in M1 (button, panel, tooltip, drag/drop) and reuse it everywhere. |
| Animation/logic desync | Logic-first event log; renderer is a pure consumer; replay tests in CI. |
