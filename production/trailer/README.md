# Trailer production

Read [production-plan.md](production-plan.md) for the complete 88-second storyboard,
voice selections, music cues, four prompts and quality gates. Read
[seedance-requests.json](seedance-requests.json) for the prepared **unsubmitted**
requests and confirmed actual-game reference IDs. Generation requires approval.

`scripts/gameplay-takes.js` is injected only by the developer capture driver. It
runs the real Game loop using a fixed simulation timestep and ordinary movement,
roll, jump, aim and fire inputs. Starting checkpoints are staged between takes.
There is no invincibility, fake damage or altered collision inside a take. Raw
masters are silent; sound is mixed separately. Fixed-step capture is not a live
performance benchmark. Tests and failed takes are not finished trailer footage.

The remote Higgsfield editing sandbox has Playwright and FFmpeg installed. With a
Vite server running on port 5173 there, capture with:

```sh
TRAILER_TAKES=dungeon_saws,dungeon_memory_run TRAILER_FPS=30 node scripts/record-gameplay.mjs
```

Use `TRAILER_VALIDATE_ONLY=1` first to check controller routes without rendering
each frame. `TRAILER_SECONDS` can limit a test. `TRAILER_OUTPUT` selects a separate
output folder to preserve previous takes. Use 60 only for native 60-frame capture;
do not duplicate a 30 FPS source and describe it as native 60 FPS.

`scripts/capture-trailer.mjs` produces scenic current-engine references, distinct
from gameplay recordings. Its optional two-second 12 FPS motion clips are model
planning references, not final trailer sources. Use `TRAILER_SHOTS` and
`TRAILER_STILLS_ONLY=1` to capture selected stills. Some shots depend on earlier
setup shots; the desert sequence starts with `desert_wide`.

The existing source Red Moon asset begins at **00:25.000**, not an unrelated track.
Keep the project's four female voice identities. The final title is the final
image. Do not show the transformation, degree pickup or ending choice.

Generated media, raw frames and large ZIP/MP4 exports are ignored by git. Keep the
plans, scripts and metadata in source control. No game source was changed by the
trailer capture tooling.
