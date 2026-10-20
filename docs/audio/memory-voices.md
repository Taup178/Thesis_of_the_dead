Memory tiles now use short existing recordings: "Fresh eyes" when watching, "Stay with me, Shaun. Just this moment" when traversal begins, "You remembered. That was yours" on reaching an intermediate checkpoint, and "Still trying to keep up?" on failure while alive. Reactions have an eight-second minimum spacing and retain the shared maximum of three exchanges per minute. They cancel on phase/stage changes, death, pause and portal entry. Playback uses the same corrected levels, stereo effects, subtitles and background ducking. Reusing the recordings costs no generation credits.

Two Manipulator lines were approved, generated and registered in the Level 2 manifest:

- `l2_manipulator_left`: "Go left. Trust me."
- `l2_manipulator_right`: "Go right. Trust me."

Both use the established Faye voice reference and the same intimate stereo/effect profile, with -18 LUFS / -3 dBTP mastering before the shared playback correction. The stereo Ogg files include effectsBaked and speechDuration metadata. Original WAV and hashes are retained. A single Seed Audio job generated both lines for 0.3 credits; the verified remaining balance was 89.1. Receipt: `audio-staging/voices/level2-memory-results.json`. No retakes.

Directional calls have at least four seconds of spacing from the previous memory reaction and occur at most once per memory stage. Other reactions retain eight-second spacing. Both retain the shared three-exchanges-per-minute cap.

The trigger projects the actual next tile into Shaun's camera frame and selects the opposite lateral direction. It skips straight, rearward and ambiguous jumps. Pending calls expire when the next expected tile changes; an already audible sentence finishes, as requested by the user. It does not alter the route, controls, timers, tile colors or demonstration. Misleading directions are intentional fiction requested by the user; the visual demonstration remains the source of truth.
