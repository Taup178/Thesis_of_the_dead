import * as THREE from 'three';

/** Hold the fallen pose, rise using the reversed fall animation, then return the camera. */
export class WakeUpIntro {
  constructor(player) {
    this.player = player; this.time = 0; this.done = false;
    this.riseEnd = 2.75; this.duration = 3.5;
    this.bodyPosition = player.bodyMesh.position.clone();
    this.bodyRotation = player.bodyMesh.quaternion.clone();
    this.bodyVisible = player.bodyMesh.visible;
    this.bounds = new THREE.Box3();
    player.scriptedMovement = true; player.bodyMesh.visible = true;
    this.action = player.actions?.Death;
    if (this.action) {
      player.mixer.stopAllAction();
      this.action.reset().setLoop(THREE.LoopOnce, 1).setEffectiveWeight(1).play();
      this.action.paused = true;
      player.currentAction = this.action; player.currentActionName = 'Death';
    }
    this._pose(0);
    const center = this.bounds.getCenter(new THREE.Vector3());
    this.cameraPosition = center.clone().add(new THREE.Vector3(3.5, 2.1, 3.5));
    player.camera.position.copy(this.cameraPosition); player.camera.lookAt(center);
    player.camera.updateMatrixWorld(true);
    player.weaponPresentation?.update(0);
  }

  _pose(progress) {
    const player = this.player;
    player.bodyMesh.position.copy(this.bodyPosition);
    if (this.action) {
      this.action.time = this.action.getClip().duration * (1 - progress);
      player.mixer.update(0);
    } else {
      player.bodyMesh.quaternion.copy(this.bodyRotation).multiply(new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2 * (1 - progress)));
    }
    player.group.updateMatrixWorld(true);
    this.bounds.setFromObject(player.bodyMesh, true);
    if (!this.bounds.isEmpty()) {
      const lift = player.group.position.y + 0.02 - this.bounds.min.y;
      player.bodyMesh.position.y += lift;
      this.bounds.translate(new THREE.Vector3(0, lift, 0));
    }
  }

  _stand() {
    const player = this.player;
    this.action?.stop();
    player.bodyMesh.position.copy(this.bodyPosition);
    player.bodyMesh.quaternion.copy(this.bodyRotation);
    if (player.mixer) { player._playAnimation('Idle_Gun', 'Idle'); player.mixer.update(0); }
  }

  update(dt) {
    if (this.done) return;
    this.time += dt;
    const player = this.player;
    if (this.time < this.riseEnd) {
      this._pose(THREE.MathUtils.smoothstep(this.time, 0.65, this.riseEnd));
      player.camera.lookAt(this.bounds.getCenter(new THREE.Vector3()));
    } else {
      if (!this.cameraRotation) {
        this._stand();
        this.cameraRotation = player.camera.quaternion.clone();
      }
      player.mixer?.update(dt);
      const t = THREE.MathUtils.smoothstep(this.time, this.riseEnd, this.duration);
      player._updateCamera();
      player.camera.position.lerpVectors(this.cameraPosition, player.camera.position, t);
      player.camera.quaternion.slerpQuaternions(this.cameraRotation, player.camera.quaternion, t);
      if (t === 1) this.restore();
    }
    player.camera.updateMatrixWorld(true);
  }

  restore() {
    if (this.done) return;
    this._stand();
    this.player.bodyMesh.visible = this.bodyVisible;
    this.player.scriptedMovement = false;
    this.player._updateCamera(); this.player.weaponPresentation?.update(0);
    this.done = true;
  }
}
