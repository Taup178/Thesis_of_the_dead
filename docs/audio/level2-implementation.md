# Level 2 internal voices

Level 2 uses the same four recurring female identities as Level 1, with 22 new recordings and an adapter for The Sophomore Room. Level 3 now has its own [event-driven voice integration](level3-implementation.md).

## Recordings with the effect included

Four Seed Audio packs were generated at the refreshed 5.1-credit quote. The voice IDs are unchanged: Ainsley/Tormentor, Brielle/Anxious One, Faye/Manipulator, Delia/Protector. The account balance changed from 94.5 to **89.4 credits**, making cumulative voice-generation spending **10.6 credits**. No additional takes were purchased. See [generation results](../../audio-staging/voices/level2-results.json).

The voice-model schema has no direct spatial-echo setting. The generated recordings were therefore processed **inside Higgsfield's media sandbox**, using its FFmpeg installation. Each finished file includes stereo near-ear placement, darker cross-ear repetitions, fading tails, stereo headphone enhancement, limiting and short edge fades. Tormentor and Manipulator linger more; the Protector remains mostly direct. No voice pitch shifting or imitation of an identifiable performer was used. These are original voices with an original spatial treatment, not Hellblade recordings or a claim of personalized measured binaural capture.

The 22 game files are 48 kHz **stereo Ogg Vorbis**, totaling **808,939 bytes**. Original stereo 48 kHz WAV masters remain locally under `audio-staging/voices/masters/level2/`, excluded from Git. [Preparation provenance](../../audio-staging/voices/level2-clips.json) records ranges, hashes, processing profiles and speech/tail durations. [The preparation script](../../scripts/prepare-level2-voices.py) reproduces the processing without a generation request.

Offline speech recognition in the sandbox checked the split points against word timestamps. It exposed an unsolicited extra fragment between the Manipulator's first and second intended lines; that fragment was removed without regeneration. This does not substitute for subjective headphone listening approval.

The [manifest](../../public/assets/audio/voices/level2/manifest.json) marks every clip `effectsBaked: true`. Playback preserves that stereo mix and does **not** add the runtime Level 1 echo or downmix it through another panner. Centered mode explicitly folds it to mono. Recorded tail duration is retained for ducking and cancellation, while authored reply timing uses the main speech duration.

## Integration and pacing

[ChapterVoices](../../src/audio/ChapterVoices.js) selects one active chapter adapter and preserves heard-line history across the transition. Level 1 behavior is retained. The shared bounded scheduler supplies priorities, expiry, session-level anti-repetition, cooldowns and controlled replies.

[Level2Voices](../../src/audio/Level2Voices.js) observes the actual room state. It speaks on safe starting/checkpoint landings, reacts only to visible ambush arrivals, reassures on meaningful injury, and provides a safe re-approach cue when the cleared memory entrance is not armed. It cancels speech and tails during memory demonstrations, timed tile traversal, saw crossings, bridge platform movement, jumps, rolling, death, inventory, pause and player portal entry. No tile solution is voiced, no route is described as unchanged on retry, and no delay is added to gameplay.

Audibility correction: the processed opening Protector clip measured -42.1 dB mean / -20.9 dB peak; the Manipulator callback measured -36.0 / -17.6 dB using FFmpeg volumedetect. Playback now applies a cached, shared stereo gain targeting 0.12 RMS, bounded by 0.85 sample peak and 16x maximum gain. This preserves the recorded spatial image and voice/echo proportions, leaves silence unchanged, and avoids another lossy encode or generation. The voice bus also restores 6 dB relative to the original mix. Started sentences now finish across ordinary jumps, saw crossings and bridge movement; memory demonstrations, timed traversal, cinematics, pause and death still cancel them. New lines still require their safe start conditions.

Two timing adaptations from the initial proposal are intentional:

- The optional Level 1 callback plays after control returns, rather than trying to fit into the short arrival-camera window. It requires the player to have heard the preceding Level 1 line.
- The final exchange waits until the Dean's portal passage ends and the player is safely at the exit. The recorded “Fresh eyes” line is reserved for the untimed memory entrance; it cannot fit before a checkpoint retry's 0.9-second demonstration start, so it is never forced into that interval.

Level 2's Fangs score, saw loop and tile impacts originally connected directly to the AudioContext destination. Their existing volume calculations now feed separate unity-gain duck stages, retaining the original mix when dialogue is absent. During speech, music is multiplied by 0.35 and effects by 0.65; central ambience is multiplied by 0.4. Multiple speaking lines retain duck ownership until the last recorded tail finishes. Level disposal releases the extra nodes.

The existing voice toggle, volume, subtitle and Headphones/Stereo/Centered preferences work across both chapters. The developer audition page at `/voice-audition.html` now lists the actual processed Level 2 clips, so they can be heard directly without selecting a local file or accidentally adding a second echo.

Validation: one focused run passed **29 tests** covering both chapters' scheduler behavior, baked stereo playback, output ducking, memory silence, real ambush arrivals, portal entry and existing transitions. Source audio and final clips were checked during processing. A production build and final manifest/hash check complete packaging. Interactive headphone listening and performance acceptance remain outstanding; the source takes are consistent generated speech, not a guarantee of fully acted whisper delivery.
