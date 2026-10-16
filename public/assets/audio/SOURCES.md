# Dean laugh

`dean-laugh.mp3` is an optional, Git-ignored local copy of the user-supplied
`Zombie_Kit/Sounds/Cod zombies _ evil laugh [qfidRRBhFb4].mp3`.
Local playback uses the full recording and its waveform to synchronize the Dean's
laugh animation. Checkouts without this private recording use the existing
fixed-duration animation fallback. No redistribution license has been established.

# Audio correction assets

The following active pack sources were checked against their original listings for this
submission: the OpenGameArt music, zombie, gun and pickup pages are CC0; the Kenney
Interface Sounds and Impact Sounds packs are CC0. The files below were copied from
those packs without editing. Their sounds still require in-game listening review.

| Game asset | Candidate source file | Pack / attribution | Source page |
| --- | --- | --- | --- |
| `music/rannsaka.mp3` | `Zombie_Kit/Rannsaka [4uVc4yhe-aw].mp3` | Supplied project asset; creator/source and licence details were not included in the pack | Not documented |
| `music/tar.mp3` | `Zombie_Kit/Tar [agmPnGNZ574].mp3` | Supplied project asset; creator/source and licence details were not included in the pack | Not documented |
| `music/dungeon-ambience.ogg` | `level2/original_downloads/dungeon_ambient__dungeon002.ogg` | Dungeon Ambience, yd | https://opengameart.org/content/dungeon-ambience |
| `music/lost-horror.ogg` | `level2/original_downloads/lost_horror__lost.ogg` | Lost in a Bad Place Horror Ambience Loop, congusbongus | https://opengameart.org/content/lost-in-a-bad-place-horror-ambience-loop |
| `music/arena-wind.ogg` | `level3/original_downloads/wind_loop__wind_woosh_loop.ogg` | Wind Whoosh Loop, SketchMan3 | https://opengameart.org/content/wind-whoosh-loop |
| `sfx/zombie/moan-1.ogg`–`moan-3.ogg`, `detection.ogg` | `shared/extracted/zombie_extra/{zombienoise1,zombienoise2,zombienoise3,fastzombie1}.ogg` | Zombie Noises and Moans, ianzazz | https://opengameart.org/content/zombie-noises-and-moans |
| `sfx/weapon/pistol-bang-*.ogg`, `smg-bang-*.ogg` | `shared/extracted/gun_bangs/bang_01.ogg`–`bang_05.ogg` | 25 CC0 Bang Firework SFX, rubberduck | https://opengameart.org/content/25-cc0-bang-firework-sfx |
| `sfx/collect/ammo-pickup.ogg` | `shared/extracted/gun_explosions/residue-sfx/ammopickup.ogg` | Residue SFX, FacadeGaikan | https://opengameart.org/content/residue-sfx |
| `sfx/weapon/melee-impact-1.ogg`–`melee-impact-2.ogg` | `shared/extracted/kenney_impact/Audio/impactPunch_medium_000.ogg`–`impactPunch_medium_001.ogg` | Impact Sounds, Kenney | https://kenney.nl/assets/impact-sounds |
| `sfx/weapon/bullet-impact-1.ogg`–`bullet-impact-2.ogg` | `shared/extracted/kenney_impact/Audio/impactSoft_medium_000.ogg`–`impactSoft_medium_001.ogg` | Impact Sounds, Kenney | https://kenney.nl/assets/impact-sounds |

## Cleared combat-vocal additions

| Game asset | Original recording | Creator and source | License / preparation |
| --- | --- | --- | --- |
| `sfx/zombie/moan-1.ogg`–`moan-3.ogg`, `detection.ogg` | `zombienoise1.ogg`–`zombienoise3.ogg`, `fastzombie1.ogg` | ianzazz — https://opengameart.org/content/zombie-noises-and-moans | CC0; existing idle/detection recordings, redistributable. |
| `sfx/zombie/attack.ogg`, `hurt-01.ogg`, `hurt-02.ogg`, `death-01.ogg`, `death-02.ogg` | `zombieYell1.wav`, `zombieYell4.wav`, `zombieYell7.wav`, `zombieDeath1.wav`, `zombieDeath3.wav` | ArcadeParty — https://opengameart.org/content/zombie-skeleton-monster-voice-effects | CC0; full sub-second originals converted to Ogg and loudness-normalized (-18 LUFS, -1.5 dBTP). Attribution is optional; retain this source record. |
| `sfx/player/shaun-hurt-01.ogg`, `shaun-hurt-02.ogg`, `shaun-death.ogg` | `humanYell1.wav`, `humanYell2.wav`, `humanDeath2.wav` | ArcadeParty — https://opengameart.org/content/zombie-skeleton-monster-voice-effects | CC0; full sub-second originals converted to Ogg and loudness-normalized (-18 LUFS, -1.5 dBTP). Attribution is optional; retain this source record. |

The earlier candidate collection contained no verified licensed human voice performance
for Shaun and no boss-combat music track confirmed by listening to fit the game. The
cleared Shaun exertion excerpts are recorded below. The previous `music/final-boss.mp3`
remains unused; it must not be treated as an approved Dean theme.

## Cleared Batch 1 excerpts

The following assets were copied from `audio-staging/cleared-candidates/` without
further editing. Their exact source/excerpt hashes and trim ranges are retained in
`audio-staging/cleared-candidates/PROVENANCE.json`. They require final in-game
listening approval, but their source license evidence permits redistribution under
the conditions below.

| Game asset | Staged excerpt / original | Creator and source | License / attribution requirement |
| --- | --- | --- | --- |
| `sfx/collect/ammo-pickup-event-a.wav` | `ammo-pickup-event-a.wav`, 0.005–0.300 s of `213607__dpoggioli__ammo-pick-up.wav` | dpoggioli — https://freesound.org/people/Dpoggioli/sounds/213607/ | CC BY 4.0; credit creator, title, URL, license, and that it was excerpted. |
| `sfx/collect/ammo-pickup-event-b.wav` | `ammo-pickup-event-b.wav`, 0.475–1.080 s of same | dpoggioli — same URL | CC BY 4.0; same attribution. |
| `sfx/player/shaun-exertion-01.ogg`–`05.ogg` | 0.275–0.350 s excerpts of `841313__takareads__strenuous_grunts.flac` | takareads — https://freesound.org/people/takareads/sounds/841313/ | CC0 1.0; retain source credit for traceability and record excerpt/Ogg conversion. |

All other reviewed gun, blade, Shaun-hurt, zombie, milestone, portal, and
footstep candidates remain unverified for public redistribution and were not
imported by Batch 1. Existing candidate-library assets also require final
publication review; they are not made cleared by this table. The account attribution
export also confirms `9mm.mp3` (ngphil22, CC0), `FNP90 burst.mp3` (CraftyIndividual,
CC0), and `Zombie Hit 1.wav` (tonsil5, CC0), but none is used by this branch. Its
`Twinkly Power-up.wav`, `Male Zombie Groan 9.wav`, and `Bloody Stab 1` entries are
CC BY-NC 4.0 and are not included or referenced.

## Cleared footsteps and melee whooshes

The active GaryBran footsteps and Artninja melee whooshes were derived from the named
Freesound source recordings after the account attribution export supplied direct license
evidence. The prior local originals did not waveform-match these source files and remain
private. CC0 permits public redistribution; the Artninja excerpts require the credit
shown below.

| Game asset | Source recording / preparation | Creator and source | License / attribution requirement |
| --- | --- | --- | --- |
| `sfx/player/forest-footstep-01.ogg` | `grass.ogg`, 0.027–0.180 s; 3 ms in / 5 ms out fade; loudness normalized to -24 LUFS, -2 dBTP | Delta12 Studio — https://opengameart.org/content/rpg-sound-effect-pack | CC0 1.0; attribution optional. |
| `sfx/player/forest-footstep-02.ogg` | `grass.ogg`, 0.204–0.330 s; 3 ms in / 5 ms out fade; loudness normalized to -24 LUFS, -2 dBTP | Delta12 Studio — https://opengameart.org/content/rpg-sound-effect-pack | CC0 1.0; attribution optional. |
| `sfx/player/forest-footstep-03.ogg` | `03-footstep.ogg`, complete 0.317 s event; 3 ms in / 5 ms out fade; loudness normalized to -24 LUFS, -2 dBTP | GboxMikeFozzy — https://opengameart.org/content/footsteps-0 | CC0 1.0; attribution optional. |
| `sfx/player/forest-footstep-04.ogg` | `04-footstep.ogg`, complete 0.333 s event; 3 ms in / 5 ms out fade; loudness normalized to -24 LUFS, -2 dBTP | GboxMikeFozzy — https://opengameart.org/content/footsteps-0 | CC0 1.0; attribution optional. |
| `sfx/player/garybran-forest-step-01.ogg` | 7.640–7.980 s of `75266__garybran__heavyfootstompsinforest4.wav`; 4 ms in / 25 ms out fade; -4 dB gain; Vorbis conversion | GaryBran, *HeavyFootStompsInForest4* — https://freesound.org/people/garybran/sounds/75266/ | CC0, confirmed by the account attribution CSV dated 2026-10-15; attribution optional. |
| `sfx/player/garybran-forest-step-02.ogg` | 15.420–15.780 s of same; 4 ms in / 25 ms out fade; -4 dB gain; Vorbis conversion | GaryBran — same URL | CC0; attribution optional. |
| `sfx/weapon/artninja-sword-swing-01.ogg` | 0.052–0.307 s of `custom_shredder_claw_or_small_swing_w_and_without_ringout_movement_sounds_11162024`; 4 ms in / 30 ms out fade; -3 dB gain; Vorbis conversion | Artninja — https://freesound.org/people/Artninja/sounds/768408/ | CC BY 4.0, confirmed by the source listing and attribution CSV. Credit Artninja, title, URL, CC BY 4.0, and that this is an excerpt. |
| `sfx/weapon/artninja-sword-swing-02.ogg` | 0.892–1.162 s of same; 4 ms in / 30 ms out fade; -3 dB gain; Vorbis conversion | Artninja — same URL | CC BY 4.0; same credit requirement. |

## Local-audition originals — publication hold

The following user-selected originals are retained locally for listening review only.
They are not referenced by the publication-safe code and must remain untracked and out
of any public commit until the individual source licenses are verified. The documented
CC0 forest footsteps above are the active public fallback; no swish substitute is
currently used.

| Local game asset | Exact-file SHA-256 | Source evidence | Publication status |
| --- | --- | --- | --- |
| `sfx/player/footstep-00.ogg` | `6fe61ef1fc3bcf0e253bf2eb64759db6cb69e2fe452f4d88cc597ecf78a3d601` | Compared against GaryBran 75266 after resampling: best normalized waveform correlation +0.310 at 3.516 s. | HOLD — evidence clears the source recording but does not establish this derived file as its excerpt. |
| `sfx/player/footstep-01.ogg` | `313472dba31fd0c855376069fa368bb5a198c27251cc8398ef464578b7047a4c` | Compared against GaryBran 75266 after resampling: best normalized waveform correlation -0.310 at 3.515 s. | HOLD — not an identity match. |
| `sfx/weapon/swish-1.wav` | `9a15c881345c1ce1c39cc31f52f081c8c4dc81fa41111e0079400f39d3ba0e45` | Compared against the Artninja 768408 source: best normalized waveform correlation -0.380 at 0.105 s. | HOLD — no source identity match. |
| `sfx/weapon/swish-2.wav` | `1ce7752cce3d43f16fc222ad7f7ffb69d9a5fc01e64b93d205765fc37b8e9b0d` | Compared against the Artninja 768408 source: best normalized waveform correlation -0.370 at 7.285 s. | HOLD — no source identity match. |
# Main menu music

`red-moon.mp3` is a byte-for-byte copy of the user-supplied
`Zombie_Kit/Red Moon [uvgIA_KBNf8].mp3`.

The original recording loops at its original speed and pitch on the main menu,
including its Options and Credits screens. It follows Master Volume, stops when
a level starts, and pauses while the browser tab is hidden. If autoplay is blocked,
the first pointer or keyboard interaction starts playback.

For automatic sound on this Windows development machine, keep `npm run dev`
running and use `npm run open:game`. This opens a separate Chrome/Edge game
profile with sound autoplay enabled, starting at the Level 2 menu. Normal browser
profiles and hosted copies still follow the browser's autoplay permissions.
See [Chrome's autoplay developer switch](https://developer.chrome.com/blog/autoplay/#developer-switches).

# Level 2 saws

`concrete-scrape-loop.mp3` is a byte-for-byte copy of the user-supplied
`Zombie_Kit/Concrete scrape loop [7cAnlZ1U1Mg].mp3`.

The recording is decoded once, quiet padding is trimmed, and a 220ms equal-power
overlap blends the tail into the head. A Web Audio buffer repeats at its original
speed and pitch without media-element restart gaps. Volume follows the saw bank
as one continuous sound bed and gradually fades as the player advances from the
first blade toward the corridor's exit. Gain changes run smoothly on the audio
clock; individual blade sweeps do not pulse the volume. The sound follows Master
Volume, pauses with the game, resumes its loop position, and is released when the
level is unloaded.

# Memory tile breaks

`brick-wall-impact.mp3` is a byte-for-byte copy of the user-supplied
`Zombie_Kit/BRICK WALL IMPACT SOUND EFFECT [ondpUC0oNwE].mp3`.

Only the recording's first two seconds are copied into the playback buffer, at
original speed and pitch. A 3ms entrance and 120ms ending fade smooth the edges.
Every tile collapse triggers its own impact, including wrong landings and expired
tile timers. Overlapping breaks can finish independently, with gentle compression
to control combined peaks. Playback follows Master Volume and pauses with the game.

# Level 2 score

`fangs.mp3` is a byte-for-byte copy of the user-supplied
`Zombie_Kit/Fangs [EqWdLiVxDGQ].mp3`.

The score begins when the Dean clears the final saw and the player regains control.
Checkpoint retries resume this part of the score without waiting for the skipped
intro. Its first entrance fades in over 2.4 seconds. The complete opening plays
on the first pass; a 1.5-second equal-power tail/head overlap smooths later loops
without changing speed or pitch. Music loudness is normalized with peak headroom,
and a gentle presence dip leaves space for effects. Audio-clock gain ramps duck
the score under saws, breaking tiles, combat, and low-health feedback, then recover
gradually. Master Volume applies to both music and effects. Pausing or hiding the
tab fades the score out, preserves its position, and fades it back in on resume.
Unloading the level releases playback and its audio resources.
