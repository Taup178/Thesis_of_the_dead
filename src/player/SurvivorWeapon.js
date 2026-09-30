import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/** Uses the kit's authored grip, including its fingers, in both camera modes. */
export class SurvivorWeapon {
  constructor(player) {
    this.player = player;
    this.gun = player.characterModel.getObjectByName('SMG');
    if (!this.gun) throw new Error('Shaun is missing his SMG');
    player.group.updateMatrixWorld(true);
    const vertices = this.gun.geometry.getAttribute('position'), tip = new THREE.Vector3(), samples = [];
    let minZ = Infinity;
    for (let i = 0; i < vertices.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(this.gun.matrixWorld);
      samples.push(point); minZ = Math.min(minZ, point.z);
    }
    const front = samples.filter(point => point.z < minZ + 0.018);
    front.forEach(point => tip.add(point)); tip.multiplyScalar(1 / front.length);
    player.gunGroup.position.copy(this.gun.worldToLocal(tip)); this.gun.add(player.gunGroup);
    player.muzzlePoint.position.set(0, 0, 0); player.muzzlePoint.name = 'MuzzlePoint';

    this.viewRoot = new THREE.Group(); this.viewRoot.name = 'FirstPersonWeapon';
    this.viewModel = skeletonClone(player.characterModel); this.viewRoot.add(this.viewModel); player.scene.add(this.viewRoot);
    this.viewModel.scale.multiplyScalar(0.72);
    this.viewModel.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false; node.frustumCulled = false;
      if (!node.isSkinnedMesh) return;
      // The mirrored rig's original left arm is now the visible right arm.
      const armBones = new Set(node.skeleton.bones.map((bone, index) =>
        /^(LowerArm|Index\d|Middle\d|Pinky\d|Thumb\d)L$/.test(bone.name) ? index : -1));
      const geometry = node.geometry.clone(), skin = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
      const indices = geometry.index, selected = [];
      for (let i = 0; i < (indices?.count || skin.count); i += 3) {
        const triangle = [0, 1, 2].map(k => indices ? indices.getX(i + k) : i + k);
        let influence = 0;
        for (const vertex of triangle) for (let k = 0; k < 4; k++) {
          if (armBones.has(skin.array[vertex * 4 + k])) influence += weights.array[vertex * 4 + k];
        }
        if (influence > 1.5) selected.push(...triangle);
      }
      geometry.setIndex(selected); node.geometry = geometry;
    });
    this.viewMuzzle = this.viewModel.getObjectByName('MuzzlePoint');
    this.viewMixer = new THREE.AnimationMixer(this.viewModel);
    this.viewIdle = this.viewMixer.clipAction(player.animations.find(clip => clip.name === 'Idle_Gun'));
    this.viewIdle.play(); this.viewMixer.update(0.001); this.viewRoot.updateMatrixWorld(true);
    const grip = this.viewModel.getObjectByName('SMG').getWorldPosition(new THREE.Vector3());
    this.viewModel.position.add(new THREE.Vector3(0.24, -0.34, -0.65).sub(grip));
    this.viewBase = this.viewModel.position.clone();
    const material = new THREE.MeshBasicMaterial({ color: 0xffdf81, transparent: true, depthWrite: false, toneMapped: false });
    const geometry = new THREE.SphereGeometry(0.065, 6, 4);
    this.flashes = [player.muzzlePoint, this.viewMuzzle].map(muzzle => {
      const flash = new THREE.Mesh(geometry, material); flash.visible = false; muzzle.add(flash); return flash;
    });
    this.update(0);
  }

  bash() {
    this.bashing = true;
  }

  update(dt) {
    const p = this.player;
    this.viewRoot.visible = p.isFirstPerson && !p.scriptedMovement && p.group.visible;
    if (p.bashTime <= 0) this.bashing = false;
    this.viewMixer.update(dt);
    this.viewRoot.position.copy(p.camera.position); this.viewRoot.quaternion.copy(p.camera.quaternion);
    const recoil = Math.sin(Math.max(0, p.shotTime) / 0.14 * Math.PI);
    this.viewModel.position.copy(this.viewBase); this.viewModel.position.z += recoil * 0.055;
    if (this.bashing) {
      const progress = 1 - p.bashTime / 0.6;
      const strike = progress < 0.36 ? THREE.MathUtils.smoothstep(progress, 0, 0.36) : 1 - THREE.MathUtils.smoothstep(progress, 0.36, 1);
      this.viewModel.position.add(new THREE.Vector3(-0.2, -0.1, -0.2).multiplyScalar(strike));
    }
    for (const flash of this.flashes) { flash.visible = p.shotTime > 0.09; flash.scale.setScalar(0.8 + recoil * 0.7); }
    this.viewRoot.updateMatrixWorld(true);
  }

  getMuzzlePosition() {
    this.player.group.updateMatrixWorld(true); this.viewRoot.updateMatrixWorld(true);
    return (this.player.isFirstPerson ? this.viewMuzzle : this.player.muzzlePoint).getWorldPosition(new THREE.Vector3());
  }
}
