# Final ending visual review

28 October 2026 — local review on `feature/final-choice-cutscenes`.

## What changed

The camera path, narrative timings, existing animation clips, hand/degree attachment,
voice events and ending choices are retained.

**Blue:** cold fill gradually gives way to warm window light with real cast shadows.
The same Kenney window mask shapes the light on surfaces and its atmospheric shafts.
The shafts are integrated through scene depth, so foreground surfaces stop them;
they are no longer three translucent planes. Dust is small and soft, and thin blue
traces around Shaun's head disperse by 10 seconds. A restrained chest/shoulder/head
layer adds an inhale, exhale and settled posture over the existing clips. Exposure
adapts gently. The established voice cutoff and silent hold are unchanged.

**Red:** the rejected miniature campfire sprites are replaced by the turbulent
warm portion of para's second fire flipbook. Eighteen overlapping flame elements
follow six rig locations, including through the fall. Their animation phases vary,
adjacent atlas frames blend, and atlas borders are clamped to prevent frame bleed.
They use one instanced draw call. Separate sorted smoke, small embers and two warm
lights give depth without crossed planes. The body and degree char and break into
small fragments during the existing 15–20 second dissolution rather than becoming
a uniformly translucent ghost. The large square ash particles were also removed.

## Browser comparison

The `before` captures replay the implementation saved at the start of this pass,
including the rejected `fire_01` trial, with the same actor, grip, timestamp and
camera. They do not represent the earlier pre-flipbook implementation.

| Frame | Before | After |
| --- | --- | --- |
| Blue, 14s, Medium | [Previous lighting](ending-review/before-blue-release-medium.jpg): visibly separate beam planes, flat floor and a hard distant floor edge | [Current lighting](ending-review/blue-release-medium.jpg): directional shadows, depth-limited warm atmosphere, readable degree and softer distance |
| Red, 10s, Medium | [Previous fire](ending-review/before-red-peak-medium.jpg): floating, repeated cartoon fire icons | [Current fire](ending-review/red-peak-medium.jpg): continuous turbulent flame around the moving body, smoke and reflected warm light |

Additional inspected frames:

- [Blue cold opening, 2s](ending-review/blue-opening-medium.jpg).
- [Blue transition, 7s, Low](ending-review/blue-transition-low.jpg).
- [Blue left inspection angle, 14s, Low](ending-review/blue-release-left-low.jpg).
- [Red right inspection angle, 10s, Low](ending-review/red-peak-right-low.jpg).
- [Red collapse, 14s, Low](ending-review/red-collapse-low.jpg).
- [Red ash, 17s, Low](ending-review/red-ash-low.jpg).

The browser checks caught excessive blue haze, overbright chest lighting, square
ash flecks and visible ray-march grain on Low. Those were corrected and recaptured.
No rectangular flame borders or shader compilation errors were seen in the final
review views. Flames still use camera-facing billboards, but no fixed intersecting
planes. The atmosphere is an approximation of single scattering, not a full
volumetric shadow simulation.

## Quality and performance

Both presets were inspected at a consistent 1280×720 browser viewport. Low uses
0.75 pixel ratio, 512-pixel sunlight shadows, 28 scattering samples and seven smoke
puffs; Medium uses 1.0 pixel ratio, 1024-pixel shadows, 40 samples and fourteen puffs.
Both retain the full flame animation and lighting progression.

Representative warmed visible-page readings were roughly 19–23 ms median frame
time on Blue Low, 24–25 ms on Blue Medium, 17 ms on Red Low and 25 ms on Red Medium.
These are local browser observations, **not a 60 fps guarantee or GPU benchmark**.
Background throttling, compilation and tool interactions caused large outliers;
those were not treated as steady-state game performance. The review page displays
live frame and CPU render timings for testing on the intended machine.

## Validation and review controls

- Full `npm test`: **152 passed, 0 failed**.
- Production build: **passed**, 113 modules. Vite still reports the existing large
  bundle advisory (about 1.18 MB minified / 327 KB gzip).
- Renderer exposure is restored even if an ending render fails; paused pose layers
  do not accumulate; flame anchors follow the animated body; source character
  materials are restored on disposal. These behaviors have regression tests.
- Texture load failure falls back safely rather than blocking the entire level.
- Assets and license notices: [VFX sources](../public/assets/vfx/endings/SOURCES.md).

Run the local development server and open
`/ending-review.html?ending=blue` or `/ending-review.html?ending=red` to scrub the
production cinematics with the real character and degree grip. The review module
is development-only and is not an entry in the production build. Its isolated
stage is silent; use the normal game preview routes
`/?level=3&victory=1&ending=blue` and `/?level=3&victory=1&ending=red` for the full
pickup, portal, dialogue and completion flow.

The project was tested with the existing lockfile's Vite installation in the
temporary audit environment because the checkout's command shims were not usable
on Windows. The final production build ran against the actual project root.
No staging, commits, pushes, merges or publication were performed.
