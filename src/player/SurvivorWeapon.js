import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

const steel = new THREE.MeshStandardMaterial({ color: 0xdce9ef, metalness: 0.35, roughness: 0.25, emissive: 0x242b30 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x30353a, metalness: 0.75, roughness: 0.38 });
const gripMaterial = new THREE.MeshStandardMaterial({ color: 0x262324, roughness: 0.78 });

function part(group, geometry, material, position) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position); mesh.castShadow = true; group.add(mesh);
  return mesh;
}

function makePistol() {
  const group = new THREE.Group();
  part(group, new THREE.BoxGeometry(0.105, 0.09, 0.38), darkMetal, [0, 0.035, -0.13]);
  part(group, new THREE.BoxGeometry(0.11, 0.045, 0.32), steel, [0, 0.085, -0.14]);
  part(group, new THREE.BoxGeometry(0.09, 0.22, 0.1), gripMaterial, [0, -0.12, 0.015]).rotation.x = -0.22;
  part(group, new THREE.CylinderGeometry(0.023, 0.023, 0.12, 10), darkMetal, [0, 0.04, -0.36]).rotation.x = Math.PI / 2;
  const muzzle = new THREE.Object3D(); muzzle.name = 'PistolMuzzle'; muzzle.position.set(0, 0.04, -0.43); group.add(muzzle);
  return group;
}

function makeBlade(length) {
  const group = new THREE.Group();
  part(group, new THREE.CylinderGeometry(0.035, 0.039, 0.27, 8), gripMaterial, [0, 0, 0.08]).rotation.x = Math.PI / 2;
  part(group, new THREE.BoxGeometry(0.26, 0.05, 0.055), darkMetal, [0, 0, -0.08]);
  part(group, new THREE.BoxGeometry(length > 0.7 ? 0.095 : 0.07, 0.022, length * 0.8), steel,
    [0, 0, -0.12 - length * 0.4]);
  part(group, new THREE.ConeGeometry(length > 0.7 ? 0.055 : 0.04, length * 0.2, 4), steel,
    [0, 0, -0.12 - length * 0.9]).rotation.x = -Math.PI / 2;
  return group;
}

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
    pistolRight: add('PistolRight', makePistol(), smg.parent),
    pistolLeft: add('PistolLeft', makePistol(), offHand, true),
    sword: add('Sword', makeBlade(1.05), smg.parent),
    dagger: add('Dagger', makeBlade(0.49), smg.parent),
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
    for (const weapons of [this.worldWeapons, this.viewWeapons]) {
      weapons.smg.visible = id === 'smg';
      weapons.pistolRight.visible = id === 'pistol' || id === 'dual';
      weapons.pistolLeft.visible = id === 'dual';
      weapons.sword.visible = id === 'sword';
      weapons.dagger.visible = id === 'dagger';
    }
    for (const { node, single, dual } of this.armGeometries || []) node.geometry = id === 'dual' ? dual : single;
  }

  bash() {
    this.bashing = true;
  }

  update(dt) {
    const p = this.player;
    this.viewRoot.visible = p.isFirstPerson && !p.scriptedMovement && p.group.visible;
    if (p.bashTime <= 0) this.bashing = false;
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
    this.aimBlend = THREE.MathUtils.damp(this.aimBlend ?? 0, aiming ? 1 : 0, 12, dt);
    this.viewModel.position.set(0, 0, 0);
    this.viewModel.rotation.copy(this.viewBaseRotation);
    const anchor = p.weapon === 'smg' ? this.viewWeapons.smg
      : p.weapon === 'pistol' || p.weapon === 'dual' ? this.viewWeapons.pistolRight
        : this.viewWeapons[p.weapon];
    this.viewRoot.updateMatrixWorld(true);
    const grip = this.viewRoot.worldToLocal(anchor.getWorldPosition(new THREE.Vector3()));
    const handHeight = p.weapon === 'smg' ? -0.34
      : p.weapon === 'pistol' ? -0.12 : p.weapon === 'dual' ? -0.2 : -0.14;
    const handDistance = p.weapon === 'dual' ? -1.05 : p.weapon === 'pistol' ? -0.82 : -0.65;
    this.viewModel.position.set(0.24 + (1 - this.aimBlend) * 0.09 - grip.x,
      handHeight - (1 - this.aimBlend) * 0.12 - grip.y,
      handDistance + recoil * 0.055 - grip.z);
    if (this.bashing) {
      const progress = 1 - p.bashTime / (p.weapon === 'sword' ? 0.62 : p.weapon === 'dagger' ? 0.4 : 0.6);
      const strike = progress < 0.36 ? THREE.MathUtils.smoothstep(progress, 0, 0.36) : 1 - THREE.MathUtils.smoothstep(progress, 0.36, 1);
      if (p.weapon === 'sword') {
        this.viewModel.rotation.z += -0.65 * strike;
        this.viewModel.position.x -= 0.18 * strike;
        this.viewModel.position.z -= 0.18 * strike;
      } else if (p.weapon === 'dagger') {
        this.viewModel.position.z -= 0.42 * strike;
        this.viewModel.rotation.x += -0.14 * strike;
      } else this.viewModel.position.add(new THREE.Vector3(-0.2, -0.1, -0.2).multiplyScalar(strike));
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
