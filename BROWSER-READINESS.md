# Browser and deployment readiness

Checked 15 October 2026. The production build and nested-folder hosting work. Performance improved, though a brief Chapter 2 stall remains inconsistent between runs and should be checked on lab hardware.

I rebuilt the project and served only `dist/` over HTTP beneath `/grading/team7/` using a case-sensitive static-file handler. Hidden Chrome loaded all three chapters, sampled frames and CPU activity, then returned to the menu while GPU resource disposal was tracked. This covered level starts and transitions, not a full playthrough or the actual lab machine.

## Changes made

- Resized PNG textures above 1024 px on an edge to 1024, keeping their channels and filenames unchanged. Public assets fell from 227.77 MiB to 101.46 MiB; the three spike maps fell from 69.84 MiB to 6.09 MiB. The three-level browser run requested about 97.51 MiB of local files.
- Updated `Zombie.dispose()` to release cloned skeletons and animation mixers while preserving shared model assets. Renderer textures after the three-level sequence fell from 115 to 16. Four retained zombie atlases belong to the shared cache. Twelve tracked bone textures still had no disposal event, so continued multi-session growth should be monitored.
- Reduced tree, rock and ground-cover instance counts in the woods. At the sampled view, visible triangles fell from 1.32-1.37 million to about 841,000-856,000.
- Set Medium graphics as the fresh-install default. High remains available, and saved user settings still take precedence. Quality changes can now restore authored shadow sizes when switching back to High.
- Reused Player movement and camera vectors, zombie steering vectors and result objects, and routed-zombie steering vectors. Cached world bounds and empty obstacle lists to remove more per-frame allocations.
- Added shader compilation after the level and camera setup and rendered a warmup frame while the loading screen is still visible.

## Remaining concern

Chapter 2 still showed an intermittent first gameplay frame near 0.9 seconds across several runs, with CPU samples in `getProgramInfoLog`, even after the loading-screen warmup; median frame intervals were 16.7 ms. A local woods run varied from about 30 to 60 FPS at 1280x800, while Chapters 2 and 3 were mostly near 60 FPS. These headless local readings vary and do not predict lab hardware performance.

## Hosting checks

| Requirement | Result |
| --- | --- |
| Power-of-two textures | All 87 standalone images checked use power-of-two dimensions; resized PNGs are at most 1024 px per edge. |
| Geometry and draw calls | Instancing remains in use. Sample draw calls were about 59-60 / 28-245 / 320 across chapters; Chapter 2 varies with the entrance animation. |
| Resource cleanup | Level transitions dispose levels. Zombie skeleton clones now dispose explicitly; twelve tracked bone textures remain unexplained. |
| Paths and case | `vite.config.js` uses `base: './'`. All three chapters loaded from `/grading/team7/`; 103 checked asset references matched exact filename case, with no local 404s. |
| External assets | Runtime font requests use HTTPS and CSS fallback fonts are available. No insecure runtime asset URL was found. |
| Production build | `npm run build` succeeds. Vite warns that the 937.10 kB JavaScript bundle exceeds its 500 kB advisory threshold (254 kB gzip estimate). |
| Distribution | `dist/` contains the built app and copied public assets. Upload its contents, not `src/`, `node_modules/`, or the raw asset kit. No upload was performed. |
| Automated tests | The existing test files are deleted in the current working tree. This audit does not claim a passing regression suite. |

The nested-folder production check loaded all three chapters without browser errors. Actual hosting configuration and lab-machine performance still need an on-site check.
