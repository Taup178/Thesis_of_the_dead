World destination indicators use soft ground rings, a vertically fading translucent glow and sparse rising motes. Forest and dungeon exits use a pale portal green; the final arena uses warm amber. They retain depth testing and scene fog, use no extra lights or external assets, and appear on the minimap as small diamonds.

- Level 1: at the portal approach point only after the Dean's escape and every active or pending zombie is cleared. Hidden immediately when Shaun starts portal travel.
- Level 2: only at the exit portal, when all memory routes are complete and the Dean has entered it (`phase === 'exit'`). No markers appear through the blades, moving bridge, spike ambush or memory puzzles.
- Hut arena: upgrades the existing centre ring at the existing Dean encounter trigger. It becomes available after all huts and zombies are cleared and disappears when the encounter starts. This extension was explicitly accepted after identifying the arena as Level 3.

The markers guide players to existing objectives. Spawn points, save/checkpoint rules, puzzle solutions and encounter triggers are unchanged. Each marker owns and disposes its small procedural textures, geometry and materials. Hidden marker shaders are warmed behind the opaque loading screen.
