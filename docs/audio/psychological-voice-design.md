# Thesis of the Dead — psychological voice design, Levels 1 and 2

Investigation and proposal, 20 October 2026. Source baseline: `391a0a37751d9104f1686a5829ba41ce72953b60`.

**Implementation update:** Level 1 now has its director, spatial playback, settings, subtitles, automatic music/ambience/SFX ducking, and all 22 generated recordings. Four approved Seed Audio packs cost 5.5 credits; the reported balance after generation is 94.5. Original 48 kHz WAV masters are retained locally; game clips are mono 24 kHz WAVs. See [implementation notes](level1-implementation.md). In-game listening acceptance remains outstanding. Level 2 remains a proposal; Level 3 was not developed. The investigation and quote assessment below describe the original pre-implementation snapshot.

The editable cue specification is [voice-plan.json](voice-plan.json). It contains **18 cues / 22 individual lines per level**, including alternatives and reply lines: 44 recordings total if every proposed line is retained. These are a library, not a playlist. Many opportunities deliberately expire without playing. Provider capabilities and quote payloads are recorded in [higgsfield-audit.json](higgsfield-audit.json).

## 1. What the existing game and audio actually do

The engine is Three.js (declared dependency ^0.170.0), with ES modules and Vite. This is a browser game; there is no Unity mixer, Unreal sound graph, middleware dialogue framework or general gameplay event bus to extend.

| Existing part | Verified behavior | Design consequence |
| --- | --- | --- |
| [AudioManager](../../src/core/AudioManager.js) | A global manager lazily creates Web Audio after gestures. Music, ambience, SFX and voice gain buses feed a master gain and compressor. Defaults: master 0.7, music 0.88, ambience 0.78, SFX 0.78, voice 0.82. Compressor threshold -3 dB, ratio 12. | Reuse its context and master output. Add one internal-dialogue bus; do not replace its sounds. |
| `playSfx` / `playRandom` | Random clip selection; buffer cache; sampled RMS/peak compensation with bounded gain; group concurrency limits; cooldown keys; optional delay and pitch. `position` only calculates distance attenuation against the player's location. | No stereo placement, HRTF, listener orientation, moving sound sources, reverb, dialogue queue or narrative priority currently exists. “Voice” in the code means a playing source, not one of the four personalities. |
| Existing voice bus | Shaun's grunts, hurt and death recordings use `category: 'voice'`; zombie vocals generally use SFX. | Internal voice volume must have its own control so muting it preserves bodily danger feedback. Do not implement the new control by muting the existing `voiceGain`. |
| Central lifecycle | `pause()` stops current one-shots, invalidates pending loads and suspends the audio context; music resumes on the same context. Restart, level change and menu return call `stopAll()`. The decoded cache survives level switches. | Dialogue needs explicit cancellation and a scoped cache. Existing `playSfx` cannot provide resumable spoken sentences unchanged. Intentionally cancel a sentence on pause, then leave a short quiet interval on resume. |
| [Game](../../src/core/Game.js) | Receives event flags from each level's `update()`. Handles pickup, reveal, portal and theme audio there. Also orchestrates pause, tutorials, death, retries and automatic transitions. | Feed a small dialogue director at this boundary after event reduction. Observe a few state changes where no event exists. Avoid scattering per-frame playback calls through hazards and enemies. |
| Level 1 score | No opening music or central ambience scene; `Rannsaka` starts at the first credit event, at configured volume 0.62. Portal/reveal/pickup cues are synthesized; footsteps and combat vocals remain active. | Preserve the quiet opening and all existing score timing. The first voice enters after Shaun has stood up. |
| Level 2 audio | Central mixer plays `dungeon-ambience.ogg`. Separate [Level2Music](../../src/levels/Level2Music.js), [SawScrapeAudio](../../src/levels/SawScrapeAudio.js) and [TileBreakAudio](../../src/levels/TileBreakAudio.js) share the provided context but connect directly to its destination. `Fangs` starts when the Dean clears the last blade; retries set that music cue ready. The score ducks for hazards, impacts, combat, low health and demonstrations. | These three outputs bypass central bus gains and its limiter. A dialogue ducker on central `musicGain` alone would not affect Fangs. If needed, add a narrow dialogue-activity input to the existing score calculation; leave hazard audibility intact. Do not promise a single limiter controls the whole game. |
| [Heartbeat](../../src/core/Heartbeat.js) | Own AudioContext and synthesized paired thumps; starts below 40% health. | Leave it audible. Keep low-health dialogue brief and infrequent. |
| [MenuMusic](../../src/core/MenuMusic.js) | Separate HTML audio element plays `red-moon.mp3`, follows the volume slider at 0.3 scaling, stops on level start and handles gesture/visibility restrictions. | Internal voices never play in menus. No menu-music rewrite needed. |
| Settings / assets | Shared Options screen, reachable from pause, currently has a Master Volume slider; no internal voice toggle, spatial mode, dialogue slider or dialogue subtitles. Audio lives in `public/assets/audio`; source records are in `SOURCES.md`. | Add compact settings on this existing screen during implementation. No female dialogue assets currently exist in the served audio tree. |

Master Volume is read directly from the slider by several separate outputs. Its persistence is not currently implemented in the inspected UI code. New dialogue settings should persist defensively in localStorage, with failures tolerated. Existing visual and gamepad preferences are separate.

The manager's cache stores decoded buffers only after loading completes; concurrent requests for the same uncached file can duplicate fetch/decode work. Preload only the current chapter's dialogue, deduplicate in-flight requests, and invalidate pending playback when its chapter generation changes. Evict only dialogue-owned buffers on unload; leave shared combat/music caches alone.

## 2. Level 1 — The Freshman Woods

Sources: [Level1](../../src/levels/Level1.js), [WakeUpIntro](../../src/player/WakeUpIntro.js), [OrbPortalCutscene](../../src/levels/OrbPortalCutscene.js), [WoodsBossCutscene](../../src/levels/WoodsBossCutscene.js), [WeaponCombat](../../src/player/WeaponCombat.js), and Game's event/tutorial handlers.

1. Shaun wakes on the ground and stands during a **3.5-second** scripted introduction. Input and weapon actions are controlled by the existing cinematic.
2. Eight Academic Credit orbs are placed in moonlit woods. Collecting one awards 100 score and releases **two** reserved zombies through the red portal: sixteen in total. Basic, Chubby and Ribcage variants are used. Trees are navigation and bullet obstacles; there is no Level 1 memory puzzle, blade gauntlet or checkpoint course.
3. The first collection triggers a roughly **3.45-second** camera sequence showing the first pair emerge, and starts Rannsaka. Do not compete with this reveal using four introductions.
4. Combat drives blocking field-note tutorials: the first successful gun hit offers inventory; nearby zombies offer roll/strike instructions. These pause the world/audio and can open the inventory. Neither paused time nor reading time counts toward dialogue idle triggers.
5. Shaun has 100 health, 30 starting shared bullets and a 120-bullet cap. Guns, melee and rolling already exist. Every second kill drops 12 bullets. Hurt/death/exertion sounds already occupy the voice bus; there is no need for another damage mechanic.
6. The eighth credit reveals the Dean carrying the degree. This is a scripted **escape**, not a playable Dean boss fight. The camera follows him across the woods and into the exit portal; enemies and queued spawns hold during it.
7. Portal activation occurs during the escape's resolution, but actual entry additionally requires **every zombie defeated** and the escape camera finished. `portalActive` is therefore not equivalent to `bluePortalUnlocked`. The HUD's color language is inconsistent with the blue asset naming, so spoken lines avoid a color cue.
8. Approaching within 2.2 world units of the unlocked approach point starts Shaun's absorption. It automatically advances to Level 2. Stop dialogue at entry rather than letting it leak into loading.
9. Level 1 has no `getRestartState()` checkpoint snapshot. A retry reloads the woods. Track actual death retries in the director/Game session, distinguish them from pressing R, and suppress repeated full introductions.

**Narrative arc:** grounded reassurance → first concrete alarm → academic effort framed as debt → restrained disagreement → the degree remains out of reach → a quiet release after clearing enemies. The Manipulator has sparse openings; never force all four identities to speak just to satisfy a cast count.

## 3. Level 2 — The Sophomore Room

Sources: [Level2](../../src/levels/Level2.js), [SophomoreLayout](../../src/levels/SophomoreLayout.js), [SophomoreGauntlet](../../src/levels/SophomoreGauntlet.js), [SophomoreAmbush](../../src/levels/SophomoreAmbush.js), [RetractingSpikes](../../src/environment/RetractingSpikes.js), and [sophomorePatterns](../../src/levels/sophomorePatterns.js).

| Sequence | Verified mechanics | Appropriate voice opportunity |
| --- | --- | --- |
| Arrival and Dean demonstration | Dean emerges first, Shaun follows. Controls stay locked through the Dean's blade demonstration. After the last blade the player regains control while the Dean continues toward memory. The Dean is a guide, excluded as a combat target. | One short callback in the arrival-camera window if it fits. Silence through the blade demonstration and score onset. Do not urge the player to move while controls are locked. |
| Slicing disks | Four sweeping, rotating saws; contact is fatal. Rolling bypasses contact detection while dodging. Existing visual and sound cues explain danger. | A calm line on the fixed starting deck; never late “go now” timing advice. Silence while crossing. |
| Moving bridge | Six platforms oscillate laterally and carry grounded Shaun with them. Pit spikes below kill immediately, including during a roll. Blade completion provides a retry checkpoint on a fixed landing. | Safe-deck reflection only. No commentary on moving platforms or midair. |
| Retracting spikes | Eight-metre safe landing, then nine rows in three banks, 1/4/7 → 2/5/8 → 3/6/9, repeating every 7.2 seconds. Amber collars warn; raised spikes deal 20 damage with a 0.8-second injury interval. | One pre-corridor observation; do not voice the bank pattern or offer timing commands. A hurt line can wait for a safe landing. |
| Ambush | Entering the corridor starts twelve Basic/Chubby zombies, four waves of three, with alternating left/right arrivals. Next wave waits for current wave deaths and then a two-second gap. Zombies ignore the raised spikes and pursue across the memory landing. | Alarm only when an arriving enemy actually becomes visible. At most one additional wave reflection, only from a safe landing; otherwise skip it. |
| Memory gate | All waves must be defeated before the entrance approach starts the demonstration. Arriving early may require stepping back and approaching again. Jumping onto the tiles early breaks them and causes failure. Cleared ambush remains cleared on a checkpoint retry. | A grounded re-approach line is justified. Never suggest stepping onto the first tile before the phase starts. |
| Four memory routes | Generated routes require 4, 6, 8 and 10 jumps, including sideways jumps. The Dean demonstrates; amber previews then disappear, leaving the destination green. Movement is locked while watching; checkpoints are safe. Wrong/expired tiles collapse into a lethal pit. | **Silence throughout watch and follow.** Do not distract, imply a solution, count jumps aloud, or give false tile advice. |
| Completion | Final route makes all timers safe, starts Dean exit and activates the portal. After his passage Shaun may follow; player entry automatically advances. | A short earned-success exchange on the safe final tile, then silence for portal passage/entry. No next-level audio is planned here. |

**Use code over README:** actual `DIFFICULTY.tileTime` values are **1.3, 1.2, 1.1 and 1.0 seconds**, not the README's 3.2–2.3 seconds. `getRestartState()` changes the course seed when `phase === 'failed'`; it preserves the earned stage/puzzle checkpoint but does **not** always preserve the route. Saw fatalities need not set that phase, so not every death necessarily reseeds. Speak neither “the same route” nor “you know the next tile.” Preserve this behavior.

Memory stage success immediately begins the next demonstration. There is no guaranteed free conversation interval between the first three routes; do not add one. The only brief memory-retry line has a 0.6-second delivery budget before the existing 0.9-second arrival interval ends; skip it if the recording does not fit.

## 4. Four recurring female identities

All four are original characters with original dialogue. No performer imitation, Hellblade quotations or borrowed recording/performance reference.

| Identity | Performance and language | Spatial tendency | Dramatic use |
| --- | --- | --- | --- |
| Tormentor | Adult female low register; dry, composed criticism, clipped phrasing, occasional controlled question. No shouting. | Left bias, pan about -0.5; close and largely dry. | Turns academic effort into judgment. Sparse when Shaun is already hurt. |
| Anxious One | Adult female lighter register; breath catches, brief repeated words, clear consonants. No piercing high frequencies or shrieks. | Right bias, about +0.55; slight lateral drift only on authored cues. | Responds to verified, present danger; can also express relief. Never fabricates behind-you warnings. |
| Manipulator | Adult female soft middle register; intimate, slow, welcoming cadence ending ambiguously. | Right-of-center +0.25; occasional slow drift toward center, restrained filtered reflection. | Encourages withdrawal or resentment, not unsafe jumps or false solutions. |
| Protector | Adult female warm middle register; natural, composed delivery, short complete thoughts. | Near center +0.05; stable, dry, slightly forward in HRTF mode. | Anchors Shaun's agency. Reassures without commanding a hazard crossing. |

Pan values are starting mix settings, not auditioned final values. Fix each identity's chosen provider/model/voice ID, accent, speech rate and approved performance reference across both levels. Do not make four personalities by randomly pitch-shifting one speaker. Use “Shaun” consistently (pronounced Shawn), and rehearse the name once in each approved reference.

The cruel viewpoint is one subjective perspective, not the narrator's truth. Replies dispute it without describing Shaun as broken or dangerous. Horror comes from the fictional encounters and loss of control; none of the lines attributes violence or evil to schizophrenia.

## 5. Complete initial Level 1 dialogue plan

Each row is a proposed event opportunity. The JSON adds priorities and once/cooldown rules. Alternative lines are mutually exclusive. A missing/obsolete opportunity produces silence.

| Cue | Actual event or observed edge | Proposed recordings and delivery | Guard / arrangement |
| --- | --- | --- | --- |
| `l1_wake` | wakeUpIntro.done rising edge | **The Protector** (`l1_protector_01`): “Shaun. Feel the ground. You're standing.” — quiet, matter-of-fact reassurance | wait 1.5 active seconds after control returns; alive; no tutorial or cinematic |
| `l1_first_doubt` | 12 active seconds since wake cue ended | **The Tormentor** (`l1_tormentor_01`): “First year. And already you're lost.” — close, almost conversational | still no first credit; no nearby active enemy; no tutorial or cinematic |
| `l1_first_pair` | firstCreditCollected followed by orbPortalCutscene completion | **The Anxious One** (`l1_anxious_01`): “Two of them. Shaun, they're out.” — short held breath, then quick | first pair remains alive and visible; wait 0.5 active seconds after control returns; cancel if obsolete |
| `l1_credit_cost` | credit count reaches 2 | **The Tormentor** (`l1_tormentor_02`): “Every credit asks for something back.” — cold observation | collection effect finished; no cinematic; player not under immediate attack |
| `l1_progress` | credit count reaches 4 | **The Protector** (`l1_protector_02`): “Halfway. You earned every one.” — warm without celebration | wait for collection effect; quiet interval |
| `l1_late_doubt` | credit count reaches 6 | **The Tormentor** (`l1_tormentor_03`): “Still counting. Will it ever be enough?” — small pause after counting | quiet interval; no higher cue pending |
| `l1_rest_exchange` | idle for 25 active seconds after at least 2 credits | **The Manipulator** (`l1_manipulator_01`): “We could stay here. Let the year go on without us.” — gentle invitation, no threat<br>**The Protector** (`l1_protector_03`): “Rest for a breath. Then choose your next step.” — quiet, gives Shaun agency | grounded; no nearby enemy; no tutorial, inventory or cinematic; cancel on movement or danger; protector enters during final 0.25 seconds of manipulator |
| `l1_near_threat` | visible active zombie crosses within 6 world units | **The Anxious One** (`l1_anxious_02`): “Too close. Too close.” — contained urgency; not a directional instruction | exclude reserves and portal exits; moving toward player; alive; no tutorial; expire after 1 active second |
| `l1_hurt` | nonfatal health decrease | **The Protector** (`l1_protector_04`): “Breathe, Shaun. Find some space.” — firm and measured<br>**The Anxious One** (`l1_anxious_03`): “That hurt. Keep breathing.” — shaken, softening | wait 0.7 active seconds for Shaun's hurt sound; health still above 0; no current vocal; choose one line, never both |
| `l1_repeated_hurt` | third nonfatal health decrease within 30 active seconds | **The Tormentor** (`l1_tormentor_04`): “They'll mark every mistake.” — low, dismissive<br>**The Protector** (`l1_protector_05`): “A mistake isn't the whole of you.” — steady, no scolding | health above 35; defer until combat eases; supersedes ordinary hurt cue; expire after 4 seconds; protector enters during final 0.2 seconds of tormentor |
| `l1_low_health` | health ratio crosses below 0.4 | **The Protector** (`l1_protector_06`): “You're still here. One thing at a time.” — close and calm, leave heartbeat audible | nonfatal; wait for hurt vocal; supersedes other injury cues; no repeated threshold oscillation |
| `l1_empty_gun` | ammo crosses to zero with firearm equipped | **The Anxious One** (`l1_anxious_04`): “Empty. Shaun, it's empty.” — brief, breathy | not bashing, rolling or in tutorial; expire after 2 seconds; cancel if ammo restored |
| `l1_dean_reveal` | events.deanReveal | **The Tormentor** (`l1_tormentor_05`): “All that work. He still holds the degree.” — restrained bitterness | supersede final-credit commentary; wait at least 0.8 seconds after reveal sound; no other internal voice |
| `l1_dean_gone` | bossCutscene completes with bossState done | **The Manipulator** (`l1_manipulator_02`): “He leaves. You do all the work.” — sympathetic, quietly resentful | at least 2 active seconds after camera return; remainingZombies above zero |
| `l1_clear` | bluePortalUnlocked rising edge | **The Protector** (`l1_protector_07`): “They're gone. You can move on.” — a release of tension | wait 2 active seconds after final kill; alive; no player absorption; expire on entry |
| `l1_portal_approach` | unlocked portal approach within 10 world units | **The Manipulator** (`l1_manipulator_03`): “Another year. Perhaps this one will be kinder.” — comfort with uncertain final word | grounded; outside 2.2-unit entry trigger; at least 14 seconds since last cue; cancel on entry |
| `l1_retry` | first retry after actual Level 1 death; wake intro completes | **The Protector** (`l1_protector_08`): “Start where you are. I'm still here.” — familiar, patient | wait 1.5 active seconds; replaces wake cue; manual R restart does not count |
| `l1_repeat_retry` | second death retry; wake intro completes | **The Tormentor** (`l1_tormentor_06`): “Back at the beginning, Shaun.” — cool recognition<br>**The Protector** (`l1_protector_09`): “And you know more than before.” — quiet interruption | replaces other wake or retry cues; wait for control; never speak over death; protector enters during final 0.2 seconds of tormentor |

**Silence map:** opening stand-up; first-pair camera; field-note/inventory reading; immediate hurt/death sounds; most ordinary orb pickups and kills; initial 0.8 seconds of Dean reveal; portal absorption and loading. The single reveal line is a deliberate exception to generic cinematic silence, timed after the designed reveal sound. If its final recording does not fit, omit it.

The default repeat policy is once per line per game session, with the two injury alternatives eligible at most once each. New-game start resets the session; checkpoint/retry does not. A normal run should typically hear roughly 6–10 cue groups, depending on play pace, rather than every recorded line.

## 6. Proposed Level 2 dialogue plan

This is design preparation only. Do not integrate or generate it until Level 1 is accepted.

| Cue | Actual event or observed edge | Proposed recordings and delivery | Guard / arrangement |
| --- | --- | --- | --- |
| `l2_arrival` | player_arrival finishes | **The Manipulator** (`l2_manipulator_01`): “I did say perhaps.” — intimate callback; no smile | arrival cinematic only; before blade demonstration; if line cannot finish before demonstration then skip |
| `l2_saws_ready` | deanBladeIntro becomes false | **The Protector** (`l2_protector_01`): “His pace isn't yours. Watch the sweep.” — calm, deliberate | player still on starting safe deck; wait 1 second after score onset; cancel if crossing a saw |
| `l2_saws_clear` | puzzleIndex changes from 0 to 1 | **The Anxious One** (`l2_anxious_01`): “Past them. We're past them.” — relief with breath still caught | grounded on safe deck; do not delay into first bridge jump |
| `l2_bridge_wait` | idle 12 active seconds at bridge checkpoint | **The Tormentor** (`l2_tormentor_01`): “Even the ground won't commit to you.” — dry, under the breath | grounded on fixed deck; no jump, roll or nearby enemy; cancel on leaving deck |
| `l2_bridge_reassure` | bridge checkpoint on first visit or death retry | **The Protector** (`l2_protector_02`): “Let your eyes settle before your feet move.” — observant, not a jump command | choose instead of bridge-wait cue; fixed safe deck; no timed movement |
| `l2_spike_checkpoint` | puzzleIndex changes from 1 to SPIKE_CORRIDOR_PUZZLE | **The Protector** (`l2_protector_03`): “Solid ground. Look ahead before you leave it.” — brief respite | grounded on eight-metre fixed landing; cancel on entering spikes |
| `l2_spike_observe` | wait 10 active seconds on spike entry landing | **The Anxious One** (`l2_anxious_02`): “The floor keeps moving. Even here.” — low apprehension | still outside retracting corridor; no combat; no time-specific crossing advice |
| `l2_ambush` | first ambush record becomes visible while jumping | **The Anxious One** (`l2_anxious_03`): “They're climbing out!” — fast and intelligible; no scream | live visible record only; not merely ambush.start; expire after 1 active second |
| `l2_wave_gap` | currentWave advances to 2 | **The Tormentor** (`l2_tormentor_02`): “There's always another demand.” — cold exhaustion | only if grounded on fixed safe landing; previous wave gone; cancel if next record becomes visible; otherwise skip |
| `l2_spike_hurt` | nonfatal health decrease in retracting corridor | **The Protector** (`l2_protector_04`): “You're hurt. Give yourself a breath.” — low, attentive | wait 0.7 seconds after hurt sound; player subsequently grounded on fixed landing; cancel if combat persists |
| `l2_low_health` | health ratio crosses below 0.4 during ambush | **The Protector** (`l2_protector_05`): “Stay with me, Shaun. Just this moment.” — warm, steady, no forced urgency | alive; defer until hurt vocal ends; supersedes spike-hurt cue; never during a jump |
| `l2_ambush_clear` | ambush.cleared rising edge | **The Anxious One** (`l2_anxious_04`): “Nothing else is climbing.” — tentative relief<br>**The Protector** (`l2_protector_06`): “You held your ground.” — short affirmation; sequential after anxious line | wait 2 seconds after final kill; fixed landing; before demonstration; cancel if watch begins |
| `l2_memory_wait` | idle 15 active seconds at memory entrance after ambush clear | **The Manipulator** (`l2_manipulator_02`): “You don't have to prove anything to him.” — plausible comfort with a pull toward withdrawal<br>**The Protector** (`l2_protector_07`): “Then do this for yourself.” — quiet, no instruction about route | phase chase; fixed landing; before demonstration; cancel on approach; protector enters during final 0.25 seconds of manipulator |
| `l2_memory_rearm` | ambush cleared while memoryApproachArmed false; idle 8 active seconds near entrance | **The Protector** (`l2_protector_08`): “One step back. Meet him at the entrance.” — clear, gentle; never during tile traversal | fixed landing; phase chase; no other cue; cancel once armed or watch begins |
| `l2_memory_retry` | retry after actual memory failure | **The Protector** (`l2_protector_09`): “Fresh eyes.” — brief, grounded | safe checkpoint arrival only; at most 0.6 seconds of speech; cancel before watch begins at 0.9 seconds |
| `l2_final_route` | phase becomes dean_exit after last valid landing | **The Tormentor** (`l2_tormentor_03`): “And he still won't wait for you.” — flat, no triumph<br>**The Protector** (`l2_protector_10`): “You remembered. That was yours.” — firm reply, sequential; no overlap | grounded safe checkpoint; all tile timers null; wait 1 second after landing; complete before portal passage |
| `l2_exit_wait` | phase exit; idle 15 active seconds on safe final checkpoint | **The Manipulator** (`l2_manipulator_03`): “They call it progress. It still feels like a chase.” — soft weariness | Dean passage finished; no voice in preceding 14 seconds; cancel on player entry |
| `l2_hazard_retry` | retry after actual saw or bridge death | **The Tormentor** (`l2_tormentor_04`): “Still trying to keep up?” — quiet question; no follow-up on same retry<br>**The Protector** (`l2_protector_11`): “You can begin again without rushing.” — patient, available only on fixed hazard checkpoints | fixed checkpoint; exclude memory and manual restart; one alternative only; choose one line, never both |

The optional “I did say perhaps” connects to the first chapter's portal line. Only use that callback if the player actually heard `l1_manipulator_03`; otherwise skip it, including direct Level 2 launches. Preserve that heard-line flag across the chapter transition.

A retry or alternate cue must replace competing entry lines, not stack with them. Bridge waiting/reassurance are alternatives on a visit. Ambush-clear speech may be cut short by the demonstration; it never holds the player at the entrance. Entering `watch` or `follow` cancels any pending voice immediately, including a reply.

## 7. Spatial design, pacing and comfortable levels

Start with headphone HRTF where available, plus stereo and centered choices. [Web Audio PannerNode supports HRTF](https://developer.mozilla.org/en-US/docs/Web/API/PannerNode/panningModel); [StereoPannerNode](https://developer.mozilla.org/en-US/docs/Web/API/StereoPannerNode) provides a lighter equal-power fallback. These are browser-rendered spatial voices, not a claim of individually measured binaural capture.

Keep internal sources in listener-relative coordinates, independent of Shaun's distance from a map object. The existing manager only tracks world position for attenuation; do not reuse those coordinates as if they already update the browser listener. A dedicated internal voice graph can keep its listener at the default origin and use head-relative source positions. If later audio changes require a world listener, explicitly transform these offsets with the active camera quaternion. First/third-person switches must not move an internal identity into the forest.

Proposed chain: mono dry clip → short edge envelope → optional very light tonal filter → HRTF panner **or** stereo panner **or** centered output → internal-dialogue gain → existing master/compressor. Use no additional AudioContext. A tiny optional wet branch can return to the same dialogue gain; avoid phase-heavy widening and sub-bass. No convolver asset or artificial “whisper bed” is required for the first implementation.

- One sentence normally; at most two voices for the four authored interruptions/replies that actually specify overlap. A reply pair counts as one cue group.
- Overlap only the last 0.2–0.25 seconds, and reduce each overlapping line by approximately 3 dB. Never layer independently selected clips. Sequential pairs remain sequential.
- At least 14 active seconds of silence after a cue ends; at most three cue groups per rolling minute; background/idle opportunity cooldown 75 seconds. Injury reactions have at least 35 seconds between them.
- Health/danger cues can take priority over an unstarted ambient cue. Do not bypass the three-cues-per-minute cap; the existing hazard and damage feedback already communicates danger. Clear low-priority work instead of building a backlog.
- Use a single pending cue plus its authored reply, not an unbounded queue. A present-danger line expires in one second. Priorities choose among simultaneously eligible events, not an excuse to repeat alarms.
- Silence wins on death, loading, menu, pause, tutorial, inventory, memory demonstration, timed tile traversal, saw crossings and bridge jumps. Stop on loss of active gameplay/pointer capture or hidden tab. Stop the reply as well.
- Fade dialogue over about 30–60 ms when cancelled; do not restart the cancelled sentence on resume. Use a 3-second recovery quiet interval. On chapter disposal cancel decode callbacks as well as active sources.
- Initial dry masters: consistent perceived speech loudness, roughly -20 LUFS for ordinary lines where measurable, true peaks no higher than -3 dBTP; assess short lines by listening and short-term level rather than chasing unstable integrated measurements. Keep whispers close, not louder.
- Start dialogue bus conservatively around 0.45 relative gain; final level comes from listening against guns, hurt vocals and music. The existing RMS normalizer can over-lift a whisper; use prepared dialogue levels and a fixed bounded gain instead of the generic SFX target. The existing compressor is not proof of comfortable output level.
- Updated user requirement: automatically reduce background music, ambience and sound effects while internal speech plays. Level 1 now uses separate multiplicative stages: music 0.35, ambience 0.4, SFX 0.65. Attack and recovery time constants are 0.035 and 0.45 seconds. Shaun's bodily vocals retain their own bus. Overlapping lines keep the same duck until the last line ends. Level 2's independent output paths will be addressed when its implementation begins.
- Existing Options: add **Internal Voices** toggle, **Voice Volume**, **Voice Positioning** (Headphones / Stereo / Centered), and **Voice Subtitles**. Centered mode retains all text. Subtitle lines identify speakers, support two simultaneous entries and disappear when cancelled. No screen-reader announcement spam or essential direction encoded solely by pan.

These are mix targets for audition, not guarantees of headphone safety or universal HRTF localization. Validate on headphones, speakers and a mono fold-down at a comfortable listening level.

## 8. Higgsfield capabilities and trial assessment

Verified through the connected tools on 20 October 2026. The direct MCP and Apps connector both reported Plus / 100 credits. The Apps balance supplied richer trial details. Snapshot: [higgsfield-audit.json](higgsfield-audit.json).

| Requested capability | Verified exposed support | Boundary / unverified detail |
| --- | --- | --- |
| TTS | Catalog lists Seed Audio 1.0, Qwen Audio 3.0 TTS Flash, Eleven v4 / Turbo, Text to Speech V2 and Inworld TTS. | Catalog presence is not proof of performance quality or entitlement to every variant. |
| Reusable voice identities | `list_voices` returns `voice_id` + `voice_type` pairs, including female presets and preview URLs. Seed and TTS V2 explicitly accept these; other model-specific compatibility needs verification. | Presets are not unique to our game. Names/gender do not establish accent, timbre or acting suitability. Existing previews were listed, not listened to in this session. No final cast chosen. |
| Custom voice creation | `create_voice` UI and `create_voice_from_confirmed_audio` expose reference-audio voice creation, with processing/readiness status. | No standalone text-only “design four original voices” endpoint was verified. Reference creation can cost credits; untouched. Use only original or authorized reference performances. |
| Emotional direction | Qwen exposes an instruction string up to 128 characters, language, rate, pitch and seed. Eleven models expose dialogue turns, stability and similarity; Seed exposes pitch/rate/loudness. | Exact whisper acting and cross-line identity fidelity remain unauditioned. A seed or similarity control is not a consistency guarantee. Never place prose performance instructions in spoken text unless the model documents them as nonspoken. |
| Multi-voice dialogue | Eleven v4 catalog supports up to ten voices within 10,000 text characters; Turbo requires one voice across turns. | A mixed dialogue file is awkward for dynamic triggers and positioning; prefer independent stems or per-identity packs. No word alignment or isolated multi-speaker stems verified. |
| Batch | `generate_audio_batch` accepts indexed independent requests; one job per submitted item. Model `batch_size` means independent variations, not a pack of different lines. | Batch submission is not verified to give a price discount, and can partially fail. Keep variants at one. |
| Audio/SFX | Mirelo text-to-audio effects and Sonilo music are in the catalog, marked “game pipeline only.” | Existing music/effects already serve the game. No new effects are needed. |
| Audio editing | `voice_change` accepts source **video** and a target voice. Tool instructions also describe a remote processing sandbox. | This does not establish an arbitrary audio-only editor. Do splitting, fades and compression locally where possible. No remote sandbox or upload used. |
| Usage and cost | `balance`, model catalog flags and single-audio `get_cost:true` quotes are available. Eight quote calls returned costs without jobs. | No detailed per-job billing ledger was found among inspected billing tools. Recheck balance and quote immediately before any approved generation. |

**Account/trial facts:** plan `plus`; trial status `active`; kind `mcp` (credit trial); trial credits remaining **100**; account credits **100**; `eligible: false`; `unlim_available: false`. Those are overlapping views of the same reported balance, not 200 credits to spend. Trial ends **2026-10-23 00:23:40 UTC / 02:23:40 Africa/Johannesburg**. The endpoint describes this as the trial end / auto-charge timestamp; the actual renewal amount, payment state and cancellation status were not returned and are unverified. No account changes or renewal cancellation were requested or performed.

The returned free counters are **one Genjutsu** and **five AI Influencer sheets**. They do not demonstrate free audio eligibility. Some models carry `supports_unlim:true`, but the account currently has no spendable unlimited allowance. Do not infer website promotions apply to these requests. Public [Higgsfield pricing](https://higgsfield.ai/pricing) does not establish this account's audio entitlement or renewal amount.

**Quote-only preflight:** Seed Audio, WAV, 48 kHz, count 1, exact dialogue text concatenated per identity per chapter with blank-line separators. Four female presets were used solely to supply valid IDs: Ainsley, Brielle, Faye and Delia. This ordering is not a casting recommendation. Their returned IDs and full quote parameters are recorded in the audit.

| Proposed identity pack | Level 1 credits | Level 2 credits |
| --- | ---: | ---: |
| Tormentor | 1.5 | 0.9 |
| Anxious One | 0.8 | 0.8 |
| Manipulator | 0.9 | 0.8 |
| Protector | 2.3 | 2.6 |
| **Total, four packs per chapter** | **5.5** | **5.1** |

Combined provisional price: **10.6 credits** for eight pack requests. The quote server returned fractional credit values; these are preserved exactly rather than rounded to hypothetical whole-credit minimums. **These are current server quotes, not spent credits, a reserved price, a guarantee of acceptable takes, or a quote for 44 separate requests.** Separate clips, a different model/voice, changed text or paid reference creation require a fresh quote. Splitting packs adds local editorial work and output duration/limits still need confirmation. All eight responses contained costs, no job result. Balance was re-read afterwards: **100 credits / 100 trial credits unchanged**.

## 9. Implementation order and validation

Do not introduce an event framework, new mechanics, hazard timing changes, checkpoint changes, camera motion or environmental redesign to support voices.

1. **Approve/review this design and cast direction.** Continue free local work without waiting on paid audio. Keep a clear distinction between implementation approval and generation authorization.
2. **Level 1 only:** implement a small `PsychologicalVoices` director, a data catalog and a minimal AudioManager dialogue-playback path on its existing context. Consume existing event flags and observed state edges. Add separate settings and subtitle rendering to the existing UI. A feature-disabled/no-assets path must skip cleanly with no 404 spam.
3. Use explicit line IDs and durations, priority, guard expiry, heard-line session flags, per-cue cooldowns, a recent-line set, and chapter generation tokens. Snapshot health/ammo/counts once per update. Determine the most specific injury cue before scheduling; low health supersedes repeated-hurt, which supersedes ordinary hurt. Use actual death transitions for retry history; manual R/full restart is not a failure.
4. Extend the existing lifecycle explicitly: start/new game, restart, pause, tutorial/inventory, death, return-to-menu and chapter unload. Do not rely on the current game-over path to stop all new dialogue automatically. Feed current camera/active-gameplay state, not wall-clock idle time.
5. Validate scheduling first using a fake audio clock and no network. An explicit local developer preview can use text and generated non-speech stereo test pulses; do not ship beeps as “female voices.” Optional local speech requires confirmed offline installed voices. Browser speech synthesis is not the default because voices can be remote and cannot reliably enter this graph. No such synthesis was run.
6. Meaningful Level 1 tests: co-occurring final-credit/reveal produces one cue; first-pair line cancels when pair dies; tutorial/inventory blocks idle and cancels replies; death/entry/unload cancels late decode; rate/cue caps hold across retries; separate voice mute preserves hurt/SFX; centered fallback and subtitles agree; missing assets do not block play.
7. Run focused existing audio/Level 1 regressions and build. With approved audio, manually play Level 1 from wake to exit, including death, first-credit scene, field notes, rapid pickups, zero ammo, slow play and entering immediately after last kill. Listen in both camera modes and each output mode. Level 1 is complete only after actual asset playback and listening acceptance, not merely passing unit tests.
8. **Only after that gate:** add the Level 2 adapters using `puzzleIndex` constants rather than assuming numeric order (spikes is 3; memory is 2). Observe `ambush.started/cleared`, visible record phases, stage/phase edges and entry re-arming. No changes inside hazard collision or tile timers. Cancel everything at `watch/follow` and during unsafe traversal.
9. Level 2 checks: fresh/direct/checkpoint entry, all four hazards, twelve-zombie progression, manual versus failed retry/reseed, remembered cleared ambush, zero voices during route demonstration/timed traversal, no tile solution leakage, no stuck ducker and cleanup across transition. Manually verify voice audibility without masking Fangs, saws or tile impacts. Level 3 receives no catalog, adapter, preloads or dialogue.

Suggested asset layout once recordings are approved:

```text
public/assets/audio/voices/level1/{identity}/{line-id}.ogg
public/assets/audio/voices/level2/{identity}/{line-id}.ogg
audio-staging/voices/masters/{identity}/{chapter-pack}.wav
audio-staging/voices/PROVENANCE.json
src/audio/voiceCatalog.js
src/audio/PsychologicalVoices.js
```

Keep WAV masters private/outside the served public directory. Use compact mono Vorbis with browser decode checks, or another browser-verified compressed format plus fallback where needed. Do not download or install a converter without checking available tooling/permissions; `ffmpeg` was not found on PATH during this audit. Keep original provider outputs intact, save hashes/model/voice/settings/job ID, record split boundaries and loudness adjustments, and map each exported clip to its existing line ID. Store actual final durations; do not invent them from reading speed. Preload only Level 1 initially; clear its decoded dialogue buffers before preloading Level 2.

Baseline verification completed: **29 existing audio / Level 1 / Level 2 tests passed**, and `npm.cmd run build` passed. The build emitted its existing >500 kB bundle-size warning. Initial sandbox attempts could not spawn Node/esbuild child processes; the permitted reruns succeeded. These checks exercise current shared audio and level event contracts, not an implemented new system. No interactive browser/headphone listening was performed; no browser automation tool was available.

## 10. Credit-preserving production recommendation and approval boundary

Use local event simulation and text until the Level 1 behavior is right. Audition already available preset previews before buying test takes; final selection must be based on listening, not voice names. If preset timbres are acceptable, pin four IDs for both chapters. If the request requires unique timbres, obtain four authorized original reference performances first, quote reference creation separately, and approve it explicitly; no unsupported text-only voice-design promise.

For first production, prefer four single-identity Level 1 packs with the locked script and one take, then split locally. This provides 22 independently addressable clips after editing with only four generation submissions. Blank lines do not guarantee edit-ready pauses; validate segmentation manually and preserve full masters. Do not speak line IDs or stage directions. If packing compromises acting or clean edits, prepare a per-line quote rather than silently regenerating.

Seed is the currently quoted baseline because its reusable IDs and WAV/rate/format controls are exposed. It has no separately documented emotional-instruction field in the returned schema; pitch changes alone will not create convincing whisper acting. Qwen's explicit instruction control is a promising alternative if the chosen voice references are compatible. Obtain a quote and explicit approval before any audition or production take on either model. Four authorized human performances recorded locally are also viable with no provider credits, but require recording/editing effort and permission to use them; no alternative service account or paid API will be started automatically.

Generation approval must name the **model, exact voice IDs, exact script revision, number of requests and hard credit ceiling**. The present 5.5-credit Level 1 quote is a reviewable reference, not spending authority or an auditioned cast. Before submission, re-quote unchanged parameters, verify entitlement/balance, show the exact allocation, and obtain the user's explicit approval. Never treat unlimited/free eligibility, approval of this document, or approval of local implementation as generation consent.

Submit only the approved Level 1 allocation, one variation per pack. Record job IDs immediately, recover uncertain submissions through supported status/history rather than blind retries, download approved results once, and make edits/reverb/panning locally. A rejected allowance request must never fall back to credits. No automatic retakes. Level 2's 5.1-credit quotation remains planning information until Level 1 is implemented and validated and Level 2 generation is separately approved.

**Decision requested:** review the Level 1 script and approach. External audio production remains held pending auditioned casting and explicit approval of the final cost/allocation. All 100 reported credits remain available as of the post-quote balance check.

