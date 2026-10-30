import * as THREE from 'three';
import { PortalEmergence } from '../props/RoomExitPortal.js';
import { DEAN_RUN_CLIP_SPEED, getDeanRunDuration, sampleDeanRun } from './DeanRun.js';

const EMERGE_DURATION = 0.45;
const MAX_RUN_DURATION = 5.5;
const ABSORB_DURATION = 0.38;
const RETURN_DURATION = 0.42;

/** Reveal the Dean at the red portal, track his escape, then return the player's view. */
export class WoodsBossCutscene {
  constructor(level, player) {
    this.level = level;
    this.player = player;
    this.usesElapsedTime = true;
    this.time = 0;
    this.fade = 0;
    this.cameraPosition = player.camera.position.clone();
    this.cameraRotation = player.camera.quaternion.clone();
    this.bodyVisible = player.bodyMesh.visible;
    this.scriptedMovement = !!player.scriptedMovement;
    this.allowsShooting = level.allowsShooting;
    this.woods = level.woods;
    this.renderer = level.cinematicRenderer;
    this.graphicsRevision = this.renderer?._graphicsRevision;
    const quality = this.renderer?._graphicsSettings?.preset ?? 'medium';
    const performanceMode = quality === 'low' || quality === 'medium';
    this.woods?.setCinematicDetail(performanceMode);
    this.focus = new THREE.Vector3();
    this.shadow = level.moonLight?.shadow;
    if (this.shadow) {
      this.shadowAutoUpdate = this.shadow.autoUpdate;
      // The woods and enemies hold still. Reuse their shadow map during the escape.
      this.shadow.autoUpdate = !performanceMode;
      this.shadow.needsUpdate = !this.shadow.map;
    }

    player.scriptedMovement = true;
    player.velocity.set(0, 0, 0);
    player.verticalVelocity = 0;
    player.isDodging = false;
    player.bashTime = 0;
    player.shotTime = 0;
    player.swordAttack = null;
    player._updateRollPose?.();
    player._playAnimation?.('Idle_Gun', 'Idle');
    player.bodyMesh.visible = true;
    player.input.flushMouseDelta();
    player.weaponPresentation?.update(0);
    level.allowsShooting = false;

    level.redPortalRoot.updateMatrixWorld(true);
    const opening = level.redPortalRoot.getObjectByName('Object_35') || level.redPortalRoot;
    this.entrance = new THREE.Box3().setFromObject(opening, true).getCenter(new THREE.Vector3());
    this.landing = level.bossMarker.position.clone();
    this.runLength = this.landing.distanceTo(level.portalApproachPoint);
    this.fullRunDuration = getDeanRunDuration(this.runLength);
    this.runDuration = Math.min(MAX_RUN_DURATION, this.fullRunDuration);
    this.skippedTime = this.fullRunDuration - this.runDuration;
    this.editTime = this.runDuration * 0.4;
    this.runEnd = EMERGE_DURATION + this.runDuration;
    this.absorbEnd = this.runEnd + ABSORB_DURATION;
    this.runDistance = 0;
    this.emergence = new PortalEmergence(level.bossMarker, this.entrance);
    this.emergence.duration = EMERGE_DURATION;
    this.entranceCamera = this.landing.clone().add(new THREE.Vector3(3.2, 4.2, -8));
    this._frameEntrance(0);
  }

  _frameEntrance(progress) {
    const camera = this.player.camera;
    // Stay inside the clear central path so trees cannot hide the entrance.
    camera.position.copy(this.entranceCamera);
    this.focus.copy(this.landing); this.focus.y += 1.6;
    this.focus.lerpVectors(this.entrance, this.focus, progress);
    camera.lookAt(this.focus);
    camera.updateMatrixWorld(true);
  }

  _frameRun(runTime) {
    const camera = this.player.camera, position = this.level.bossMarker.position;
    // Two steady shots show his departure and arrival. The covered edit removes
    // travel time in the middle rather than making him slide across the ground.
    const arrival = runTime >= this.editTime;
    camera.position.set(position.x + 3.2, 4.2, position.z + (arrival ? 11 : -8));
    this.fade = 1 - THREE.MathUtils.smootherstep(Math.abs(runTime - this.editTime), 0.025, 0.1);
    this.focus.set(position.x, position.y + 1.6, position.z);
    camera.lookAt(this.focus);
  }

  update(dt, time) {
    const level = this.level, camera = this.player.camera;
    this.time += dt;
    let bossReached = false;

    if (level.bossState === 'emerging') {
      const elapsed = Math.min(this.time, EMERGE_DURATION);
      const step = elapsed - this.emergence.time;
      level._updateBossAnimation(step);
      this.emergence.update(step);
      this._frameEntrance(THREE.MathUtils.smootherstep(elapsed, 0, EMERGE_DURATION));
      if (this.time >= EMERGE_DURATION) {
        this.emergence = null;
        level.bossState = 'running';
        if (level.boss.mixer) level.boss.mixer.timeScale = 1;
        level.boss._playAction('Run', 0.16);
      }
    }
    if (level.bossState === 'running') {
      const runTime = Math.min(this.runDuration, Math.max(0, this.time - EMERGE_DURATION));
      const motionTime = runTime + (runTime >= this.editTime ? this.skippedTime : 0);
      const distance = sampleDeanRun(this.runLength, motionTime);
      // Advancing the clip by distance keeps planted feet aligned with the ground,
      // including acceleration, braking and the journey elided by the edit.
      level._updateBossAnimation(Math.max(0, distance - this.runDistance) / DEAN_RUN_CLIP_SPEED);
      this.runDistance = distance;
      const position = level.bossMarker.position;
      const target = level.portalApproachPoint;
      position.lerpVectors(this.landing, target, this.runLength > 0 ? distance / this.runLength : 1);
      level.bossMarker.lookAt(target.x, target.y, target.z - 1);
      this._frameRun(runTime);
      if (this.time >= this.runEnd) {
        level._beginBossAbsorption();
        level.bossAbsorption.duration = ABSORB_DURATION;
        this.exitFocus = level.bossAbsorption.path.getPointAt(0);
        this.exitAim = this.focus.clone();
        bossReached = true;
      }
    }
    if (level.bossState === 'absorbing') {
      const elapsed = Math.min(this.time - this.runEnd, ABSORB_DURATION);
      level.bossAbsorption.path.getPointAt(Math.min(1, elapsed / ABSORB_DURATION), this.exitFocus);
      level._updateBossAbsorption(Math.max(0, elapsed - level.portalTimer), time);
      this.focus.lerpVectors(this.exitAim, this.exitFocus,
        THREE.MathUtils.smootherstep(elapsed, 0, ABSORB_DURATION));
      camera.lookAt(this.focus);
    }
    if (level.bossState === 'done') {
      if (!this.returnPosition) {
        this.returnPosition = camera.position.clone();
        this.returnRotation = camera.quaternion.clone();
      }
      const returnTime = this.time - this.absorbEnd;
      this.fade = returnTime < 0.14 ? THREE.MathUtils.smootherstep(returnTime, 0, 0.14)
        : 1 - THREE.MathUtils.smootherstep(returnTime, 0.25, RETURN_DURATION);
      if (returnTime < 0.14) {
        camera.position.copy(this.returnPosition); camera.quaternion.copy(this.returnRotation);
      } else {
        // Return under a short fade instead of sweeping through the entire forest.
        this._restorePresentation();
        camera.position.copy(this.cameraPosition); camera.quaternion.copy(this.cameraRotation);
      }
      if (returnTime >= RETURN_DURATION) this.restore();
    }
    camera.updateMatrixWorld(true);
    return bossReached;
  }

  restore() {
    this.emergence?.restore();
    this.emergence = null;
    this.player.scriptedMovement = this.scriptedMovement;
    this.player.bodyMesh.visible = this.bodyVisible;
    this.player.camera.position.copy(this.cameraPosition);
    this.player.camera.quaternion.copy(this.cameraRotation);
    this.player.camera.updateMatrixWorld(true);
    this.player.input.flushMouseDelta();
    this.player.weaponPresentation?.update(0);
    this._restorePresentation();
    this.level.allowsShooting = this.allowsShooting;
    this.level.bossCutscene = null;
  }

  _restorePresentation() {
    if (this.presentationRestored) return;
    this.presentationRestored = true;
    this.woods?.setCinematicDetail(false);
    if (this.shadow) {
      this.shadow.autoUpdate = this.shadowAutoUpdate;
      this.shadow.needsUpdate = true;
    }
  }
}
