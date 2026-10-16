import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { SWORD_ATTACKS, getSwordViewPose, getSwordBodyTurn, getSwordThrustWeight, getSwordSpinLevelWeight } from './SwordSwings.js';
import { createKatana, createDagger, createPistol } from './WeaponModels.js';

function mountWeapons(model, barrelAxis) {
  const smg = model.getObjectByName('SMG');
  const offHand = model.getObjectByName('Middle1R') || model.getObjectByName('Middle1.R');
  const barrelRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), barrelAxis);
  const gripRotation = smg.quaternion.clone().multiply(barrelRotation);
  const add = (name, object, parent, mirrored = false) => {
    object.name = name;
    object.position.copy(smg.position);
    object.quaternion.copy(gripRotation);
    if (mirrored) {
      object.position.x *= -1;
      object.quaternion.set(gripRotation.x, -gripRotation.y, -gripRotation.z, gripRotation.w);
    }
    parent.add(object); return object;
  };
  return {
    smg,
    pistolRight: add('PistolRight', createPistol(), smg.parent),
    pistolLeft: add('PistolLeft', createPistol(), offHand, true),
    sword: add('Sword', createKatana(), smg.parent),
    dagger: add('Dagger', createDagger(), smg.parent),
  };
}

const mirroredArmBones = ['Shoulder', 'UpperArm', 'LowerArm', 'Index1', 'Index2', 'Index3',
  'Middle1', 'Middle2', 'Middle3', 'Pinky1', 'Pinky2', 'Pinky3', 'Thumb1', 'Thumb2', 'Thumb3'];

function poseSecondArm(model, weight) {
  if (weight <= 0) return;
  for (const name of mirroredArmBones) {
    const aimingArm = model.getObjectByName(`${name}L`);
    const secondArm = model.getObjectByName(`${name}R`);
    if (!aimingArm || !secondArm) continue;
    const q = aimingArm.quaternion;
    secondArm.quaternion.slerp(new THREE.Quaternion(q.x, -q.y, -q.z, q.w), weight);
  }
  model.updateMatrixWorld(true);
}

function alignSwordArm(model, sword, forward, weight) {
  const arm = model.getObjectByName('UpperArmL') || model.getObjectByName('UpperArm.L');
  const tip = sword.getObjectByName('BladeTip');
  if (!arm || !tip) return;
  model.updateWorldMatrix(true, true);
  const inverseModel = model.matrixWorld.clone().invert();
  const direction = tip.getWorldPosition(new THREE.Vector3())
    .sub(sword.getWorldPosition(new THREE.Vector3())).transformDirection(inverseModel);
  const target = forward.clone().transformDirection(inverseModel);
  const correction = new THREE.Quaternion().slerp(
    new THREE.Quaternion().setFromUnitVectors(direction, target), weight);
  const parent = new THREE.Quaternion();
  inverseModel.clone().multiply(arm.parent.matrixWorld).decompose(new THREE.Vector3(), parent, new THREE.Vector3());
  const local = parent.clone().invert().multiply(correction).multiply(parent);
  arm.quaternion.premultiply(local);
  model.updateMatrixWorld(true);
}

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
      const secondArmBones = new Set(node.skeleton.bones.map((bone, index) =>
        /^(LowerArm|Index\d|Middle\d|Pinky\d|Thumb\d)R$/.test(bone.name) ? index : -1));
      const geometry = node.geometry.clone(), skin = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
      const indices = geometry.index, selected = [], dualSelected = [];
      for (let i = 0; i < (indices?.count || skin.count); i += 3) {
        const triangle = [0, 1, 2].map(k => indices ? indices.getX(i + k) : i + k);
        const belongsToArm = bones => triangle.every(vertex => {
          let influence = 0;
          for (let k = 0; k < 4; k++) if (bones.has(skin.array[vertex * 4 + k])) influence += weights.array[vertex * 4 + k];
          return influence > 0.45;
        });
        const primary = belongsToArm(armBones);
        if (primary) selected.push(...triangle);
        if (primary || belongsToArm(secondArmBones)) dualSelected.push(...triangle);
      }
      geometry.setIndex(selected);
      const dualGeometry = node.geometry.clone(); dualGeometry.setIndex(dualSelected);
      this.armGeometries ??= [];
      this.armGeometries.push({ node, single: geometry, dual: dualGeometry });
      node.geometry = geometry;
    });
    const barrelAxis = player.gunGroup.position.clone().normalize();
    this.worldWeapons = mountWeapons(player.characterModel, barrelAxis);
    this.viewWeapons = mountWeapons(this.viewModel, barrelAxis);
    this.viewMuzzle = this.viewModel.getObjectByName('MuzzlePoint');
    this.viewMixer = new THREE.AnimationMixer(this.viewModel);
    this.viewIdle = this.viewMixer.clipAction(player.animations.find(clip => clip.name === 'Idle'));
    this.viewAim = this.viewMixer.clipAction(player.animations.find(clip => clip.name === 'Idle_Gun'));
    this.viewIdle.play(); this.viewMixer.update(0.001); this.viewRoot.updateMatrixWorld(true);
    this.viewBaseRotation = this.viewModel.rotation.clone();
    const material = new THREE.MeshBasicMaterial({ color: 0xffdf81, transparent: true, depthWrite: false, toneMapped: false });
    const geometry = new THREE.SphereGeometry(0.065, 6, 4);
    this.flashes = [player.muzzlePoint, this.viewMuzzle,
      this.worldWeapons.pistolRight.getObjectByName('PistolMuzzle'), this.viewWeapons.pistolRight.getObjectByName('PistolMuzzle'),
      this.worldWeapons.pistolLeft.getObjectByName('PistolMuzzle'), this.viewWeapons.pistolLeft.getObjectByName('PistolMuzzle')].map(muzzle => {
      const flash = new THREE.Mesh(geometry, material); flash.visible = false; muzzle.add(flash); return flash;
    });
    this.select(player.weapon);
    this.update(0);
  }

  select(id) {
    this.bashing = false;
    this.swordTransition = null;
    for (const weapons of [this.worldWeapons, this.viewWeapons]) {
      weapons.smg.visible = id === 'smg';
      weapons.pistolRight.visible = id === 'pistol' || id === 'dual';
      weapons.pistolLeft.visible = id === 'dual';
      weapons.sword.visible = id === 'sword';
      weapons.dagger.visible = id === 'dagger';
    }
    for (const { node, single, dual } of this.armGeometries || []) node.geometry = id === 'dual' ? dual : single;
  }

  bash({ chain = false } = {}) {
    this.swordTransition = chain && this.swordGripPosition ? {
      grip: this.swordGripPosition.clone(), rotation: this.viewModel.quaternion.clone(), time: 0,
    } : null;
    this.bashing = true;
  }

  update(dt) {
    const p = this.player;
    this.viewRoot.visible = p.alive && p.isFirstPerson && !p.scriptedMovement && p.group.visible;
    if (p.bashTime <= 0 || p.isDodging || p.scriptedMovement) this.bashing = false;
    if (!this.bashing) this.swordTransition = null;
    const aiming = p.isAiming && !p.isDodging;
    if (aiming !== this.viewAiming) {
      (aiming ? this.viewIdle : this.viewAim).fadeOut(0.16);
      (aiming ? this.viewAim : this.viewIdle).reset().fadeIn(0.16).play();
      this.viewAiming = aiming;
    }
    this.viewMixer.update(dt);
    this.dualAimBlend = THREE.MathUtils.damp(this.dualAimBlend ?? 0, p.weapon === 'dual' ? 1 : 0, 15, dt);
    poseSecondArm(p.characterModel, this.dualAimBlend);
    poseSecondArm(this.viewModel, this.dualAimBlend);
    this.viewRoot.position.copy(p.camera.position); this.viewRoot.quaternion.copy(p.camera.quaternion);
    const recoil = Math.sin(Math.max(0, p.shotTime) / 0.14 * Math.PI);
    for (const weapons of [this.worldWeapons, this.viewWeapons]) {
      for (const hand of ['pistolRight', 'pistolLeft']) {
        const slide = weapons[hand].getObjectByName('PistolSlide');
        if (slide) slide.position.z = recoil * 0.028 * (p.weapon === 'dual' || (p.weapon === 'pistol' && hand === 'pistolRight') ? 1 : 0);
      }
    }
    this.aimBlend = THREE.MathUtils.damp(this.aimBlend ?? 0, aiming ? 1 : 0, 12, dt);
    this.viewModel.position.set(0, 0, 0);
    this.viewModel.rotation.copy(this.viewBaseRotation);
    const attack = p.swordAttack || SWORD_ATTACKS[0];
    const progress = 1 - p.bashTime / attack.duration;
    const swordPose = this.bashing && p.weapon === 'sword'
      ? getSwordViewPose(attack, progress) : null;
    const thrustWeight = swordPose ? getSwordThrustWeight(attack, progress) : 0;
    const levelWeight = swordPose ? getSwordSpinLevelWeight(attack, progress) : 0;
    if (thrustWeight > 0 && this.worldWeapons?.sword && p.getForwardDirection) {
      alignSwordArm(p.characterModel, this.worldWeapons.sword, p.getForwardDirection(), thrustWeight);
    }
    if (p.bodyMesh && !p.isDodging && !p.scriptedMovement) {
      p.bodyMesh.rotation.y = swordPose ? getSwordBodyTurn(attack, 1 - p.bashTime / attack.duration) : 0;
    }
    if (levelWeight > 0 && this.worldWeapons?.sword) {
      const sword = this.worldWeapons.sword, tip = sword.getObjectByName('BladeTip');
      p.characterModel.updateWorldMatrix(true, true);
      const target = tip.getWorldPosition(new THREE.Vector3()).sub(sword.getWorldPosition(new THREE.Vector3()));
      if (Math.hypot(target.x, target.z) < 0.001) target.copy(p.getForwardDirection());
      target.y = -0.08 * Math.max(0.01, Math.hypot(target.x, target.z));
      alignSwordArm(p.characterModel, sword, target.normalize(), levelWeight);
    }
    if (swordPose) {
      const [, , , pitch, yaw, roll] = swordPose;
      this.viewModel.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll)));
    }
    const anchor = p.weapon === 'smg' ? this.viewWeapons.smg
      : p.weapon === 'pistol' || p.weapon === 'dual' ? this.viewWeapons.pistolRight
        : this.viewWeapons[p.weapon];
    this.viewRoot.updateMatrixWorld(true);
    const bladeTip = anchor.getObjectByName('BladeTip');
    if ((thrustWeight > 0 || levelWeight > 0) && bladeTip) {
      // Correct the blade angle before calculating the grip pivot; the entire arm follows it.
      const direction = this.viewRoot.worldToLocal(bladeTip.getWorldPosition(new THREE.Vector3()))
        .sub(this.viewRoot.worldToLocal(anchor.getWorldPosition(new THREE.Vector3()))).normalize();
      const target = thrustWeight > 0 ? new THREE.Vector3(0, 0, -1)
        : new THREE.Vector3(direction.x, -0.08 * Math.max(0.01, Math.hypot(direction.x, direction.z)), direction.z).normalize();
      if (levelWeight > 0 && Math.hypot(target.x, target.z) < 0.001) target.set(0, -0.08, -1).normalize();
      const alignment = new THREE.Quaternion().slerp(
        new THREE.Quaternion().setFromUnitVectors(direction, target), Math.max(thrustWeight, levelWeight));
      this.viewModel.quaternion.premultiply(alignment);
      this.viewRoot.updateMatrixWorld(true);
    }
    let transitionAlpha = 1;
    if (swordPose && this.swordTransition) {
      this.swordTransition.time += dt;
      transitionAlpha = THREE.MathUtils.smoothstep(this.swordTransition.time, 0, 0.14);
      this.viewModel.quaternion.slerpQuaternions(this.swordTransition.rotation,
        this.viewModel.quaternion.clone(), transitionAlpha);
      this.viewRoot.updateMatrixWorld(true);
    }
    const grip = this.viewRoot.worldToLocal(anchor.getWorldPosition(new THREE.Vector3()));
    const handHeight = p.weapon === 'smg' ? -0.34
      : p.weapon === 'pistol' ? -0.12 : p.weapon === 'dual' ? -0.2 : -0.14;
    const handDistance = p.weapon === 'dual' ? -1.05 : p.weapon === 'pistol' ? -0.82 : -0.65;
    // Re-anchor after rotating so the swing pivots at the gripping hand, rather than the rig's feet.
    const handPosition = new THREE.Vector3(0.24 + (1 - this.aimBlend) * 0.09 + (swordPose?.[0] ?? 0),
      handHeight - (1 - this.aimBlend) * 0.12 + (swordPose?.[1] ?? 0),
      handDistance + recoil * 0.055 + (swordPose?.[2] ?? 0));
    if (swordPose && this.swordTransition) {
      handPosition.lerpVectors(this.swordTransition.grip, handPosition.clone(), transitionAlpha);
      if (transitionAlpha === 1) this.swordTransition = null;
    }
    this.swordGripPosition = handPosition.clone();
    this.viewModel.position.copy(handPosition).sub(grip);
    if (this.bashing) {
      const progress = 1 - p.bashTime / (p.weapon === 'sword' ? attack.duration : p.weapon === 'dagger' ? 0.4 : 0.6);
      const strike = progress < 0.36 ? THREE.MathUtils.smoothstep(progress, 0, 0.36) : 1 - THREE.MathUtils.smoothstep(progress, 0.36, 1);
      if (p.weapon === 'dagger') {
        this.viewModel.position.z -= 0.42 * strike;
        this.viewModel.rotation.x += -0.14 * strike;
      } else if (p.weapon !== 'sword') this.viewModel.position.add(new THREE.Vector3(-0.2, -0.1, -0.2).multiplyScalar(strike));
    }
    for (let i = 0; i < this.flashes.length; i++) {
      const flash = this.flashes[i];
      flash.visible = p.shotTime > 0.09 && (p.weapon === 'smg' ? i < 2
        : p.weapon === 'pistol' ? i >= 2 && i < 4 : p.weapon === 'dual' && i >= 2);
      flash.scale.setScalar(0.8 + recoil * 0.7);
    }
    this.viewRoot.updateMatrixWorld(true);
  }

  getMuzzlePosition(hand = 'right') {
    this.player.group.updateMatrixWorld(true); this.viewRoot.updateMatrixWorld(true);
    const weapons = this.player.isFirstPerson ? this.viewWeapons : this.worldWeapons;
    const muzzle = this.player.weapon === 'smg' ? (this.player.isFirstPerson ? this.viewMuzzle : this.player.muzzlePoint)
      : weapons[hand === 'left' ? 'pistolLeft' : 'pistolRight'].getObjectByName('PistolMuzzle');
    return muzzle.getWorldPosition(new THREE.Vector3());
  }

  dispose() {
    for (const { node, single, dual } of this.armGeometries || []) (node.geometry === single ? dual : single).dispose();
  }
}
