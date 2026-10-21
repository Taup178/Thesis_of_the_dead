# Monster Boss Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Make the transformed Level 3 Monster fight with a returning degree and three long-range ground smashes.

**Architecture:** Separate degree flight, rock waves and skeletal motion from a small MonsterBoss state machine. Level3 activates it after the existing transformation/camera handoff and routes health, damage, retries and completion through it.

**Tech Stack:** Existing Three.js and Node test runner; no dependencies or generated assets.

**Spec:** `docs/superpowers/specs/2026-10-21-monster-boss-design.md`

## Global Constraints

- Only degree boomerang and triple angled smash attacks.
- No pre-attack UI, floor markers or targeting lights.
- Preserve the Dean encounter and unrelated opening changes.
- Normal player damage/dodge rules, 600 health, degree 22 per pass, rocks 24 per wave.
- Reuse the supplied Monster, degree and existing dependencies.

## Review Focus

- Swept collision across low frame rates, including curved flight and two separate passes.
- A player who dodges outbound must still face a return threat from beyond their position.
- Pausing, death, retry and disposal must stop or clean up every hazard and preserve degree ownership.
- Real rig feet remain planted and fists reach their actual impact positions; throw and catch follow the hand.
- Level 3 combat activates only after camera/control restoration; bullets, melee, health, unlimited SMG and victory work in both boss phases.

### Task 1: Degree and rock hazards

**Files:** create `src/enemies/MonsterDegreeFlight.js`, `src/enemies/MonsterRockWaves.js`, `tests/monster-hazards.test.mjs`.

**Interfaces:** Degree flight consumes root, scroll and catch grip; `launch(aim)`, `update(dt, player)`, `active`, `leg`, `clear()`, `dispose()`. Rock waves expose `launch(origin, direction)`, `update(dt, player)`, `clear()`, `prepare(renderer, scene, camera)`, `dispose()`.

- [x] Write and run failing tests for both degree passes, swept collision, separate dodges, return rear approach, 50m rock travel, jumping, lane commitment and cleanup.
- [x] Implement continuous, distance-timed flight with actual scroll spin/bank, a rounded turnaround and return aim sampled once. Use bounded simulation substeps and swept collision. Preserve scroll transforms on detachment/catch.
- [x] Implement pooled/instanced travelling rocks, impact-only cracks, dust and ballistic debris; 24 damage once per wave and approximately 50m range.
- [x] Run the hazard tests and resolve failures.

### Task 2: Monster motion and controller

**Files:** create `src/enemies/MonsterBossMotion.js`, `src/enemies/MonsterBoss.js`, `tests/monster-boss.test.mjs`; adjust `src/enemies/TransformationMonster.js` only if needed to expose authored clips.

**Interfaces:** MonsterBoss consumes root, monster and the completed transformation's `degreeCatch`; exposes `start()`, `update(dt, player)`, `takeDamage(amount)`, `phase`, `health`, `maxHealth`, `group`, `alive`, `dispose()`. Monster motion consumes the actual rig; applies throw, receive and slam poses after restoring the base skeleton.

- [x] Write/run failing tests using the real Monster rig for hand release/catch, three distinct timed impacts, planted soles, bounded continuous movement, no extra attacks, death and cleanup.
- [x] Use the supplied native animation for shoulders, elbows, wrists, torso and weight transfer; constrain only the foot contacts. Animate throw preparation, release, follow-through, receiving and catching. Animate the triple overhead lift, ground contact and recoil with a fast ballistic jump to a different committed landing before each impact.
- [x] Implement the two-move state machine with recoveries and health; clear hazards on player/boss death.
- [x] Verify the real-rig and hazard tests together.

### Task 3: Level 3 integration and playable verification

**Files:** modify `src/levels/Level3.js`, `src/player/WeaponCombat.js`, `src/core/Game.js`, `README.md`; create `tests/monster-level3.test.mjs`.

- [x] Write/run failing tests for post-camera activation, bullet/melee routing, second-phase SMG, health status, checkpoint retry, defeat completion and disposal.
- [x] Activate MonsterBoss after transformation camera return, stop transformation pose updates once combat owns the rig, update Monster obstacles, route damage/health/completion and retain boss music. Include the Monster in melee candidates. Retry at the existing transformation shortcut/checkpoint.
- [x] Run `npm test`, `npm run build`, `git diff --check` and browser verification of the real textured scene and both attacks.
- [x] Request an independent code review of this change and resolve material findings. Record verification and leave all work reviewable in the current workspace.

## Execution notes

Work in the existing workspace to preserve the user's current playable setup and unrelated uncommitted couch changes. No branch switch, staging or automatic commit. The request authorizes implementing these attacks; unspecified tuning follows the builder choices in the spec.


## Verification

- Completed all three tasks in the existing workspace; unrelated couch changes are preserved.
- Native authored shoulder, elbow and wrist poses replaced procedural arm targeting after the user reported broken-looking arms.
- Real-rig checks cover joint continuity, actual fist/paper floor clearance, three different jump landings, degree ownership and catch continuity.
- Final regression suite: 122 passed, zero failed. Production build passed; existing bundle-size advisory remains.
- Hidden Chrome exercised actual Level 3 activation, outbound/return degree hits and three jumping smashes. The final native arm poses were also rendered for visual comparison.
- Independent final review found no confirmed material defects. No further test runs requested.
