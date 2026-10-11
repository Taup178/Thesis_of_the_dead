# Thesis_of_the_dead

Run the game with `npm run dev`. Enter the green portal after The Freshman Woods to reach The Sophomore Room. After the fourth checkpoint, watch the Dean disappear into the exit portal, then walk onto the landing and follow him into Chapter 3, The Final Encounter.
In The Freshman Woods, every yellow orb releases two zombies from the red portal opposite the green exit (16 total). After collecting all eight orbs, follow the Dean to the green portal and walk into it. Your character shrinks and disappears before Chapter 2 loads automatically. Crossing the woods or desert boundary returns you just inside the edge, facing opposite your direction of travel, with an on-screen notice.

The Sophomore Room begins at a red portal: the Dean emerges first, then you follow him down a long chase corridor. There are four puzzle sections in order: sweeping slicing disks, three moving platforms over spikes, a three-row rune path, and the memory tiles at the far end. For each of the first three sections, the Dean crosses the whole obstacle before you follow. He waits beyond your reach while you clear it, then leads through the next section. Only the final memory tiles require you to remember his route. Checkpoint retries resume after the saws if you fall on the bridge, or at your saved memory tile.

In the disk corridor, press **Space** while moving to roll through a blade, or read its sweep and pass through the opening. On the moving bridge, **Space** jumps between platforms. A maintenance grate catches missed jumps and returns you to the safe checkpoint immediately after the saws. At the rune path, cross the glowing green pads in **Left → Right → Center** order. A wrong pad returns you to the start of that section and costs health.

The room has two columns, indexed as `tiles[column][row]`. Every new run generates different routes, including the starting column and sideways turns. The room grows to fit the generated course. Watch the Dean demonstrate each route, then repeat his landings in the same order. The demonstrated tiles turn grey when your turn begins; only the destination stays green.

The dark room uses worn concrete surfaces, beveled slabs, steel supports, dim wall fixtures and softened shadows. Timed tiles develop cracks before breaking into falling pieces; wrong tiles break immediately. Falling reveals the spike bed below, and contact with the spike tips is fatal. The final checkpoint remains safe while the Dean enters the animated portal. Entering afterward shows your character shrinking into the opening, including in first person, before the next chapter loads automatically.

There are four routes with 4, 6, 8 and 10 jumps. The larger tiles leave room to take a few steps before jumping. Tile timers shorten from 3.2 seconds to 2.3 seconds as the Dean's demonstrations speed up. The Dean waits in the far corner of each checkpoint, leaving its center clear for your landing. Wrong landings and expired tiles collapse into the pit. Checkpoint retries keep the same generated course and show the unfinished route again.

- WASD: move relative to your view.
- Space: roll in the slicing disk corridor and in combat; jump on the moving bridge and memory tiles. Release and press again for another roll.
- 1: open or close the weapon wheel in combat. Move the mouse to highlight a weapon and click to equip it.
- 2–6: equip SMG, pistol, dual pistols, sword or dagger directly. With dual pistols, left click fires both and right click fires one.
- C: switch between third person and first person.
- R: retry the current checkpoint in the room.
- Esc: pause; click to resume.

Movement pauses while the Dean demonstrates, and your checkpoint remains safe until your turn starts. Tile timers also pause when the game is paused.

Level 1 opens with Shaun waking on the ground and standing up before control returns. Dreamy motion blur is enabled by default; toggle it in Options from the main menu or Settings on the pause screen. The choice is saved, and menus and HUD remain sharp.

Use `npm test` for the gameplay and physics checks, and `npm run build` for the production build.

To test Chapter 2 directly in Git Bash, run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` and open `http://127.0.0.1:5173/?level=2`, then click **Start Game**. Keep the Git Bash terminal running while you play. Press **R** to retry from the current puzzle checkpoint.

Shaun carries the kit's SMG and can equip a pistol, dual pistols, sword or dagger. His hands rest until he aims or fires; dual pistols raise both arms together. The sword points forward, slashes farther and harder, while the dagger stabs quickly at close range. Bullets visibly travel from each barrel and collide with enemies or cover along their paths. Each fresh level/retry starts with 30 shared bullets; carry up to 120. Every second defeated zombie drops a green ammo box with 12 bullets, collected by walking over it. Press **F** for a short gun strike with a firearm; clicking with an empty gun also bashes. Melee weapons need no ammunition and cannot hit through walls. The equipped weapon remains visible in first person.

The Final Encounter is a sunlit desert settlement built with the supplied Zombie Kit desert assets. Four mud houses each have 100 health and four arched doorways. One zombie walks out of each doorway, staggered by half a second. Every zombie killed while its hut still stands calls four reinforcements; destroy the huts to stop the waves. Click to shoot: houses show their health when aimed at or hit, crack and shed roof sections at 75%, 50% and 25%, then collapse into persistent rubble at zero. Surviving zombies remain in combat when their house falls. Houses appear as amber squares on the minimap.

You enter the Final Encounter through a red portal at the south end. Only the player emerges; the Dean holds the degree on the raised platform at the north end. The camera returns to your selected view between the player and portal, facing the arena. Enemies and the 2:30 Final Year timer wait until the entrance finishes, then pause with the game. The timer clamps at 00:00 without a timer defeat. Once every hut and zombie is gone, a gold ring marks the arena center. Enter it to summon the Dean from his platform. A letterboxed cutscene follows him to the center, then restores your selected camera before combat. Nearby, he uses double jabs, a sweeping hook and a charging uppercut. At range, he uses a telegraphed fist slide, a shadow-marked jump that ends in a ground-cracking butt slam, rush punches and a ground smash that sends rocks toward the player. Below 40% health he glows red, moves and attacks faster, and leaves very little recovery between moves. Press Space to roll away from attacks; a standing roll goes forward. Defeat him to complete Chapter 3. R restarts the arena, entrance and timer. Desert asset credits and original licenses are in `public/assets/models/desert/`.

To test Chapter 3 directly in Git Bash, run `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` and open `http://127.0.0.1:5173/?level=3`, then click **Start Game**. To test just the boss sequence without clearing huts and zombies, open `http://127.0.0.1:5173/?level=3&boss=1`; the center ring appears after the entrance. Reload without the query string to play all chapters.
