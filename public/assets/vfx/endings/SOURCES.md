# Ending visual effects sources

All three shipped PNGs are unmodified source files, renamed for clarity. They
are CC0 1.0 and may be redistributed in the game, including commercial builds.

| File | Original / author | Source | License |
| --- | --- | --- | --- |
| `para-fire-02.png` | `fire_02.png`, para | [Animated particle effects #2](https://opengameart.org/content/animated-particle-effects-2) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `kenney-smoke.png` | `PNG (Transparent)/smoke_01.png`, Kenney Vleugels | [Particle Pack](https://kenney.nl/assets/particle-pack) | CC0; original notice in `Kenney-Particle-Pack-License.txt` |
| `kenney-window.png` | `Default/window_c_blur.png`, Kenney | [Light Masks](https://kenney.nl/assets/light-masks) | CC0; original notice in `Kenney-Light-Masks-License.txt` |

Para's 1024×1024 atlas has 64 frames in an 8×8 grid. The shader blends adjacent
frames and samples the warm flame portion; grey smoke and the source's white
flare are rejected in the shader. The original image remains unchanged.
Kenney's smoke is also used for small ash flecks. The window mask supplies both
the spotlight cookie and its depth-limited atmospheric scattering.

Evaluated but not shipped:

- para `fire_01.png`, `fire_01b.png`, `fire_01c.png`: the flat graphic silhouettes
  read as miniature campfire icons in this scene. `lighter_flame_01.png` was too
  smooth and regular for engulfing fire.
- [CGHEVEN Ground Fire 04 FPV 6×6](https://cgheven.com/assets/ground-fire-04-fpv-flipbook-6x6),
  Ammar Khan: the page advertised free/CC0, but selecting PNG on 27 October 2026
  exposed only a **4K PRO** download and an **Unlock 4K PNG with Pro** button.
  No downloadable asset was obtained or redistributed, and no paywall was bypassed.
