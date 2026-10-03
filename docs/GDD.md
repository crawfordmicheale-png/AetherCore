# AETHERCORE: Game Design Document

> **Status:** v0.2 (expanded design, ready for vertical-slice production)
> **Companion docs:** [Content Catalog](CONTENT.md) · [Technical Design](TECHNICAL_DESIGN.md) · [Production Roadmap](ROADMAP.md)

---

## 1. Concept Overview

**Logline:** A deckbuilding roguelike where you do not find cards; you build them. Scavenge modular mechanical parts from destroyed enemies and assemble custom actions on the fly to survive a ruined, clockwork-magic world.

**Genre:** Roguelike Deckbuilder / Engine-Builder
**Platform:** PC (Windows/macOS/Linux)
**Primary Input:** Mouse & Keyboard
**Target Session:** 45–75 minutes per full run (3 Strata); 5–8 minutes per combat.
**Tech Stack:** HTML5 Canvas API and vanilla JavaScript (ES modules), packaged as a standalone PC executable via Electron. See [Technical Design](TECHNICAL_DESIGN.md).

### 1.1 Core Pillars

1. **Player Agency over RNG:** The player controls their build directly. RNG dictates the raw materials (components), but the player dictates the final product (the card).
2. **Tactical Inventory Management:** Loot does not go straight to the deck. The player manages a limited physical "Cargo Hold," forcing hard choices between holding parts for the perfect build or scrapping them for currency.
3. **Dynamic State-Checking:** Combat is highly reactive. Enemies can disable specific components on customized cards mid-fight, forcing players to adapt to shifting math.

### 1.2 Design Tests

Every new feature or piece of content should pass at least one of these tests, and must not fail any of them:

| Test | Question |
| --- | --- |
| **The Assembly Test** | Does this create a meaningful decision about *which parts go together*? |
| **The Cargo Test** | Does this make the player weigh *holding vs. crushing*? |
| **The Wrench Test** | Does this give enemies a way to interact with the player's architecture, or give the player a way to play around it? |
| **The Readability Test** | Can the player see the exact consequence before committing? (No hidden math.) |

### 1.3 World & Tone

The world of **Vell** was powered by the *Aethercore*, a city-sized engine that turned raw Aether into motion. When it cracked, the clockwork that ran everything (foundries, servitors, war-automata) kept running without a purpose. The land is now a sprawling, rusting industrial grid of foundries and pressure vaults, haunted by machines that scavenge each other for parts.

The player is a **Chassis**: a small, self-repairing automaton with a spark of will, climbing toward the cracked Aethercore at the top of the Spire. Each run is one ascent. Each death returns the Chassis' memory-core to the **Workshop**, a hidden sanctum where knowledge (not power) accumulates.

**Tone:** Melancholic industrial wonder. Brass, soot, glowing blue Aether veins, steam. Machines are not evil; they are broken and hungry. Humor comes from mechanical absurdity (a turret that apologizes in Morse code), never parody.

---

## 2. The Modular Crafting System

Every card in the player's deck is a composite entity assembled at a Workbench node. Cards consist of three structural layers, mathematically combined when the card's stats are derived.

| Component Type | Role in the Engine | PC Visual Representation (Canvas Layering) | Example |
| --- | --- | --- | --- |
| **Frame** | Dictates base energy cost, action verb (Attack / Defend / Utility), targeting, base value, and Capacity. | The base card background and structural border. | **Heavy Strike:** 2 Cost, 3 Capacity, 6 base damage. |
| **Core** | Dictates the raw numeric output (Power) and element. | Central focal icon, masked to the Frame's center cutout. | **Furnace Core:** +6 Power, Thermal (Burn 2). Weight: 2. |
| **Mod** | Injects rule-breaking logic, state-checks, or action economy changes. | A modular badge snapped onto the top-right corner. | **Spring-Loaded:** Draw 1 card when played. Weight: 1. |

### 2.1 Component Anatomy

**Frame** fields:

| Field | Meaning |
| --- | --- |
| `cost` | Energy cost to play (0–3). |
| `verb` | `attack`, `defend`, or `utility`. Determines what the Core's Power becomes. |
| `target` | `single`, `all`, `random`, or `self`. |
| `base` | Base damage (attack) or block (defend) before the Core. |
| `hits` | Number of times the effect repeats (default 1). |
| `coreScaling` | Multiplier applied to Core Power (default 1.0; multi-hit frames use 0.5). |
| `capacity` | Max combined weight of Core + Mod (0–4, upgradable). |
| `keywords` | Innate keywords (e.g., `Exhaust`, `Retain`, `Innate`). |

**Core** fields: `power` (integer), `element`, `weight` (0–3), optional `rider` overrides.

**Mod** fields: `weight` (0–2), one or more **hooks** (`onPlay`, `onDraw`, `whileInHand`, `onDiscard`, `onExhaust`, `onKill`) and/or **stat modifiers** (cost, power, hits, target, keywords), and optional **conditions** (state-checks).

A card **must** have a Frame and a Core. The Mod slot is optional. (A bare Frame with no Core cannot be assembled; this keeps every card's verb meaningful.)

### 2.2 Card Stat Derivation

When a card's stats are needed (in hand, on hover, on play), the engine derives them in a fixed order. The player always sees the result of this pipeline on the card face.

1. **Gather active components:** Skip any component currently **Suppressed** (see §3.4).
2. **Cost:** `frame.cost` + mod cost modifiers, clamped to a minimum of 0.
3. **Value per hit:** `frame.base + floor(core.power × frame.coreScaling)` + flat mod bonuses.
4. **Hits:** `frame.hits` + mod hit modifiers.
5. **Element rider:** Taken from the Core's element, interpreted by the Frame's verb (§2.4).
6. **Keywords:** Union of frame keywords, mod keywords, and `Exhaust` if Overclocked (§2.3).
7. **Combat multipliers (applied on resolution, previewed on hover):** Target statuses (Shock, Chill, etc.) and player statuses. Multipliers are applied after flat bonuses, then floored.

**Worked example:** *Heavy Strike* + *Furnace Core* + *Spring-Loaded*
- Weight: 2 + 1 = 3 ≤ Capacity 3 → stable.
- Cost: 2. Damage: 6 + 6 = **12**. Rider: apply **Burn 2**. Mod: **Draw 1**.

### 2.3 The Constraint Mechanics

* **Capacity Limit:** A Frame's capacity must be ≥ the combined weight of the socketed Core and Mod.
* **Unstable Overclocking:** Players can force components that exceed the Capacity limit, by at most **+2 weight**. Doing so grants the card the *Exhaust* keyword (removed from the deck for the rest of that combat after one use) and triggers screen-shake and particle friction upon use. The card returns to the deck after combat; nothing is permanently lost.
* **Overclock is evaluated live.** Exhaust is checked when the card is played, using only *active* components. If an enemy EMP suppresses the Mod on an overclocked card, its weight may drop back within capacity and the card will **not** Exhaust that turn. This is an intentional counterplay window: the Wrench can occasionally help you.
* **Overclock tiers (visual only):** +1 over = amber glow and light shake; +2 over = red glow, sparks, and heavy shake.

### 2.4 Elements & Riders

Each Core has an element. The element's effect depends on the Frame's verb. Riders scale with the Core, not the Frame: the rider value is listed on each Core.

| Element | Attack Rider | Defend Rider | Identity |
| --- | --- | --- | --- |
| **Kinetic** | *Crush:* deals double damage to Block. | *Reinforce:* +2 Block if you already have Block. | Highest raw Power, no lingering effects. |
| **Thermal** | Apply **Burn X**. | *Searing X:* the next enemy to attack you this turn gains Burn X. | Damage over time; punishes multi-attackers. |
| **Voltaic** | Apply **Shock X**. | Gain **Charge X**. | Burst setup and energy economy. |
| **Aether** | *Pierce:* ignores Block. | *Ward:* this Block also prevents the next debuff. | Rare, low Power, rule-bending. |
| **Cryo** *(R&D unlock)* | Apply **Chill X**. | *Rime:* this Block is not removed at the start of your next turn. | Control and attrition. |

**Utility** Frames interpret riders specially; each Utility Frame defines its own rule (e.g., *Conduit* applies the rider twice and deals no damage).

### 2.5 Statuses

| Status | On | Effect | Decay |
| --- | --- | --- | --- |
| **Block** | Any | Absorbs damage. | Removed at the start of the owner's turn. |
| **Burn X** | Any | Take X damage at the end of the owner's turn. | −1 per tick. |
| **Shock X** | Any | The next attack hit taken deals +3 damage per stack; all stacks are consumed. | Consumed on hit. |
| **Chill X** | Any | Deals 25% less attack damage. | −1 per turn. |
| **Charge X** | Player | At 3 Charge, consume 3 and gain 1 Energy immediately. | Persists through combat. |
| **Overheat** | Player | Applied by some enemies: your next Overclocked card costs +1. | Consumed. |
| **Jammed** | Player | Your next card played costs +1. | Consumed. |
| **Strength X** | Any | Attack hits deal +X damage. | Permanent for the combat. |
| **Fortified X** | Enemy | Gains X Block at the start of each of its turns. | Permanent. |
| **Plated X** | Enemy | Attack damage taken is reduced by X per hit (min 0). | −1 per hit received. |

### 2.6 Card Lifecycle

* **Assembled** at a Workbench → goes into the deck.
* **Disassembled** at a Workbench → components return to Cargo (if space) or are crushed into Aether.
* **Rusted** components (starter parts) cannot be placed into Cargo when disassembled; they always crush for 5 Aether. This makes starter cards cheap fodder, not hidden value.
* **Deck size limits:** minimum 8 cards, no maximum. (Thin decks are a valid strategy but have a floor so EMP and Slag still matter.)

---

## 3. Combat & Encounter Design

Combat utilizes the PC's 16:9 widescreen real estate to display rich information without nested menus.

### 3.1 Turn Structure

1. **Start of player turn:** Remove player Block (unless retained). Gain **3 Energy**. Draw **5 cards** (max hand size 10; overdraw is discarded). Resolve `startOfTurn` effects.
2. **Player action phase:** Play cards in any order. Each play resolves fully (including animations) before the next. Hotkeys queue plays.
3. **End of player turn:** Resolve `endOfTurn` effects in hand (Slag), then player Burn ticks. Discard hand (except Retain).
4. **Enemy turn:** Enemies remove their Block, then act in left-to-right order, executing the intent shown. Enemy Burn ticks at the end of each enemy's action.
5. **Intent reveal:** Each enemy rolls and displays its next intent.

**Player defaults:** 3 Energy, draw 5, max hand 10. HP depends on Chassis (§5.3).

### 3.2 PC UI & Controls

* **The Battlefield:** Enemies and the player are positioned in the top 60% of the screen. Hovering over an enemy reveals detailed tooltips of their buffs, debuffs, and exact upcoming intent (including the final number after the player's current statuses).
* **The Hand:** Displayed across the bottom 40%. Cards fan in an arc; the hovered card lifts and enlarges. Mouse targeting uses bezier-curve arrows dragged from the card to the enemy. Non-targeted cards are played by dragging above the hand line or clicking twice.
* **Damage preview:** While a targeting arrow hovers an enemy, that enemy's HP bar shows a ghosted segment of the exact damage the card would deal.
* **Exploded View:** Right-clicking a composite card opens an exploded-view tooltip showing its exact Frame, Core, and Mod breakdown, each with its contribution to the final numbers, its weight, and whether it is suppressed.

**Hotkeys**

| Key | Action |
| --- | --- |
| `1`–`9`, `0` | Select card 1–10 in hand. Press again or click an enemy to play. |
| `Q` / `E` or `←` / `→` | Cycle target when a card is selected. |
| `Space` | End turn (hold 0.3s to confirm if playable cards with energy remain; configurable). |
| `Tab` | Toggle the run map side panel. |
| `D` / `F` / `X` | View draw pile / discard pile / exhaust pile. |
| `Right-click` / `Alt` | Exploded view of the hovered card. |
| `Esc` | Cancel selection / pause menu. |

### 3.3 Enemy Intents

Intents are always visible and always exact. Icons:

| Intent | Icon | Meaning |
| --- | --- | --- |
| Attack | Piston | Deals X damage (×hits). |
| Defend | Rivet shield | Gains X Block. |
| Buff | Up-gear | Buffs self or allies. |
| Debuff | Down-gear | Applies a status to the player. |
| **Suppress** | Crossed wrench + slot glyph | Disables a component slot (see §3.4). The glyph shows which slot (Frame/Core/Mod). |
| **Slag** | Dripping ingot | Inserts Slag cards; shows count and destination (hand / draw / discard). |
| Unknown | `?` gear | Reserved for bosses' phase transitions only. |

### 3.4 Enemy Interaction ("The Wrench in the Gears")

Enemies interact directly with the player's custom architecture.

**Component Suppression.** Elite and some normal enemies can Suppress a slot type. A Suppressed component contributes nothing (no stats, no hooks, **no weight**). The rendering engine greys the component's layer out and instantly recalculates the card's stats.

| Suppression | Slot | Effect | Typical Duration |
| --- | --- | --- | --- |
| **EMP** | Mod | All Mods in hand are disabled. | Until end of player's next turn. |
| **Dampening Field** | Core | Cores in hand lose their element rider (Power still applies). | 1 turn. |
| **Seizure** | Frame | A random card's Frame costs +1 and its capacity drops by 1 (may cause Overclock). | 1 turn. |
| **Magnet Lock** | Any | The highest-weight card in hand cannot be played. | 1 turn. |

Rules:
* Suppression applies to cards **in hand** at the moment it resolves, plus cards drawn while it is active, unless the enemy's tooltip says otherwise.
* Suppression is always telegraphed one turn in advance via intent.
* Some Blueprints and Mods grant immunity or benefit from suppression (e.g., *Faraday Lining*, *Fail-Safe*).

**The Slag System.** Enemies insert **Slag** (junk cards) into the player's piles. Slag clogs draws and interacts destructively with specific Cores.

| Slag | Cost | Effect |
| --- | --- | --- |
| **Molten Slag** | Unplayable | While in hand, playing a **Kinetic** Core card deals 3 damage to you. End of turn in hand: gain Burn 1. |
| **Static Slag** | Unplayable | While in hand, playing a **Voltaic** Core card Jams you (next card costs +1). |
| **Rust Slag** | Unplayable | While in hand, all Frames in hand have −1 Capacity (can push cards into Overclock). |
| **Sludge** | 1 | Play to Exhaust it. Does nothing else. |
| **Cinder** | Unplayable, Ethereal | Exhausts at end of turn if still in hand; when drawn, take 2 damage. |

Combat Slag is removed after combat. **Fused Slag** (from a few elites and events) is permanently added to the deck and must be removed at a Smelter (§4.5).

### 3.5 Encounter Structure

* **Standard combats:** 1–3 enemies, built from encounter tables per Stratum (see [Content Catalog](CONTENT.md)).
* **Elites:** 1 Elite, sometimes with 1–2 minions. Every Elite has at least one Wrench mechanic (Suppress or Slag).
* **Bosses:** 1 per Stratum, multi-phase, with a phase-specific Wrench gimmick.
* **No repeat rule:** The same encounter cannot appear twice in a row; the first 3 combats of Stratum 1 draw from an "easy" pool.

### 3.6 Combat Feedback

* **Overclocked play:** screen shake (amplitude scales with overclock tier), spark particles from the card's Frame seams, and a grinding SFX. The card visibly cracks before dissolving into the Exhaust pile.
* **Suppression:** a sweeping static wave crosses the hand; affected layers desaturate with a "power-down" whine; number changes tick down visibly.
* **Kill:** enemy bursts into parts. The parts that are actual loot drops glow and fly into a "pending loot" tray in the top-right corner, building anticipation for the reward screen.

---

## 4. The Roguelike Loop & Map Progression

### 4.1 Run Structure

A run consists of **3 Strata**, each ending in a boss. After each boss, the player reaches an **Extraction Lift** (§5.1).

| Stratum | Name | Rows | Theme |
| --- | --- | --- | --- |
| 1 | **The Foundry Floor** | 15 | Furnaces, conveyors, scrap drones. Teaches Slag and basic Suppression. |
| 2 | **The Pressure Vaults** | 15 | Steam pipes, sealed vaults, armored automata. Heavier Suppression, Plated/Fortified enemies. |
| 3 | **The Aether Spire** | 12 | Cracked crystal and raw Aether. Enemies with element-twisting effects. Final boss: the Aetherheart. |

### 4.2 Map Generation

The map is a procedurally generated **industrial grid**: a 7-column lattice of nodes connected by conveyor paths that only move upward. The player chooses one connected node per row.

* Generate 6 paths from random bottom-row columns to the top row; each step moves to an adjacent column (−1, 0, +1) without crossing an existing path.
* Assign node types by row rules and weights (below), then repair violations.
* Because PC allows complex on-screen layouts, the map stays visible on a collapsible side panel (`Tab`) while the player manages inventory.

**Node weights (rows without fixed rules):**

| Node | Weight | Constraints |
| --- | --- | --- |
| Scrap Heap (combat) | 45% | Row 1 is always Scrap Heaps. |
| Anomaly (event) | 18% | |
| Workbench | 14% | Not on consecutive rows of a path. |
| Elite Wreck | 12% | Not before row 5. Max 1 per path segment of 4 rows. |
| Smelter | 11% | Not before row 3. |

**Fixed rows:** Row 1 = Scrap Heap. Middle row (8) = Workbench on all nodes. Second-to-last row = Workbench on all nodes ("pre-boss bench"). Last row = Boss.

### 4.3 Node Types

1. **Scrap Heaps (Standard Combat):** Drops basic Frames, common Cores, and minor Aether.
2. **Elite Wrecks:** High-risk encounters. Guaranteed drop of high-tier Mods and **Blueprints** (passive run-altering relics).
3. **The Workbench:** The only node where players can assemble cards, swap components, or dismantle starter cards into Aether. Also the only place to heal (see §4.4).
4. **The Smelter:** The merchant node. Players spend Aether to buy specialized parts, upgrade a base Frame's Capacity, fuse three junk parts into a higher-tier component, or remove Fused Slag.
5. **Anomalies (Events):** Short narrative choices with mechanical stakes (trade HP for parts, gamble cargo, fight optional enemies). See the [Content Catalog](CONTENT.md) for the launch set.

### 4.4 The Workbench

Each Workbench visit grants **3 Tool Charges**. Every operation costs 1 charge:

| Operation | Effect |
| --- | --- |
| **Assemble** | Combine a Frame + Core (+ optional Mod) from Cargo into a new card. |
| **Swap** | Replace one component on an existing card with one from Cargo. The removed part goes to Cargo (or is crushed if Cargo is full). |
| **Dismantle** | Break a card into its components (to Cargo; Rusted parts auto-crush to 5 Aether). |
| **Tune** | Permanently reduce one Core's or Mod's weight by 1 (min 0). Max once per component. |

**Field Repair:** Instead of using any charges, the player may perform a Field Repair: heal **30% of max HP**. This consumes all charges for the visit. This is the core "rest vs. upgrade" tension.

**UI:** Deck list (left), Cargo Hold (right), assembly bench (center) with three sockets and a live preview card. A capacity gauge fills as parts are socketed; it turns amber/red when overclocking. Nothing is committed until the player presses **Weld** (and the preview always shows the final card).

### 4.5 The Smelter

| Service | Cost | Notes |
| --- | --- | --- |
| **Buy parts** | Varies by tier | 6 offerings: 2 Frames, 2 Cores, 2 Mods. One random offering is 30% off. |
| **Capacity Upgrade** | 50 / 75 / 100 Aether (escalates per run) | +1 Capacity to any Frame (in deck or Cargo). Max +2 per Frame. |
| **Fusion** | 20 Aether | Insert 3 components of the same tier → choose a component *type* → receive a random component of that type at the next tier. |
| **Slag Removal** | 40 Aether, +15 per use | Remove one Fused Slag or one card from the deck. |

**Prices by tier:** Salvage 30–45 · Refined 70–90 · Prototype 140–170.

### 4.6 Loot & Rewards

| Source | Components | Aether | Other |
| --- | --- | --- | --- |
| Scrap Heap | 2 drops: Salvage (75%) / Refined (25%); Frames & Cores weighted 2:2:1 vs Mods | 12–20 | |
| Elite Wreck | 1 guaranteed Refined+ Mod, 1 Salvage+ random component | 30–40 | Choose 1 of 3 Blueprints |
| Boss | Choose 1 of 3 Prototype components | 75 | 1 Encrypted Schematic, choose 1 of 3 Blueprints |

Drop tables are weighted toward the **elements of the enemies defeated** (e.g., Boiler Mites drop Thermal Cores more often), so players can partly steer loot by choosing paths.

### 4.7 The Cargo Hold (Inventory Pressure)

Combat loot is placed in a **10-slot** Cargo Hold. If the hold is full, the player must crush parts into Aether or leave loot behind. This segregates the act of *looting* from the act of *deckbuilding*, creating anticipation as players carry a rare Mod through three combat encounters just to reach a Workbench.

* Each component occupies **1 slot**. Encrypted Schematics occupy **1 slot** and cannot be crushed.
* **Crushing** can be done at any time outside combat. Crush values: Salvage **8** · Refined **18** · Prototype **40** Aether. (Roughly 25% of the buy price: crushing is a loss, not a free conversion.)
* **Loot screen:** All drops appear in a tray. The player drags items into Cargo, or crushes them directly from the tray. Items left in the tray when the player clicks *Continue* are lost (with a confirmation prompt).
* Cargo is visible and manageable from the map screen, so the player can plan while choosing a path.

---

## 5. Meta-Progression (The Workshop)

When a player dies or completes a run, they return to the Workshop. Progression focuses on **horizontal expansion (variety)** rather than vertical power scaling. A brand-new player and a 100-hour player start a run with the same raw power on the same Chassis.

### 5.1 Encrypted Schematics & Extraction

* **Encrypted Schematics** are found on bosses (and rarely in Anomalies). They take up a Cargo slot during the run, penalizing inventory space.
* **Extraction Lifts** appear after each boss. The player chooses:
  * **Extract:** End the run now. All carried Schematics convert to Insight. Counts as a successful run for progression purposes (not for victory).
  * **Ascend:** Continue to the next Stratum, carrying the Schematics (and their cargo cost) forward.
* **Death:** Carried Schematics are lost. The player still earns **base Insight** from progress (see below), so no run is wasted.
* Defeating the Stratum 3 boss automatically extracts everything.

**Insight sources:**

| Source | Insight |
| --- | --- |
| Per Stratum cleared | 10 |
| Per Elite defeated | 3 |
| Each Encrypted Schematic extracted | 25 (Stratum 1) / 35 (Stratum 2) / 50 (Stratum 3) |
| First victory with a Chassis | 50 |

### 5.2 R&D Unlock Paths

Players spend Insight to permanently inject new, complex mechanics into the global drop pool. The R&D board has three branches. Each node unlocks content (never raw stats).

| Branch | Example Unlocks |
| --- | --- |
| **Elemental Research** | Cryo Cores & Cryo enemies · Voltaic chain Mods (*Conductor*, *Arc Relay*) · Aether Prism variants |
| **Mechanical Research** | Echo Mods (replay effects) · Multi-hit Frames (*Gatling*, *Piston Array*) · Utility Frames (*Recycler*) |
| **Logistics Research** | New Anomalies · New Smelter services (e.g., *Reforge*: reroll a component's tier) · Additional Blueprints in the pool |

* Costs: Tier 1 nodes 30 Insight, Tier 2 nodes 60, Tier 3 nodes 100.
* Each branch has ~8 nodes at launch. The player may **toggle off** unlocked content in a "Pool Config" panel for players who want a narrower pool (an advanced option).

### 5.3 Starting Chassis (Classes)

| Chassis | HP | Unlock | Passive | Starting Deck (10) | Starting Cargo |
| --- | --- | --- | --- | --- | --- |
| **The Tinker** | 65 | Default | *Field Kit:* the first Workbench each Stratum grants +1 Tool Charge. | 4× Strike/Scrap · 4× Brace/Scrap · 1× Heavy Strike/Kinetic Slug · 1× Strike/Arc Cell | 1 random Salvage Mod |
| **The Machinist** | 75 | 120 Insight | *Momentum Recovery:* when a single hit deals 12+ damage, refund 1 Energy (once per turn). | 3× Heavy Strike/Scrap · 3× Bulwark/Scrap · 2× Strike/Kinetic Slug · 1× Heavy Strike/Piston Core · 1× Brace/Scrap | 1 Ballast Mod |
| **The Spark-Weaver** | 55 | Clear Stratum 2 once | *Cascade:* when you apply a status to an enemy that already has a different status, apply +1 stack. | 4× Jab/Arc Cell · 2× Jab/Ember Core · 3× Plating/Scrap · 1× Conduit/Ember Core | 1 Spring-Loaded Mod |
| **The Salvager** *(post-launch)* | 60 | Win with any Chassis | *Pack Rat:* Cargo has 14 slots. Crushing a part during a run grants 2 Block at the start of the next combat (stacks). | TBD | 3 random Salvage parts |

The **Machinist** wants few, heavy, high-capacity cards with big Cores. The **Spark-Weaver** wants many cheap, low-capacity cards stacking statuses. The Tinker sits between and teaches the system.

### 5.4 Pressure Levels (Difficulty)

After a first victory, **Pressure** levels unlock one at a time (per Chassis), each adding a modifier cumulatively. Examples:

1. Elites have +10% HP.
2. Cargo Hold has 9 slots.
3. Workbenches grant 2 Tool Charges.
4. Enemies apply Suppression 1 turn earlier in their patterns.
5. Start each run with 1 Fused Sludge in the deck.
6. Bosses gain a third phase mechanic.
7. Crush values reduced by 25%.
8. Field Repair heals 20%.
9. Overclock limit reduced to +1.
10. Double bosses at Stratum 3.

### 5.5 Codex & Records

The Workshop includes a **Codex** (every component, enemy, and Blueprint seen, with lore snippets) and a **Records** board (best runs, favorite assemblies, "most overclocked card"). Players can **pin an assembly** to the Codex as a reference recipe; pinned recipes show a small marker in loot screens when a matching part drops.

---

## 6. Blueprints (Relics)

Blueprints are passive run-long effects. They never occupy Cargo. Pool at launch: ~30 (see [Content Catalog](CONTENT.md)). Design guidelines:

* At least half of all Blueprints should interact with the **crafting** or **cargo** layers, not just combat numbers.
* Blueprints should open strategies rather than flatly increase power (e.g., *Heat Sink* makes overclocking a plan, not a mistake).

---

## 7. Presentation

### 7.1 Art Direction

* **Style:** Painterly 2D with crisp linework. Layered parallax backgrounds. Brass, iron, and soot palette with saturated element accents: Kinetic (steel grey/white), Thermal (orange/red), Voltaic (electric cyan), Aether (violet), Cryo (pale blue).
* **Cards:** Frame art carries the silhouette and type (Attack frames are angular and toothed; Defend frames are round and riveted; Utility frames are open lattices). Cores glow in their element color. Mods are physical badges with visible bolts. The card should read as a *physical object that was built*.
* **Resolution:** Authored at 1920×1080 logical resolution; card art at 2× for crisp zoom in the exploded view.

### 7.2 Audio Direction

* Music: Layered industrial ambient with a ticking-clock pulse; combat adds percussion layers as intensity rises (based on enemy count / player HP).
* SFX: Every component type has a distinct "socket" sound (Frame: heavy clunk; Core: humming click; Mod: ratchet snap). Overclocking adds a grinding layer. Suppression uses a power-down whine.

### 7.3 Accessibility

* Colorblind-safe element icons (every element has a unique shape, not just a color).
* Screen shake intensity slider (0–100%); particle density slider.
* Text size options; full keyboard play; hold-to-confirm toggles.
* Animation speed: 1×, 1.5×, 2×, and "Instant."

---

## 8. Scope

### 8.1 MVP (Vertical Slice) Definition

The vertical slice proves the three pillars in one Stratum:

* 1 Chassis (Tinker), Stratum 1 only, with boss.
* ~12 Frames, ~12 Cores, ~15 Mods, 4 Slag types, 10 Blueprints.
* 6 normal enemies, 2 Elites, 1 Boss.
* Workbench, Smelter, Cargo, and 4 Anomalies.
* No meta-progression yet (stubbed Workshop screen).

### 8.2 Launch (1.0) Target

* 3 Chassis, 3 Strata, 3 bosses.
* ~25 Frames, ~25 Cores, ~40 Mods, ~30 Blueprints, ~20 Anomalies.
* ~25 enemies including 6 Elites.
* Full R&D board, Pressure 1–10, Codex.

### 8.3 Out of Scope (for 1.0)

* Multiplayer, daily challenges with leaderboards (seeded runs are supported locally, though), mod/workshop support, controller support (considered post-launch), localization beyond English (but all strings are externalized from day one).

---

## 9. Open Questions

| # | Question | Current Lean |
| --- | --- | --- |
| 1 | Should Tune (weight −1) be a Workbench op or a Smelter service? | Workbench, to keep Smelter about Aether. Revisit after playtests. |
| 2 | Can Mods be socketed onto starter (Rusted) cards? | Yes. Early Mods should be usable immediately. |
| 3 | Should Overclock ever be permanent (card destroyed)? | No. Exhaust-per-combat only. Permanent loss conflicts with Pillar 1. |
| 4 | Do Utility Frames need a third rider column per element? | Each Utility Frame defines its own rule; revisit if more than ~4 Utility Frames exist. |
| 5 | Is 10 Cargo slots right? | Start at 10; instrument "items left behind" and "crush rate" in playtests. |
