# THESIS OF THE DEAD — reveal trailer production plan

Status: pre-production / gameplay capture tests. **No Seedance jobs submitted.**

## Direction and delivery

88-second reveal trailer, 1920×1080 H.264 MP4. Aim for a 60 FPS editing timeline;
gameplay must be captured at genuine 30 or 60 FPS before deciding the final cadence.
Never label duplicated frames or interpolated footage as native 60 FPS.

Preserve the actual stylized game art. Cinematic composition, lighting, pacing and
sound should elevate that identity, not replace Shaun with a photorealistic actor.
Show the Dean, but not his transformation, defeat, the final degree pickup or the
ending choice. The game title is the final image; no gameplay stinger follows it.

## Verified source material

- Game: current workspace source, not an imagined recreation of its mechanics.
- Shaun: orange facial hair; teal/white cap; green shirt, brown vest/backpack;
  teal trousers, yellow knee patches, dark gloves and brown boots.
- Opening: worn couch, bed/bedside table, single warm spotlight, Shaun covering
  his ears during the existing psychological episode.
- Chapter 1: moonlit forest, gold credit orbs, red portal and paired zombies.
- Chapter 2: skull-lined stone dungeon, four sweeping saws, six moving bridge
  platforms, retracting spikes, finite pit-edge zombie ambush and memory tiles.
- Chapter 3: ochre desert settlement and the actual Dean attack system.
- Music: `public/assets/audio/red-moon.mp3`, matching the Zombie_Kit Red Moon file.
- Voices: existing `public/assets/audio/voices/{opening,level1,level2,level3}` clips.
- Typography: existing `public/assets/ui/fonts/IMFeENsc28P.ttf`.

## Music and mix

**The first music sample must be from Red Moon source time 00:25.000.**
Planned music entry: trailer 00:09.000, with a smooth 2.5-second fade-in.
Keep the source clock continuous thereafter: source time = trailer time + 16 s.
Automated low-frequency onset analysis gives candidate accents at trailer 16.20,
19.40, 25.45, 31.85, 41.85, 48.20, 53.05, 61.05, 69.05, 77.05 and 81.85 seconds.
These are analysis candidates, not yet a listening-approved edit or assumed BPM.

At 80.80–81.85, briefly remove musical energy without resetting the source clock.
Bring the title hit in at source 97.85 / trailer 81.85, then resolve into the end fade.
Preserve baked clips' existing spatial processing; do not stack a second full echo
on top. The selected legacy Chapter 1 WAVs are dry: reproduce their existing
identity-specific pan and darkened echo from `src/audio/InternalVoices.js` in the
offline mix. Duck music approximately 6–9 dB for dialogue, then review
each line by listening. Final loudness target: approximately −14 to −15 LUFS
integrated, true peak no higher than −1.5 dBTP. These are production targets, not
claims that a finished mix has been measured.

## Storyboard

| Trailer time | Picture | Dialogue / sound | Transition |
|---|---|---|---|
| 00.00–03.00 | Actual opening close-up; darkness and Shaun's hands at his ears. | Protector: “Shaun. Listen to me. Get up.” Quiet room/breathing. | Slow reveal from black. |
| 03.00–11.00 | Seedance 1: restrained push toward Shaun on the existing couch. | Leave space after the opening line; Red Moon source 00:25 enters at trailer 09.00. | Match the actual opening pose and spotlight. |
| 11.00–16.20 | Actual forest waking / moonlit approach. Brief opening-style card: “Shaun is experiencing a psychological episode.” | Manipulator: “You have to reach it. Before he does.” | Black-to-moonlight contrast. |
| 16.20–24.20 | Seedance 2: actual red portal, first zombie pair, grounded low-angle camera. | Music builds; retain room for portal sound. | Match into the real portal encounter. |
| 24.20–31.85 | Actual credit collection and firearm combat. Short card: “EVERY CREDIT HAS A COST.” | Tormentor: “Every credit asks for something back.” Gunfire accent at 25.45. | Credit glow motivates the cut; no fake combat. |
| 31.85–39.85 | Seedance 3: lateral dungeon camera with the real sweeping saw in foreground. | Blade scrape, music escalation. | Shape match from portal arc to saw. |
| 39.85–48.20 | Actual roll through a blade and jump across moving platforms. Card: “REMEMBER THE WAY. BEFORE IT DISAPPEARS.” | Anxious: “Too close. Too close.” Then Protector: “Let your eyes settle before your feet move.” | Hold the landing long enough to read the mechanic. |
| 48.20–53.05 | Actual memory demonstration, route erased, player traversal if a successful take is captured. | Leave room for tile sounds; no continuous chatter. | The text card leads directly into the implemented puzzle. |
| 53.05–61.05 | Actual retracting spikes and pit-edge ambush; selected weapon action. | Anxious: “They're climbing out!” Use the actual pit emergence, not wall climbing. | Shorter cuts as pressure rises. |
| 61.05–69.05 | Seedance 4: Shaun and the Dean, held degree visible, desert confrontation. | Tormentor: “There he is. Still holding what you came for.” | Warm desert replaces the dungeon palette while preserving character art. |
| 69.05–77.05 | Actual Dean attack, dodge and earthwave glimpse. Never show defeat or transformation. | Original attack/weapon effects. Tormentor: “This is your last chance. Do you understand?” | Cut around readable impacts, not random flashes. |
| 77.05–80.80 | Fast callbacks to actual action; short card: “HOW MUCH OF YOURSELF WILL YOU LEAVE BEHIND?” | Music peaks; avoid overlapping spoken lines. | Increasingly short but legible shots. |
| 80.80–81.85 | Black / controlled sound vacuum. | Brief drop, preserve music clock. | No cheap jump-scare insert. |
| 81.85–88.00 | **THESIS OF THE DEAD**. Hold, then fade to black. | Title lands on the candidate music accent and resolves. | This is the final image. |

The extra cards are proposed trailer copy, not lines claimed to exist in the game.
The psychological-episode sentence and all spoken dialogue above are existing text.
Card reading time and final cuts remain subject to the first assembly review.

## Four Seedance requests — approval required before submission

Budget-conscious option verified through Higgsfield: **Seedance 1.5 Pro**, four
separate 8-second 1080p 16:9 jobs, native generated audio disabled. Quote: **24
credits per clip; 96 credits total**. Cost checks did not submit jobs.

This version accepts **start/end image references**, not gameplay video references.
Actual motion references can guide our edit and prompt design but must not be
misrepresented as inputs supported by this model. Newer Seedance models support
more reference types but have higher verified costs; do not silently switch models.
No draft, alternate or replacement paid job is authorized by this plan.

| Job | Duration | Reference to prepare | Estimated credits |
|---|---:|---|---:|
| 1 — Shaun's psychological opening | 8 s | Inspected current-engine opening close-up. | 24 |
| 2 — The forest portal | 8 s | Actual portal encounter frames: first emerging zombie to the complete pair (start/end images). | 24 |
| 3 — The Sophomore Room | 8 s | Current-engine saw corridor with Shaun and existing geometry. | 24 |
| 4 — The Dean confrontation | 8 s | Current-engine desert Dean/Shaun/degree composition. | 24 |
| **Total: exactly four jobs** | **32 s** | No speculative test generations. | **96** |

### Shared visual lock for all prompts

Use the supplied actual game render as the visual source of truth. Preserve the
stylized low-poly character proportions, face, clothing, asset silhouettes, textures,
palette and environment geometry. Do not turn this into live action, photoreal
humans or a different game's art. Improve cinematography with controlled camera
movement, natural depth, physically coherent light and restrained atmosphere.
No new characters, locations, weapons, powers, architecture, HUD, subtitles, text,
logos, extra limbs or fingers. No redesign, morphing, flickering outfit or shot cuts
inside the generation. One continuous camera move, stable exposure, 16:9, 1080p,
eight seconds, silent. Respect the exact start-image composition at the opening.

### Prompt 1 — Opening

Slow, almost imperceptible eight-second dolly toward Shaun seated on the actual
worn couch. He is a stylized orange-bearded student in the reference teal-and-white
cap, green shirt, brown vest and teal trousers. Both hands cover his ears in the
same established pose; subtle breathing and a small anxious rocking motion only.
Retain the bed, bedside table and original spatial arrangement. A single warm
overhead spotlight isolates him against deep blackness, with soft couch contact
shadows. Frame his face and hands with emotional restraint. Keep every hand
anatomically stable; do not expose a new face or change his cap. No apparition,
monster, new prop or supernatural event. The dread comes from stillness and sound
we will add in the edit. Finish with a stable readable pose for the match cut.

### Prompt 2 — Forest portal

Low, controlled lateral camera drift past the actual red portal in the moonlit
Freshman Woods. Retain the portal model, original red illumination, forest ground,
mixed trees and existing night sky from the reference. The same two implemented
zombies emerge along grounded forward paths, using their reference body shapes
and clothing. No crowd or additional spawn. Their feet make coherent ground
contact; no floating or wall climbing. Keep subtle ground mist and cool moonlit
depth, with red rim light motivating the composition. The camera ends looking
toward the playable approach lane so the next real gameplay shot feels continuous.
No explosion, supernatural attack, invented building, cinematic gore or new weapon.

### Prompt 3 — Dungeon

Eight-second lateral dolly through the actual torchlit Sophomore Room composition.
The existing large circular saw sweeps on its overhead carriage in the foreground;
its spinning metal, rail, visible clearance and sparks remain mechanically
coherent. Shaun waits on the real stone deck in the same outfit, watching the
hazard. Preserve the authored skull-lined walls, torch positions and corridor
dimensions. Warm torch pools fall into deep cool stone shadows. Use foreground
occlusion and controlled parallax to reveal the danger, not a fabricated stunt.
Do not let the blade intersect Shaun or invent another trap. No camera teleport,
impossible room extension, extra bridge or character redesign. Finish on the real
safe approach so we can cut to the actual dodge-roll input and collision system.

### Prompt 4 — Dean

Restrained eight-second arc through the real desert confrontation, keeping Shaun
and the actual Dean model in one coherent composition. Preserve the Dean's
implemented stylized yellow zombie appearance, size relative to Shaun, original
clothing and the degree scroll held in the left hand. The scroll remains a stable
physical object with a coherent grip. Shaun keeps his established outfit and
existing firearm in the reference pose; his posture is tense but physically natural. Retain
ochre sand, real mud-house silhouettes, skulls/cacti and warm desert lighting.
Let the camera approach over Shaun's shoulder toward the Dean; sparse suspended
dust, deep environmental layers, stable exposure. No attack not shown in the game,
no transformation, no monster reveal, no burning degree, no victory, no portal
choice and no ending spoiler. End on a steady confrontation for a hard action cut.

## Capture and quality gates

1. Capture-only tooling stays outside production imports. Use the actual game
   loop and normal inputs. Starting checkpoints may be staged between takes;
   never teleport actors or disable damage/collision inside a gameplay take.
2. Keep per-frame telemetry: health, ammo, score, position, roll/jump state and
   actual level events. This distinguishes action footage from scenic references.
3. Short test masters are silent and explicitly not the final trailer. Record
   action coverage before choosing highlights; retain successful landings and the
   puzzle's readable route/erase relationship.
4. Check actual images and multiple frames for each source. Reject bad framing,
   unexplained deaths, hidden actors, model clipping and duplicate-frame captures.
5. Inspect generated clips for identity/hand/weapon/environment continuity. A bad
   result is not permission for a fifth job; request approval for any replacement.
6. Assemble offline with Red Moon at source 00:25, the existing voice clips and
   synchronized effects. Review with headphones and ordinary speakers.
7. Validate exported dimensions, frame cadence, duration, seeking, black-frame
   placement, audio peaks and title readability. Keep the final under two minutes.

## Current deliverable boundary

The user has authorized gameplay recording and wants Seedance included. Their
explicit requirement to review the planned four jobs and cost before generation
still applies. Submit **nothing** until this proposal is approved. Once approved,
use each inspected reference in its appropriate supported input role and place
exactly four jobs; do not assume a four-free-Seedance entitlement.
