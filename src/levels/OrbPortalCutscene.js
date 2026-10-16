import * as THREE from 'three';

const INTRO_DURATION = 0.45;
const HOLD_DURATION = 2.55;
const RETURN_DURATION = 0.45;

/** Briefly frames the first two zombies emerging after the first credit orb. */
export class OrbPortalCutscene {
  constructor(level, player) {
    this.level = level;
    this.player = player;
    this.usesElapsedTime = true;
    this.time = 0;
    this.cameraPosition = player.camera.position.clone();
    this.cameraQuaternion = player.camera.quaternion.clone();
    this.scriptedMovement = !!player.scriptedMovement;
    this.allowsShooting = level.allowsShooting;
    this.focus = level.redPortalCenter.clone();
    this.focus.y += 0.7;

    const portal = level.redPortalCenter;
    this.shotPosition = new THREE.Vector3(portal.x + 4.8, portal.y + 3.3, portal.z - 5.2);
    this.returnPosition = this.cameraPosition.clone();
    this.followPosition = this.shotPosition.clone();
    this.followFocus = this.focus.clone();
    this.followTarget = new THREE.Vector3();
    this.desiredFollowPosition = new THREE.Vector3();
    this.returnStartPosition = new THREE.Vector3();
    this.returnStartFocus = new THREE.Vector3();
    this.returnFocus = new THREE.Vector3();
    this.transitionPosition = new THREE.Vector3();
    this.transitionFocus = new THREE.Vector3();

    player.scriptedMovement = true;
    player.velocity.set(0, 0, 0);
    player.verticalVelocity = 0;
    player.isDodging = false;
    player.input.flushMouseDelta();
    player.camera.getWorldDirection(this.returnFocus);
    this.returnFocus.multiplyScalar(10).add(this.cameraPosition);
    level.allowsShooting = false;
    this._aimCamera(this.cameraPosition, this.returnFocus);
  }

  _aimCamera(position, focus) {
    const camera = this.player.camera;
    camera.position.copy(position);
    camera.lookAt(focus);
    camera.updateMatrixWorld(true);
  }

  update(dt) {
    this.time += dt;
    const camera = this.player.camera;
    const introEnd = INTRO_DURATION;
    const holdEnd = introEnd + HOLD_DURATION;
    const end = holdEnd + RETURN_DURATION;

    for (const zombie of this.level.zombies) {
      if (zombie.portalExit) this.level._updatePortalExit(zombie, dt);
    }

    if (this.time < introEnd) {
      const t = THREE.MathUtils.smootherstep(this.time, 0, introEnd);
      this.transitionPosition.lerpVectors(this.returnPosition, this.shotPosition, t);
      this.transitionFocus.lerpVectors(this.returnFocus, this.focus, t);
      this._aimCamera(this.transitionPosition, this.transitionFocus);
    } else if (this.time < holdEnd) {
      let tracked = 0;
      this.followTarget.set(0, 0, 0);
      for (let i = 0; i < Math.min(2, this.level.zombies.length); i++) {
        const zombie = this.level.zombies[i];
        if (!zombie.group?.visible || !zombie.alive) continue;
        this.followTarget.add(zombie.group.position);
        tracked++;
      }
      if (tracked) {
        this.followTarget.multiplyScalar(1 / tracked);
        this.followTarget.y += 0.9;
      } else {
        this.followTarget.copy(this.focus);
      }

      // Trail the pair down the steps so the shot follows their entrance
      // instead of holding on the portal after they have left it.
      this.desiredFollowPosition.set(
        this.followTarget.x + 4.8,
        this.followTarget.y + 2.4,
        this.followTarget.z - 5.2,
      );
      const followAlpha = 1 - Math.exp(-3.5 * dt);
      this.followPosition.lerp(this.desiredFollowPosition, followAlpha);
      this.followFocus.lerp(this.followTarget, followAlpha);
      this._aimCamera(this.followPosition, this.followFocus);
    } else if (this.time < end) {
      if (!this.returning) {
        this.returning = true;
        this.returnStartPosition.copy(this.followPosition);
        this.returnStartFocus.copy(this.followFocus);
      }
      const t = THREE.MathUtils.smootherstep(this.time, holdEnd, end);
      this.transitionPosition.lerpVectors(this.returnStartPosition, this.returnPosition, t);
      this.transitionFocus.lerpVectors(this.returnStartFocus, this.returnFocus, t);
      this._aimCamera(this.transitionPosition, this.transitionFocus);
    } else {
      this.restore();
    }
    return this.time >= end;
  }

  restore() {
    if (this.restored) return;
    this.restored = true;
    const player = this.player;
    player.scriptedMovement = this.scriptedMovement;
    player.camera.position.copy(this.cameraPosition);
    player.camera.quaternion.copy(this.cameraQuaternion);
    player.camera.updateMatrixWorld(true);
    player.input.flushMouseDelta();
    this.level.allowsShooting = this.allowsShooting;
    this.level.orbPortalCutscene = null;
  }
}
