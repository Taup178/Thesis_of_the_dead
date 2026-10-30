# Graphics settings

Open **Options** from the main menu, or **Settings** from the pause menu, then select the **Graphics** category. Volume, Controls and Graphics have separate panels. Changes apply immediately and save automatically. Individual changes show **Custom**; choosing a preset restores its graphics values while preserving brightness and the FPS display.

| Setting | Visible effect |
| --- | --- |
| Render scale, 50–150% | Trades image sharpness for speed. Above 100% supersamples the image. The panel shows the actual drawing-buffer resolution. |
| Shadows, Off–Ultra | Disables dynamic shadows or selects 512, 1024, 2048 or 4096 pixel shadow maps. Point-light maps are capped at 1024. |
| Texture filtering, 1–16× | Preserves texture detail on surfaces seen at an angle, particularly the ground. Limited to the GPU's supported anisotropy. |
| FXAA | Smooths jagged edges without rebuilding the WebGL context. |
| Ambient occlusion | Adds screen-space contact shading. Uses a half-resolution, 16-sample SSAO pass. |
| Bloom | Adds a restrained glow around bright emissive objects. |
| Cinematic colour | Applies contrast, saturation, warm highlights and a subtle vignette after tone mapping. |
| Motion blur | Enables the existing distress-driven motion trails. |
| Brightness | Adjusts exposure from 70–130%. |
| FPS / frame time | Shows measured frame cadence so players can compare presets. |

Medium is the default. Low disables post-processing and dynamic shadows and renders at 75% scale. High adds ambient occlusion, colour grading, sharper shadows and stronger texture filtering. Ultra increases shadow resolution and render scale further and enables motion blur.

The HUD stays outside post-processing. Scripted cinematics use a separate lightweight path with FXAA when enabled, while skipping gameplay bloom, ambient occlusion, grading and motion trails. Their textures receive the selected filtering even when the stage lives in a separate scene. Endings allow up to 720p on Low, 1080p on Medium, 1440p on High and 2160p on Ultra, limited by the selected render scale and display density. Cinematic shadow maps are capped at 2048. Turning off ambient occlusion or bloom releases their GPU buffers; turning off shadows releases shadow maps.

Existing saved quality preferences migrate automatically. Settings continue to work for the current session if browser storage is unavailable. Gamepad navigation supports all rows and skips the disabled Custom label.

Validation: `node --test tests/graphics-settings.test.mjs`, then `npm test` and `npm run build`. The graphics tests cover live renderer changes, GPU limits, persistence, preset/custom transitions, cinematic bypass, resizing, resource release and gamepad selection.
