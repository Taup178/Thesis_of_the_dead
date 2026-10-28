# Audio submission audit

Reviewed 28 October 2026 against runtime references and the source notes in `public/assets/audio/SOURCES.md`. This is a working audit, not legal clearance. Attribution and permission are separate; a credit or a downloaded file is not evidence of game or trailer distribution rights.

## Music requiring permission evidence

| Served file | Use | Identification evidence | Status |
| --- | --- | --- | --- |
| `music/rannsaka.mp3` | Level 1 | MP3 metadata: Rannsaka, Elephant Music - Topic. Elephant Music's Kenosis playlist lists Rannsaka and states all rights reserved: https://soundcloud.com/elephantmusic-music/sets/kenosis-579815445 | No game distribution licence located; confirm team permission before submission. |
| `music/tar.mp3` | Level 3 Dean | MP3 metadata: Tar, Elephant Music - Topic. | No game distribution licence located; confirm team permission before submission. |
| `fangs.mp3` | Level 2 | MP3 metadata: Fangs, Elephant Music - Topic. | No game distribution licence located; confirm team permission before submission. |
| `red-moon.mp3` | Menu and Level 3 Monster; trailer notes also use it | MP3 metadata: Red Moon, Elephant Music - Topic. | No game or YouTube trailer distribution licence located; confirm separately for both uses. |

Elephant Music describes itself as a music publisher and provides a licensing contact: https://elephantmusic.net/contact/. Metadata identifies the supplied files but is not a licence or proof of ownership. Check with the team for an existing written grant; if none exists, seek appropriate permission or choose suitable licensed replacements. No music has been replaced by this audit.

## Other active sounds

| Served file(s) | Source evidence | Outstanding verification |
| --- | --- | --- |
| `concrete-scrape-loop.mp3` | Supplied kit file; metadata: Concrete scrape loop, TheFkksounds. | Source licence and redistribution permission not established. |
| `brick-wall-impact.mp3` | Supplied kit file; metadata: BRICK WALL IMPACT SOUND EFFECT, Funy Souds. | Source licence and redistribution permission not established. |
| `dean-laugh.mp3` | Optional private local recording, excluded from Git; no redistribution licence documented. | Missing in this checkout; verify the fallback in the actual build, and do not include the private file without permission. |
| `sfx/collect/ammo-pickup-event-*.wav` | Source notes identify dpoggioli, Ammo Pick Up, https://freesound.org/people/Dpoggioli/sounds/213607/, CC BY 4.0, excerpted. | In-game creator, source, licence and modification credit added. Verify source licence evidence and final hosted credits. |
| `sfx/weapon/artninja-sword-swing-*.ogg` | Source notes identify Artninja, https://freesound.org/people/Artninja/sounds/768408/, CC BY 4.0, excerpted. | In-game creator, source, licence and modification credit added. Verify source licence evidence and final hosted credits. |
| `sfx/player/red-ending-fire-scream.wav` | Source notes identify hnhnh fire-whoosh and FngerSounds Scream, both CC0, combined in the supplied mix. | Confirm the mix's provenance and review the source notes before distribution. |
| Other active combat, footsteps, vocal and ambient sound assets | Source notes list individual assets, creators and claimed CC0 sources in `public/assets/audio/SOURCES.md`. | Cross-check every active file, exact source and licence with its original listing; the existing notes explicitly retain some publication-review caveats. |
| Generated internal voices | Higgsfield Seed Audio, documented in `public/assets/audio/SOURCES.md`. | Confirm account-specific and model-specific output and redistribution terms for this project. |

## Submission checks

- Confirm whether any teammate has written licences or assignment-specific permissions for the supplied assets; record who, what, where and when they cover.
- Audit audio in the trailer independently, including generated assets and the Red Moon track; permission for game use would not automatically prove permission for a YouTube trailer.
- Verify the in-game credits and linked source document work on the hosted server. Update titles, sources, licences and modification notices wherever evidence supports them.
- Confirm metadata-only creator identities before treating them as conclusive, and check ownership or permissions with the relevant rights holders.
