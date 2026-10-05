# Thesis_of_the_dead

Run the game with `npm run dev`. Enter the green portal after The Freshman Woods to reach The Sophomore Room. After the fourth checkpoint, watch the Dean disappear into the exit portal, then walk onto the landing and follow him into Chapter 3, The Final Encounter.
In The Freshman Woods, every yellow orb releases two zombies from the red portal opposite the green exit (16 total). After collecting all eight orbs, follow the Dean to the green portal and walk into it. Your character shrinks and disappears before Chapter 2 loads automatically. Crossing the woods or desert boundary returns you just inside the edge, facing opposite your direction of travel, with an on-screen notice.

The Sophomore Room begins at a red portal: the Dean emerges first and jumps to the initial tile, then you emerge onto the safe starting platform. The camera returns to your selected view before the route demonstration begins. Checkpoint retries place you directly on your saved tile.

The room has two columns, indexed as `tiles[column][row]`. Every new run generates different routes, including the starting column and sideways turns. The room grows to fit the generated course. Watch the Dean demonstrate each route, then repeat his landings in the same order. The demonstrated tiles turn grey when your turn begins; only the destination stays green.

The dark room uses worn concrete surfaces, beveled slabs, steel supports, dim wall fixtures and softened shadows. Timed tiles develop cracks before breaking into falling pieces; wrong tiles break immediately. Falling reveals the spike bed below, and contact with the spike tips is fatal. The final checkpoint remains safe while the Dean enters the animated portal. Entering afterward shows your character shrinking into the opening, including in first person, before the next chapter loads automatically.

There are four routes with 4, 6, 8 and 10 jumps. The larger tiles leave room to take a few steps before jumping. Tile timers shorten from 3.2 seconds to 2.3 seconds as the Dean's demonstrations speed up. The Dean waits in the far corner of each checkpoint, leaving its center clear for your landing. Wrong landings and expired tiles collapse into the pit. Checkpoint retries keep the same generated course and show the unfinished route again.

- WASD: move relative to your view.
- Space: jump in the room; dodge in the woods.
- C: switch between third person and first person.
- R: retry the current checkpoint in the room.
- Esc: pause; click to resume.

Movement pauses while the Dean demonstrates, and your checkpoint remains safe until your turn starts. Tile timers also pause when the game is paused.

Level 1 opens with Shaun waking on the ground and standing up before control returns. Dreamy motion blur is enabled by default; toggle it in Options from the main menu or Settings on the pause screen. The choice is saved, and menus and HUD remain sharp.

Use `npm test` for the gameplay and physics checks, and `npm run build` for the production build.

The player is now Shaun, carrying the kit's SMG in his right hand. Bullets visibly travel from the barrel and collide with enemies or cover along their path. Each fresh level/retry starts with 30 bullets; carry up to 120. Every second defeated zombie drops a green ammo box with 12 bullets, collected by walking over it. Press **F** for a short gun strike against nearby enemies; clicking with an empty gun also bashes. A strike consumes no ammunition and cannot hit through walls. The gun and its gripping hand remain visible in first person.

The Final Encounter is a sunlit desert settlement built with the supplied Zombie Kit desert assets. Four mud houses each have 100 health and four arched doorways. One zombie walks out of each doorway, staggered by half a second (16 total, no repeat waves). Click to shoot: houses show their health when aimed at or hit, crack and shed roof sections at 75%, 50% and 25%, then collapse into persistent rubble at zero. Surviving zombies remain in combat when their house falls. Houses appear as amber squares on the minimap.

You enter the Final Encounter through a red portal at the south end. Only the player emerges; the Dean holds the degree on the raised platform at the north end. The camera returns to your selected view between the player and portal, facing the arena. Enemies and the 2:30 Final Year timer wait until the entrance finishes, then pause with the game. The timer clamps at 00:00 without a timer defeat or degree-burning sequence. Clearing the arena likewise leaves it playable; the final victory/story sequence is reserved for later. R restarts the arena, entrance and timer. Desert asset credits and original licenses are in `public/assets/models/desert/`.
