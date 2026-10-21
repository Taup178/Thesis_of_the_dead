# Level 3 internal voices

The Final Encounter uses 24 original recordings in 22 event cues, generated with Higgsfield Seed Audio. The established cast is retained: Ainsley / Tormentor, Brielle / Anxious One, Faye / Manipulator, and Delia / Protector. Scripts and exact voice IDs are recorded in `audio-staging/voices/level3-input.json`; completed jobs are in `level3-results.json`.

Dialogue follows the actual encounter: arrival, visible house emergence, destroyed houses, the remaining deadline, arena clearance, the Dean's approach, his fall and revival, the visible monster reveal, combat and enrage, the fallen monster, physical degree transfer, ownership, visible red/blue portals, and the actual choice. The failure branch acknowledges the threatened degree and speaks about flames only after ignition. The choice lines assign no invented moral outcome to either colour. Direct previews omit all skipped story events.

`Level3Voices` reuses the existing bounded playback, captions, heard-line history, music ducking, settings and cancellation. Optional combat reactions retain cooldowns and expiry; story transitions can speak promptly without waiting for a combat cooldown. Conditions are rechecked before decoding completes or a reply begins. Superseded situations expire, and pause, inventory, mute, death and chapter changes cancel playback and tails. An ending response can finish over the completion card; it never delays portal passage or gameplay.

The per-line masters were processed in Higgsfield's media sandbox with FFmpeg. The 24 served clips total 1,301,043 bytes of 48 kHz stereo Ogg Vorbis, with the earlier chapters' stereo positions, filtered cross-ear reflections, headphone treatment, level balancing, limiting and fades baked in. Playback does not add another echo. Original WAVs remain locally under the Git-ignored `audio-staging/voices/masters/level3/`. `level3-clips.json` records hashes, trim boundaries, durations and generation IDs; `scripts/prepare-level3-voices.py` reproduces processing without generating more speech.

Offline speech recognition checked every original line. Recognition differences were punctuation, the equivalent spelling Sean/Shaun and centre/center, and the numeral 1 for one; no added or missing sentences were found. This is transcription validation, not a claim of subjective listening approval.

Higgsfield permits at most six audio requests per batch. The next concurrent batch hit its rate limit and submitted no jobs, so the remaining batches waited for available capacity. One clock-warning wording failed twice; the shorter replacement succeeded. All 24 final jobs completed and were presented together. No account spending total is inferred from a price quote.

The audition page at `/voice-audition.html?level=3` plays all final clips. The existing victory preview at `/?level=3&victory=1` includes the new pickup and portal dialogue.

Validation: all 143 automated tests and the production build pass. A headless browser decoded and started every stereo clip, checked duck ownership and release, and observed audible captioned dialogue triggered by the real degree transfer. No browser exceptions were reported. Subjective headphone listening remains available through the audition page.
