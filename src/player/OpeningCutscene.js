import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { OpeningPose } from './OpeningPose.js';
import { OpeningJointLining } from './OpeningJointLining.js';
import { prepareRoomFurniture } from '../shaders/CinematicRenderer.js';

const smooth = THREE.MathUtils.smoothstep;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

function place(model, width, position, rotation = 0) {
  model.rotation.y = rotation;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model, true);
  model.scale.multiplyScalar(width / bounds.getSize(V()).x);
  model.updateMatrixWorld(true);
  bounds.setFromObject(model, true);
  const center = bounds.getCenter(V());
  model.position.add(V(position.x - center.x, -bounds.min.y, position.z - center.z));
  model.updateMatrixWorld(true);
}

function placeBed(model) {
  model.updateMatrixWorld(true);
  // Scale from the mattress/frame, excluding the attached table and lamp.
  const frame = model.getObjectByName('Bed') || model;
  const bounds = new THREE.Box3().setFromObject(frame, true);
  const size = bounds.getSize(V());
  model.scale.multiplyScalar(2.6 / Math.max(size.x, size.z));
  model.scale.x *= 1.12;
  // Show the length of the bed rather than foreshortening it behind the couch.
  model.rotation.y = 0.3;
  model.updateMatrixWorld(true);
  bounds.setFromObject(frame, true);
  const center = bounds.getCenter(V());
  model.position.add(V(3.35 - center.x, -bounds.min.y, 0.35 - center.z));
  model.updateMatrixWorld(true);
}

/** An isolated one-light scene; the gameplay world and real player stay untouched. */
export class OpeningCutscene {
  static async loadAssets() {
    const loader = new GLTFLoader();
    const [couch, bed] = await Promise.all([
      loader.loadAsync('./assets/models/opening/old_couch/scene.gltf'),
      loader.loadAsync('./assets/models/opening/bed__bedside_table/scene.gltf'),
    ]);
    return { couch: couch.scene, bed: bed.scene };
  }

  constructor(player, assets, audio) {
    this.player = player; this.audio = audio;
    this.time = 0; this.done = false; this.fade = 1; this.usesElapsedTime = true;
    this.dialoguePending = false; this.endingAt = null;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.055);
    this.saved = { fov: player.camera.fov, scripted: player.scriptedMovement };
    player.scriptedMovement = true;
    player.input?.consumeKeyPress?.('Enter');

    const floor = new THREE.Mesh(new THREE.CircleGeometry(45, 96),
      new THREE.MeshStandardMaterial({ color: 0x131414, roughness: 0.96, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    this.couch = assets.couch; this.bed = assets.bed;
    place(this.couch, 2.5, V(0, 0, 0));
    placeBed(this.bed);
    for (const model of [this.couch, this.bed]) {
      prepareRoomFurniture(model);
      model.traverse(node => {
        if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
      });
    }
    this.scene.add(this.couch, this.bed);
    this.light = new THREE.SpotLight(0xfff0dc, 150, 16, Math.PI / 3, 0.5, 2);
    this.light.position.set(0.8, 3.8, 3.2); this.light.target.position.set(1, 0.5, 0);
    this.light.castShadow = true; this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.2; this.light.shadow.camera.far = 13;
    this.light.shadow.bias = -0.00015; this.light.shadow.normalBias = 0.018;
    this.light.shadow.radius = 3;
    this.scene.add(this.light, this.light.target);

    this.actor = clone(player.characterModel);
    this.actor.name = 'OpeningShaun'; this.actor.rotation.set(0, 0, 0);
    this.actor.position.set(0, 0, 0);
    this.actor.traverse(node => {
      if (node.isMesh) {
        node.visible = !!node.isSkinnedMesh; node.castShadow = true;
        // Avoid hard self-shadow strips on the low-poly clothing and gloves;
        // retain full shadows from Shaun onto the cushion and floor.
        node.receiveShadow = false;
        node.frustumCulled = false;
      }
    });
    this.scene.add(this.actor);
    const seatZ = 0.44;
    const seatRay = new THREE.Raycaster(V(0, 3, seatZ), V(0, -1, 0));
    const seatY = seatRay.intersectObject(this.couch, true)[0]?.point.y ?? 0.355;
    this.pose = new OpeningPose(this.actor, player.animations?.find(clip => clip.name === 'Idle'), {
      seatY, seatZ, handClip: player.animations?.find(clip => clip.name === 'Wave'),
    });
    this.jointLining = new OpeningJointLining(this.scene, this.actor);
    this.path = new THREE.CatmullRomCurve3([
      V(-3.3, 1.8, 6.6), V(-2.7, 1.50, 4.8), V(-1.75, 1.30, 3.25),
      V(-0.9, 1.17, 2.85), V(-0.35, 1.12, 2.45),
    ], false, 'centripetal');
    this.update(0);
  }

  get cardText() { return this.time < 3.7 ? 'Use headphones for a better experience.' : 'Shaun is experiencing a psychological episode.'; }
  get cardOpacity() {
    if (this.skipped) return 0;
    return this.time < 3.7 ? smooth(this.time, 0.35, 1.1) * (1 - smooth(this.time, 2.8, 3.5))
      : smooth(this.time, 3.9, 4.7) * (1 - smooth(this.time, 6.6, 7.5));
  }
  get active() { return !this.done; }

  skip() {
    if (this.done || this.endingAt !== null) return;
    this.skipped = true;
    this.audio?.internalVoices?.stop();
    this.endingAt = this.time;
  }

  update(dt) {
    if (this.done) return;
    this.time += Math.max(0, Math.min(dt, 0.15));
    this.pose.update(this.time);
    this.jointLining.update();
    const progress = smooth(this.time, 8.2, 32);
    const camera = this.player.camera;
    camera.position.copy(this.path.getPointAt(progress));
    const focus = this.pose.focus.clone();
    // Start by seeing the small, isolated figure; settle on the hands and face.
    focus.y -= THREE.MathUtils.lerp(0.25, 0, progress);
    focus.x += THREE.MathUtils.lerp(0.75, 0, progress) + Math.sin(this.time * 0.35) * 0.008;
    camera.lookAt(focus); camera.rotateZ(Math.sin(this.time * 0.18) * 0.004);
    camera.fov = THREE.MathUtils.lerp(45, 39, progress); camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    this.fade = 1 - smooth(this.time, 7.8, 9.2);
    if (this.endingAt === null && this.time >= 33
      && (!this.dialoguePending && !this.audio?.internalVoices?.active?.size && !this.audio?.internalVoices?.pending?.size || this.time >= 49)) {
      this.endingAt = this.time;
    }
    if (this.endingAt !== null) {
      this.fade = Math.max(this.fade, smooth(this.time - this.endingAt, 0, 0.85));
      if (this.time - this.endingAt >= 1) this.done = true;
    }
  }

  restore() {
    this.player.camera.fov = this.saved.fov; this.player.camera.updateProjectionMatrix();
    this.player.scriptedMovement = this.saved.scripted;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.restore();
    this.jointLining.dispose();
    // Actor geometry/materials belong to Player; dispose only its cloned skeleton.
    this.actor.traverse(node => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const root of [this.couch, this.bed, this.scene.children.find(node => node.geometry?.type === 'CircleGeometry')]) {
      root?.traverse(node => {
        if (node.geometry) geometries.add(node.geometry);
        for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
    }
    for (const item of [...geometries, ...materials, ...textures]) item.dispose();
    this.light.shadow.map?.dispose(); this.scene.clear();
  }
}
