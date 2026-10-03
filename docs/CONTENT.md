# AETHERCORE: Content Catalog

> Companion to the [Game Design Document](GDD.md). All numbers are first-pass tuning values for the vertical slice and are expected to change in playtesting. This file is the source of truth to transcribe into `src/data/*.json` (see [Technical Design](TECHNICAL_DESIGN.md) §4).

**Tiers:** `S` = Salvage (common) · `R` = Refined (uncommon) · `P` = Prototype (rare) · `—` = Starter (Rusted, never drops).
**Unlock:** `Base` = in the pool from the first run · `R&D` = requires an R&D node · `Slice` = included in the vertical slice.

---

## 1. Frames

| ID | Name | Tier | Verb | Cost | Cap | Target | Base | Hits | Core Scaling | Keywords / Special | Unlock |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `frame_strike` | Strike | — / S | Attack | 1 | 2 | Single | 4 | 1 | 1.0 | | Slice |
| `frame_heavy_strike` | Heavy Strike | S | Attack | 2 | 3 | Single | 6 | 1 | 1.0 | | Slice |
| `frame_jab` | Jab | S | Attack | 0 | 1 | Single | 0 | 1 | 1.0 | | Slice |
| `frame_sweep` | Sweep | S | Attack | 2 | 2 | All | 3 | 1 | 1.0 | | Slice |
| `frame_twin_piston` | Twin Piston | R | Attack | 1 | 2 | Single | 2 | 2 | 0.5 | | Slice |
| `frame_ram` | Battering Ram | R | Attack | 3 | 4 | Single | 12 | 1 | 1.0 | Kinetic Cores gain +3 Power | Slice |
| `frame_scattershot` | Scattershot | R | Attack | 1 | 2 | Random | 2 | 3 | 0.5 | | Base |
| `frame_lance` | Aether Lance | P | Attack | 2 | 3 | Single | 5 | 1 | 1.5 | | Base |
| `frame_gatling` | Gatling | P | Attack | 2 | 3 | Random | 1 | 5 | 0.5 | | R&D |
| `frame_piston_array` | Piston Array | P | Attack | 3 | 4 | All | 4 | 2 | 0.5 | | R&D |
| `frame_brace` | Brace | — / S | Defend | 1 | 2 | Self | 3 | 1 | 1.0 | | Slice |
| `frame_bulwark` | Bulwark | S | Defend | 2 | 3 | Self | 8 | 1 | 1.0 | | Slice |
| `frame_plating` | Plating | S | Defend | 0 | 1 | Self | 1 | 1 | 1.0 | | Slice |
| `frame_aegis` | Aegis Cage | R | Defend | 2 | 3 | Self | 6 | 1 | 1.0 | Retain | Slice |
| `frame_counterweight` | Counterweight | R | Defend | 1 | 2 | Self | 4 | 1 | 1.0 | Next Attack this turn deals +Block gained ÷ 2 | Base |
| `frame_bastion` | Bastion | P | Defend | 3 | 4 | Self | 14 | 1 | 1.5 | | Base |
| `frame_conduit` | Conduit | S | Utility | 1 | 2 | Single | — | — | — | Deals no damage; applies the Core's Attack rider **twice** | Slice |
| `frame_relay` | Relay | R | Utility | 0 | 1 | Self | — | — | — | Gain the Core's **Defend** rider; draw 1 | Slice |
| `frame_furnace_vent` | Furnace Vent | R | Utility | 1 | 3 | All | — | — | — | Apply the Core's Attack rider to **all** enemies; Exhaust | Base |
| `frame_recycler` | Recycler | R | Utility | 0 | 2 | Self | — | — | — | Draw 1 + Core weight cards; Exhaust | R&D |
| `frame_capacitor_bank` | Capacitor Bank | P | Utility | 1 | 3 | Self | — | — | — | Next turn, gain Energy equal to Core weight | R&D |

---

## 2. Cores

Rider values: Burn/Shock/Chill/Searing/Charge X use the Core's **Rider** column. Kinetic and Aether riders are fixed effects (see [GDD §2.4](GDD.md#24-elements--riders)).

| ID | Name | Tier | Element | Power | Rider | Weight | Notes | Unlock |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `core_scrap` | Scrap Core | — | Kinetic | 2 | — | 0 | Rusted. Kinetic rider does not apply. | Slice |
| `core_kinetic_slug` | Kinetic Slug | S | Kinetic | 4 | Crush / Reinforce | 1 | | Slice |
| `core_piston` | Piston Core | R | Kinetic | 8 | Crush / Reinforce | 3 | | Slice |
| `core_flywheel` | Flywheel Core | R | Kinetic | 5 | Crush / Reinforce | 2 | +1 Power each time it is played this combat | Slice |
| `core_ember` | Ember Core | S | Thermal | 2 | 1 | 1 | | Slice |
| `core_furnace` | Furnace Core | R | Thermal | 6 | 2 | 2 | | Slice |
| `core_magma` | Magma Heart | P | Thermal | 7 | 4 | 3 | | Base |
| `core_arc_cell` | Arc Cell | S | Voltaic | 3 | 1 | 1 | | Slice |
| `core_dynamo` | Dynamo | R | Voltaic | 4 | 2 | 2 | | Slice |
| `core_tesla_coil` | Tesla Coil | P | Voltaic | 5 | 3 | 2 | Rider also applies to a random other enemy | Base |
| `core_aether_shard` | Aether Shard | R | Aether | 2 | Pierce / Ward | 1 | | Slice |
| `core_aether_prism` | Aether Prism | P | Aether | 4 | Pierce / Ward | 2 | | Base |
| `core_hollow` | Hollow Core | S | Kinetic | 0 | — | 0 | No Power. Exists to carry Mods on Utility Frames cheaply. | Base |
| `core_frost_shard` | Frost Shard | S | Cryo | 3 | 1 | 1 | | R&D |
| `core_glacier` | Glacier Core | R | Cryo | 5 | 2 | 2 | | R&D |
| `core_absolute_zero` | Absolute Zero | P | Cryo | 4 | 3 | 2 | Also removes all Burn from the target | R&D |

---

## 3. Mods

Mods are where the rule-breaking lives. **State-check** Mods are marked ⚙ and are the primary home of Pillar 3.

| ID | Name | Tier | Weight | Effect | Unlock |
| --- | --- | --- | --- | --- | --- |
| `mod_spring_loaded` | Spring-Loaded | S | 1 | Draw 1 card when played. | Slice |
| `mod_ballast` | Ballast | S | 1 | +3 Block when played (in addition to any other effect). | Slice |
| `mod_whetted` | Whetted Edge | S | 1 | +2 value per hit. | Slice |
| `mod_hair_trigger` | Hair Trigger | R | 2 | Cost −1. | Slice |
| `mod_twin_linked` | Twin-Linked | R | 2 | +1 hit. | Slice |
| `mod_gyro` | Gyro-Stabilizer | S | 1 | Retain. | Slice |
| `mod_ricochet` | Ricochet | R | 1 | After resolving, repeat once against a random **other** enemy for 50% value. | Slice |
| `mod_siphon` | Siphon Valve | R | 2 | Heal 1 HP per 5 unblocked damage dealt (max 3). | Slice |
| `mod_executioner` ⚙ | Executioner | R | 1 | If the target is below 30% HP, +50% damage. | Slice |
| `mod_conductor` ⚙ | Conductor | R | 1 | If the target has Shock, the Shock bonus also hits every other enemy. | R&D |
| `mod_kindling` ⚙ | Kindling | S | 1 | If the target has Burn, +3 value. | Slice |
| `mod_resonator` ⚙ | Resonator | R | 1 | +2 value for each **other** card in hand sharing this card's element. | Slice |
| `mod_last_gasp` ⚙ | Last Gasp | R | 1 | If this is the last card in your hand, cost 0. | Base |
| `mod_fail_safe` ⚙ | Fail-Safe | R | 1 | Unsuppressable. +4 value while another part of this card is Suppressed. | Slice |
| `mod_grounding` ⚙ | Grounding Rod | S | 1 | When played, if you have Slag in hand, Exhaust one Slag. | Slice |
| `mod_heat_exchanger` ⚙ | Heat Exchanger | R | 1 | If you have Burn, remove it and add its stacks to this card's Burn rider. | Base |
| `mod_overdrive` | Overdrive | P | 2 | Double the Core's Power. Always Overclocks this card (adds Exhaust even if within capacity). | Base |
| `mod_feedback` | Feedback Loop | R | 1 | When this card Exhausts, gain 1 Energy. | Base |
| `mod_magnetic_clamp` | Magnetic Clamp | S | 0 | Innate (always drawn in the opening hand). | Base |
| `mod_scavenger` | Scavenger's Hook | R | 1 | If this kills an enemy, that enemy drops +1 loot roll. | Slice |
| `mod_echo` | Echo Chamber | P | 2 | At the start of your next turn, replay this card's effect at 50% value (free, no target choice: same target or random). | R&D |
| `mod_echo_minor` | Faint Echo | R | 1 | When this card is discarded unplayed, deal/gain 50% of its value. | R&D |
| `mod_arc_relay` ⚙ | Arc Relay | R | 1 | If you have 2+ Charge, this card costs 0. | R&D |
| `mod_cold_storage` ⚙ | Cold Storage | R | 1 | Retain. Gains +2 value each turn it is Retained (resets when played). | R&D |
| `mod_balanced` | Counterbalance | P | 1 | This card's weight counts as 0 for Capacity (the Mod itself still weighs 1). | Base |

---

## 4. Slag

See [GDD §3.4](GDD.md#34-enemy-interaction-the-wrench-in-the-gears) for rules.

| ID | Name | Playable | Effect | Unlock |
| --- | --- | --- | --- | --- |
| `slag_molten` | Molten Slag | No | Playing a Kinetic Core card while this is in hand: take 3 damage. End of turn: gain Burn 1. | Slice |
| `slag_static` | Static Slag | No | Playing a Voltaic Core card while this is in hand: become Jammed. | Slice |
| `slag_rust` | Rust Slag | No | All Frames in hand have −1 Capacity. | Slice |
| `slag_sludge` | Sludge | Cost 1 | Play to Exhaust. | Slice |
| `slag_cinder` | Cinder | No, Ethereal | When drawn, take 2 damage. Exhausts at end of turn. | Base |
| `slag_frost` | Frozen Slag | No | Playing a Thermal Core card while this is in hand: the Burn rider is removed. | R&D |

**Fused** variants (`slag_fused_*`) are permanent deck additions with identical effects, marked with a cracked-ingot border.

---

## 5. Blueprints (Relics)

| ID | Name | Tier | Effect | Layer |
| --- | --- | --- | --- | --- |
| `bp_torque_wrench` | Torque Wrench | Common | Workbenches grant +1 Tool Charge. | Crafting |
| `bp_expanded_hold` | Expanded Hold | Common | +2 Cargo slots. | Cargo |
| `bp_magnetic_sorter` | Magnetic Sorter | Common | Crushing yields +50% Aether. | Cargo |
| `bp_heat_sink` | Heat Sink | Uncommon | The first Overclocked card you play each combat does not Exhaust. | Crafting |
| `bp_flywheel` | Spare Flywheel | Common | Gain 1 extra Energy on turn 1 of each combat. | Combat |
| `bp_faraday` | Faraday Lining | Uncommon | Ignore the first Suppression each combat. | Wrench |
| `bp_slag_filter` | Slag Filter | Common | The first Slag added to your piles each combat is Exhausted instead. | Wrench |
| `bp_scrap_magnet` | Scrap Magnet | Uncommon | Elites drop +1 component. | Cargo |
| `bp_governor` | Centrifugal Governor | Uncommon | Overclock limit becomes +3 weight. | Crafting |
| `bp_spare_gasket` | Spare Gasket | Common | Field Repair heals an additional 10% max HP. | Loop |
| `bp_jeweler_loupe` | Jeweler's Loupe | Uncommon | Loot screens show one extra component to choose from. | Cargo |
| `bp_quick_release` | Quick-Release Sockets | Rare | Once per combat, you may Swap a Mod between two cards in hand (free action). | Crafting |
| `bp_ballast_tank` | Ballast Tank | Common | Start each combat with 6 Block. | Combat |
| `bp_thermocouple` | Thermocouple | Uncommon | Whenever an enemy takes Burn damage, gain 1 Charge. | Combat |
| `bp_pressure_gauge` | Pressure Gauge | Rare | Cards with exactly full Capacity (weight = capacity) deal/gain +2 value. | Crafting |
| `bp_salvage_rights` | Salvage Rights | Uncommon | Smelter offerings are 20% cheaper. | Loop |
| `bp_reinforced_crate` | Reinforced Crate | Rare | Schematics no longer occupy Cargo slots. | Meta |
| `bp_overpressure_valve` | Overpressure Valve | Rare | Whenever a card Exhausts from Overclock, deal 5 damage to all enemies. | Crafting |
| `bp_lodestone` | Lodestone | Uncommon | Your highest-weight card in hand cannot be Magnet Locked or Seized. | Wrench |
| `bp_crucible_tongs` | Crucible Tongs | Boss | Fusion at Smelters is free and lets you choose the element. | Crafting |
| `bp_aether_condenser` | Aether Condenser | Boss | +1 Energy each turn. Cargo Hold has −3 slots. | Combat / Cargo |
| `bp_master_bench` | Master Bench | Boss | Workbench Field Repair no longer consumes Tool Charges (it costs 2 instead). | Loop |

---

## 6. Enemies

### 6.1 Stratum 1: The Foundry Floor

| ID | Name | HP | Pattern (repeats) | Wrench | Loot Bias |
| --- | --- | --- | --- | --- | --- |
| `en_scrapper_drone` | Scrapper Drone | 18–22 | Attack 6 → Attack 6 → Defend 5 | — | Kinetic |
| `en_rivet_hound` | Rivet Hound | 24–28 | Attack 4×2 → Buff (+2 Strength) → Attack 4×2 | — | Kinetic, Frames |
| `en_boiler_mite` | Boiler Mite | 10–12 | Attack 5. On death: player gains Burn 3. | — | Thermal |
| `en_sentry_turret` | Sentry Turret | 30 | Charge (no action) → Attack 14 → Defend 8 | — | Voltaic |
| `en_slag_tender` | Slag Tender | 26–30 | Slag: 1 Molten Slag to draw pile → Attack 7 → Attack 7 | Slag | Thermal |
| `en_spark_wisp` | Spark Wisp | 14–16 | Debuff (Jammed) → Attack 5 + Shock-self (it takes +3 from next hit) | — | Voltaic |
| `en_jammer_bot` | Jammer Bot | 20 | Suppress: Dampening Field → Attack 6 → Attack 6 | Suppress (Core) | Mods |

**Encounter pool (normal):** Easy: Drone ×2 · Mite ×3 · Hound · Drone + Wisp. Standard: Turret + Mite ×2 · Hound + Slag Tender · Jammer + Drone ×2 · Wisp ×2 + Drone · Hound ×2.

**Elites:**

| ID | Name | HP | Pattern | Wrench |
| --- | --- | --- | --- | --- |
| `el_foreman_gantry` | Foreman Gantry | 80 | EMP (Suppress Mods) → Slam 12 → Attack 5×3 → (repeat). Summons a Scrapper Drone at 50% HP. | Suppress (Mod) |
| `el_slagmaw` | Slagmaw | 95 | Slag: 2 Molten Slag to hand → Bite 10 → Devour (heal 8, Exhausts 1 Slag from your hand) → (repeat). | Slag |
| `el_press_warden` | Press Warden | 70 + Plated 4 | Seizure → Crush 16 → Defend 12 → (repeat). | Suppress (Frame) |

**Boss: The Crucible Engine** (`boss_crucible`) — 220 HP

* **Phase 1 (100–50%):** Pour (2 Molten Slag into draw pile) → Smelt Strike 14 → Ignite (player Burn 3) → repeat.
* **Phase 2 (<50%):** Gains Fortified 5. Cycles EMP → Molten Barrage 6×3 → Pour (3 Rust Slag to hand). Below 25%, every Slag in the player's hand at end of turn deals 2 damage.
* **Design intent:** Tests whether the deck can handle Slag (Grounding Rod, thin decks, Pierce/Thermal to push through Fortified).

### 6.2 Stratum 2: The Pressure Vaults

| ID | Name | HP | Hook |
| --- | --- | --- | --- |
| `en_vault_sentinel` | Vault Sentinel | 48 | Plated 6. Regains Plated 6 every 3 turns. |
| `en_steam_bellows` | Steam Bellows | 38 | Buffs allies with Fortified 3; applies Chill to the player. |
| `en_lock_spider` | Lock Spider | 30 | Magnet Lock every other turn. |
| `en_pressure_bomb` | Pressure Bomb | 20 | Counts down 3 turns, then deals 30 to the player. Kinetic damage resets the timer. |
| `en_ledger_clerk` | Ledger Clerk | 34 | Steals 10 Aether when it attacks; returns it on death. |
| `en_overseer_eye` | Overseer Eye | 40 | Telegraphs and copies the last Mod you played onto its next attack. |

**Elites:** *Vault Keeper* (EMP + Seizure alternating), *Pipe Wyrm* (inserts Static and Rust Slag; multi-segment), *The Twin Gauges* (two linked enemies sharing HP; Suppress Core / Suppress Mod alternately).
**Boss: The Arbiter of Gears** — Each turn it "audits" one slot type (shown in intent); cards whose audited component weighs 2+ are Suppressed. Rewards balanced, light builds mid-fight.

### 6.3 Stratum 3: The Aether Spire

| ID | Name | HP | Hook |
| --- | --- | --- | --- |
| `en_prism_shade` | Prism Shade | 44 | Converts the element of the first card you play each turn into Aether (Pierce). |
| `en_null_acolyte` | Null Acolyte | 50 | Removes all statuses from allies each turn. |
| `en_aether_leech` | Aether Leech | 36 | Drains 1 Energy at start of your turn while alive. |
| `en_resonant_golem` | Resonant Golem | 70 | Takes half damage from the element you used most last turn. |

**Elites:** *Splinter Knight* (shatters the highest-weight card in hand into Slag for the combat), *The Choir* (three units that gain power if left alive together).
**Final Boss: The Aetherheart** — Three phases: (1) mirrors your deck's dominant element as resistance, (2) Suppresses all slots in rotation, (3) a "Weld or Break" phase where each turn it offers the player a free on-the-fly Swap between two cards in hand, and punishes hands that keep their Mods idle.

---

## 7. Anomalies (Events)

| ID | Name | Summary | Choices |
| --- | --- | --- | --- |
| `ev_buried_crate` | Buried Crate | A sealed crate half-sunk in slag. | Pry it open (take 6 damage, gain a Refined component) · Leave it. |
| `ev_hungry_servitor` | The Hungry Servitor | A small servitor begs for parts. | Feed it a component (gain a random Blueprint if the part was Refined+; else 25 Aether) · Ignore. |
| `ev_conveyor_gamble` | The Conveyor Lottery | Parts roll past on a belt. | Swap a Cargo part for a random part one tier higher (50%) or lower (50%) · Walk away. |
| `ev_rogue_bench` | Rogue Workbench | A damaged Workbench sparks. | Use it (1 Tool Charge, take 5 damage) · Salvage it (30 Aether). |
| `ev_aether_spring` | Aether Spring | Raw Aether pools from a crack. | Drink (heal 15) · Bottle (gain 40 Aether, gain 1 Fused Cinder). |
| `ev_scrap_duel` | Scrap Duel | A rival Chassis challenges you. | Fight (Elite-tier combat, extra Prototype drop) · Decline. |
| `ev_memory_core` | A Dead Chassis | The remains of another climber. | Search (take a random Mod from its "deck") · Bury it (heal 10, lore entry). |
| `ev_overclock_shrine` | The Overclock Shrine | A shrine to unstable machines. | Permanently +1 Capacity on a Frame, but that card always Exhausts · Leave. |
