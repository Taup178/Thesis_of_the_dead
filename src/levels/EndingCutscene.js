import * as THREE from 'three';
import { EndingFire } from './EndingFire.js';
import { CinematicRenderer, CINEMATIC_RESOLUTION, prepareRoomFurniture } from '../shaders/CinematicRenderer.js';

const smooth = THREE.MathUtils.smoothstep;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Furniture is loaded independently of the opening scene: neither cinematic owns
// or disposes the other's geometry or textures.
function place(model, width, x, z) {
  model.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(V(0, 0, 0));
  model.scale.multiplyScalar(width / Math.max(size.x, size.z, 0.001));
  model.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(model, true);
  const center = box.getCenter(V(0, 0, 0));
  model.position.add(V(x - center.x, -box.min.y, z - center.z));
}

/** Isolated ending stage; the real player and the held degree stay together. */
export class EndingCutscene {
  constructor(player, choice, assets = null, textures = {}) {
    this.player = player; this.choice = choice; this.time = 0; this.done = false;
    this.phase = 'reveal'; this.fade = 1; this.disposed = false;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x080a0d);
    this.scene.fog = new THREE.FogExp2(0x080a0d, 0.055);
    this.saved = { parent: player.group.parent, position: player.group.position.clone(), quaternion: player.group.quaternion.clone(),
      scale: player.group.scale.clone(), visible: player.group.visible, fov: player.camera.fov,
      scripted: player.scriptedMovement, body: player.bodyMesh?.visible, bodyScale: player.bodyMesh?.scale.clone() };
    this.scene.add(player.group); player.group.position.set(0, 0, 1.25); player.group.rotation.set(0, Math.PI, 0);
    player.group.visible = true; player.scriptedMovement = true;
    if (player.bodyMesh) player.bodyMesh.visible = true;
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: 0x242729, roughness: 1 }));
    this.floor.receiveShadow = true; this.floor.rotation.x = -Math.PI / 2; this.scene.add(this.floor);
    this.furniture = assets ? [assets.couch, assets.bed] : [];
    if (assets) { place(assets.couch, 2.5, 0, -1.3); place(assets.bed, 2.6, 3.4, -1.2); this.scene.add(...this.furniture); }
    for (const root of this.furniture) prepareRoomFurniture(root);
    for (const root of this.furniture) root.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    if (choice === 'red') {
      this.scene.background.setHex(0x000000);
      this.scene.fog = null;
      this.floor.visible = false;
      for (const root of this.furniture) root.visible = false;
    }
    this.ambient = new THREE.HemisphereLight(0xd5e7ed, 0x303033, 0.7); this.scene.add(this.ambient);
    this.light = new THREE.SpotLight(0xffe7c7, 75, 18, Math.PI / 3, 0.7, 2);
    this.light.position.set(-2, 5, 4); this.light.target.position.set(0, 1, 0); this.scene.add(this.light, this.light.target);
    this.path = new THREE.CatmullRomCurve3([V(-4, 2.25, 7), V(-3, 1.8, 5.5), V(-1.7, 1.45, 4.4), V(-1.15, 1.65, 4.8)]);
    this.focus = V(0, 1.15, 0.8);
    this.textures = textures ?? {}; this.quality = null; this.exposure = 1;
    if (choice === 'red') this._makeFire(); else this._makePeaceAtmosphere();
    player._playAnimation?.('Idle', 'Idle_Gun');
  }

  _makePeaceAtmosphere() {
    this.player.camera.fov = 46; this.player.camera.updateProjectionMatrix();
    this.floor.material.color.setHex(0x131414);
    this.roomResources = [];
    // Soft contact patches ground the furniture without a per-frame shadow pass.
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
      pixels[(y * 32 + x) * 4 + 3] = Math.round(100 * Math.max(0, 1 - radius) ** 1.5);
    }
    const map = new THREE.DataTexture(pixels, 32, 32); map.needsUpdate = true;
    map.magFilter = map.minFilter = THREE.LinearFilter;
    const contactMaterial = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false });
    const contactGeometry = new THREE.PlaneGeometry(1, 1);
    this.roomResources.push(map, contactMaterial, contactGeometry);
    for (const [x, z, width, depth] of [[0, -1.3, 3, 2], [3.4, -1.2, 2.6, 3], [0, 1.25, .8, .65]]) {
      const shadow = new THREE.Mesh(contactGeometry, contactMaterial);
      shadow.rotation.x = -Math.PI / 2; shadow.position.set(x, .012, z); shadow.scale.set(width, depth, 1);
      this.scene.add(shadow); this.actorContact = shadow;
    }
    // One ordinary scene pass. No ray-marched volume or animated shadow maps.
    this.scene.remove(this.ambient);
    this.light.color.setHex(0xfff0dc);
    this.light.position.set(.8, 3.8, 3.2);
    this.light.target.position.set(1, .5, 0);
    this.light.distance = 16; this.light.angle = Math.PI / 3; this.light.penumbra = .5;
    this.light.castShadow = true;
    this.light.shadow.camera.near = .2; this.light.shadow.camera.far = 13;
    this.light.shadow.bias = -.00015; this.light.shadow.normalBias = .018;
    this.light.shadow.radius = 3;
    for (const root of this.furniture) root.traverse(node => {
      if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; }
    });
    this.actorShadowSettings = [];
    this.player.group.traverse(node => {
      if (!node.isMesh) return;
      this.actorShadowSettings.push({ node, receiveShadow: node.receiveShadow });
      // Match the opening: the low-poly face and cap should not become black
      // from self-shadow strips. Shaun still casts a real shadow on the floor.
      node.receiveShadow = false;
    });
    const bed = this.furniture[1];
    bed?.updateMatrixWorld(true);
    const bounds = bed ? new THREE.Box3().setFromObject(bed.getObjectByName('Bed') || bed, true) : null;
    this.bedside = bounds ? V(bounds.min.x - .55, 0, (bounds.min.z + bounds.max.z) / 2 + .35) : V(2.25, 0, -.8);
    this.bedPath = new THREE.CatmullRomCurve3([V(0, 0, 1.25), V(this.bedside.x * .55, 0, 1.25),
      V(this.bedside.x, 0, .65), this.bedside.clone()], false, 'centripetal');
    this.bedWalkDuration = this.bedPath.getLength() / 1.25;
    this.bedPoint = V(); this.bedTangent = V(); this.bedHeading = new THREE.Quaternion();
    this.bedAxis = V(0, 1, 0);
    this.blueCameraStart = V(-4.2, 2.2, 6.8); this.blueCameraEnd = V(-2.6, 2.2, 5.8);
    this.blueFocus = V();
    this.poseBones = ['Abdomen', 'Torso', 'Head', 'ShoulderR', 'ShoulderL', 'UpperArmR', 'UpperArmL'].map(name => this.player.characterModel?.getObjectByName(name));
    this.poseOffsets = this.poseBones.map(() => new THREE.Quaternion());
    this.poseAxis = V(1, 0, 0);
  }

  _updatePeace(t, peace, dt) {
    this.peace = peace;
    this.exposure = 1;
    this.light.intensity = 150;
    this.scene.background.setHex(0x000000); this.scene.fog.density = .055;
    this.scene.fog.color.copy(this.scene.background);
    const player = this.player;
    const progress = THREE.MathUtils.smootherstep(t, 8, 8 + this.bedWalkDuration);
    const previous = player.group.position;
    this.bedPath.getPointAt(progress, this.bedPoint);
    const speed = dt > 0 ? previous.distanceTo(this.bedPoint) / dt : 0;
    this.bedPath.getTangentAt(Math.min(.9999, progress), this.bedTangent);
    const yaw = Math.atan2(-this.bedTangent.x, -this.bedTangent.z);
    this.bedHeading.setFromAxisAngle(this.bedAxis, yaw);
    if (t >= 6) player.group.quaternion.rotateTowards(this.bedHeading, dt * 2.5);
    player.group.position.copy(this.bedPoint);
    this.actorContact.position.x = this.bedPoint.x; this.actorContact.position.z = this.bedPoint.z;
    const walking = t >= 8 && progress < 1;
    this._animate(walking ? 'Walk' : 'Idle');
    if (player.currentAction) {
      player.currentAction.setLoop?.(THREE.LoopRepeat, Infinity);
      player.currentAction.clampWhenFinished = false;
      player.currentAction.paused = false;
      player.currentAction.setEffectiveTimeScale?.(walking ? THREE.MathUtils.clamp(speed / 1.8, .3, 1.15) : 1);
    }
    this.phase = t < 2 ? 'reveal' : t < 8 ? 'release' : walking ? 'walk-to-bed' : 'rest';
    const camera = player.camera;
    camera.position.lerpVectors(this.blueCameraStart, this.blueCameraEnd, smooth(t, 0, 18));
    this.blueFocus.copy(player.group.position); this.blueFocus.y = 1.05;
    this.blueFocus.x *= .6; this.blueFocus.z *= .6;
    camera.lookAt(this.blueFocus); camera.updateMatrixWorld(true);
  }

  _clearReliefPose() {
    this.poseBones?.forEach((bone, i) => { if (bone) bone.quaternion.multiply(this.poseOffsets[i].invert()); this.poseOffsets[i].identity(); });
  }

  _reliefPose(t) {
    // A held inhale, long exhale, then an open, still chest, layered over the
    // existing clips. Fingers and the degree grip remain untouched.
    const release = smooth(t, 5.5, 10), settle = smooth(t, 12.5, 15);
    const inhale = Math.sin(Math.PI * smooth(t, 5.5, 9.5));
    const breath = Math.sin(t * (1.7 - release * .65)) * (.012 - release * .005);
    const angles = [.055*(1-release)-inhale*.025+breath, .07*(1-release)-inhale*.04,
      .11*(1-release)+Math.sin(Math.PI*smooth(t,9,12))*.13-settle*.035,
      .035*(1-release)-settle*.025, .035*(1-release)-settle*.025,
      -.20 * (smooth(t, 1.5, 2.5) - smooth(t, 4.5, 6)),
      -.20 * (smooth(t, 1.5, 2.5) - smooth(t, 4.5, 6))];
    this.poseBones?.forEach((bone, i) => {
      if (!bone) return;
      this.poseOffsets[i].setFromAxisAngle(this.poseAxis, angles[i]); bone.quaternion.multiply(this.poseOffsets[i]);
    });
  }

  render(renderer, quality = 'medium') {
    // Match the selected preset, rather than reducing every ending to 720p.
    // Bound cinematic fill cost independently of display density. Keep this
    // ratio for playback; resizing the drawing buffer twice per frame stalls.
    if (renderer.getSize && renderer.getPixelRatio && renderer.setPixelRatio) {
      this.renderSize ??= new THREE.Vector2();
      renderer.getSize(this.renderSize);
      const current = renderer.getPixelRatio();
      if (this.renderRenderer !== renderer || current !== this.renderPixelRatio || this.graphicsRevision !== renderer._graphicsRevision) {
        this.originalPixelRatio = current;
        this.renderRenderer = renderer;
        this.graphicsRevision = renderer._graphicsRevision;
      }
      const budget = CINEMATIC_RESOLUTION[quality] ?? CINEMATIC_RESOLUTION.medium;
      const ratio = Math.min(this.originalPixelRatio, budget.ratio,
        budget.width / Math.max(1, this.renderSize.x), budget.height / Math.max(1, this.renderSize.y));
      if (current !== ratio) renderer.setPixelRatio(ratio);
      this.renderPixelRatio = ratio;
    }
    if (this.quality !== quality) {
      this.quality = quality;
      if (this.sun?.castShadow) {
        const size = quality === 'low' ? 512 : 1024;
        this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
      }
    }
    const exposure = renderer.toneMappingExposure;
    try {
      renderer.toneMappingExposure = exposure * this.exposure;
      this.presentation ??= new CinematicRenderer(renderer);
      this.presentation.render(this.scene, this.player.camera, quality);
    } finally { renderer.toneMappingExposure = exposure; }
  }

  _makeFire() {
    this.fireEffects = new EndingFire(this.scene, this.player, this.textures);
    this.fireUniforms = this.fireEffects.uniforms;
    this.ashGeometry = new THREE.BufferGeometry(); this.ashPositions = new Float32Array(64 * 3);
    this.ashGeometry.setAttribute('position', new THREE.BufferAttribute(this.ashPositions, 3));
    this.ashMaterial = new THREE.PointsMaterial({ color: 0x77716b, map: this.textures.smoke ?? null, size: .028, transparent: true, opacity: 0, depthWrite: false });
    this.ashCloud = new THREE.Points(this.ashGeometry, this.ashMaterial); this.ashCloud.frustumCulled = false; this.scene.add(this.ashCloud);
    // Use private copies: fading Shaun and his held degree must never mutate
    // cached or shared player materials, and must be reversible on retry.
    this.dissolveMaterials = [];
    this.dissolveUniforms = { ash: { value: 0 }, char: { value: 0 } };
    this.player.group.traverse(node => {
      if (!node.isMesh || !node.material) return;
      const original = node.material;
      const copy = m => {
        const clone = m.clone();
        clone.onBeforeCompile = shader => {
          shader.uniforms.endingAsh = this.dissolveUniforms.ash;
          shader.uniforms.endingChar = this.dissolveUniforms.char;
          shader.vertexShader = 'varying vec3 vEndingPosition;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
            '#include <project_vertex>\nvEndingPosition=(modelMatrix*vec4(transformed,1.)).xyz;');
          shader.fragmentShader = 'uniform float endingAsh; uniform float endingChar; varying vec3 vEndingPosition;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            vec3 cell=floor(vEndingPosition*95.);
            float grain=fract(sin(dot(cell,vec3(12.9898,78.233,37.719)))*43758.5453);
            if(grain<endingAsh)discard;
            diffuseColor.rgb*=mix(1.,.12,endingChar);
          `);
        };
        clone.customProgramCacheKey = () => 'ending-char-ash-v1';
        this.dissolveMaterials.push(clone); return clone;
      };
      node.material = Array.isArray(original) ? original.map(copy) : copy(original);
      (this.dissolveOriginals ??= []).push({ node, original });
    });
  }

  _animate(name, once = false) {
    if (this.actionName === name) return;
    this.actionName = name; this.player._playAnimation?.(name, 'Idle');
    const action = this.player.currentAction;
    if (once && action?.setLoop) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
  }

  _updateFire(t, amount, ash) {
    this.fireEffects.update(t, amount, ash, this.quality);
    const origin = this.player.group.position;
    const drift = Math.max(0, t - 15);
    for (let i = 0; i < 64; i++) {
      const a = i * 2.399963, spread = .25 + (i % 7) * .09 + drift * .1;
      this.ashPositions[i * 3] = origin.x + Math.sin(a + drift * .2) * spread;
      this.ashPositions[i * 3 + 1] = .1 + (i % 17) * .025 + drift * (.1 + (i % 4) * .045);
      this.ashPositions[i * 3 + 2] = origin.z + Math.cos(a) * spread;
    }
    this.ashGeometry.attributes.position.needsUpdate = true;
    this.ashMaterial.opacity = smooth(t, 15, 17) * (1 - smooth(t, 20, 22));
    this.dissolveUniforms.ash.value = ash;
    this.dissolveUniforms.char.value = smooth(t, 12, 16);
    if (ash >= .999) this.player.group.visible = false;
  }

  update(dt) {
    if (this.done || this.disposed) return;
    this._clearReliefPose();
    let step = Math.max(0, Math.min(dt, .15));
    if (this.choice === 'blue' && this.finalVoice && this.time >= 17) {
      if (this.finalVoice.state !== 'finished') step = 0;
      else if ((this.finalSilence ?? 0) < 2) {
        this.finalSilence = (this.finalSilence ?? 0) + step;
        step = 0;
      }
    }
    this.time += step;
    const t = this.time, red = this.choice === 'red', p = this.player;
    this.phase = t < 2 ? 'reveal' : t < 5.5 ? 'recognition' : t < (red ? 17 : 14) ? (red ? 'engulf' : 'release') : 'resolution';
    this.fade = Math.max(1 - smooth(t, 0, 1.4), smooth(t, red ? 21 : 19, red ? 23 : 21));
    const progress = smooth(t, 0, 12), retreat = red ? smooth(t, 16, 22) : 0;
    const run = red ? smooth(t, 8.1, 10.9) : 0;
    if (red) {
      const camera = p.camera; camera.position.copy(this.path.getPointAt(progress)).add(V(run * .65 - retreat * 1.5, retreat * .6, retreat * 2));
      camera.lookAt(this.focus.clone().add(V(run * 1.15, 0, 0))); camera.fov = THREE.MathUtils.lerp(48, 52, progress); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      const dread = smooth(t, 2.5, 7), running = t >= 8.1 && t < 10.9;
      this._animate(t < 3 ? 'Idle' : t < 6 ? 'No' : t < 8.1 ? 'HitReact' : t < 10.9 ? 'Run' : t < 13 ? 'HitReact' : 'Death', t >= 10.9);
      p.group.position.set(run * 2.3, 0, 1.25 + run * .15);
      const turning = smooth(t, 7.4, 8.3) - smooth(t, 10.2, 11.5);
      p.group.rotation.y = Math.PI + turning * 1.5 + dread * .12 + (running ? Math.sin(t * 6) * .045 : 0);
      if (running && p.currentAction?.setEffectiveTimeScale) p.currentAction.setEffectiveTimeScale(.75 + .3 * Math.sin(Math.PI * run));
      this.scene.background.setHex(0x000000);
      this.ambient.intensity = .7 - dread * .45; this.light.color.lerpColors(new THREE.Color(0xffe7c7), new THREE.Color(0x8b2920), dread);
      const fire = smooth(t, 5, 10), ash = smooth(t, 15, 20);
      this.exposure = .9 - dread * .08;
      this.pendingFire = [t, fire, ash];
      if (t >= 6 && !this.gaspPlayed) { this.gaspPlayed = true; this.audio?.playSfx?.('./assets/audio/sfx/player/shaun-hurt-01.ogg', { category: 'voice', group: 'ending-gasp', volume: .65 }); }
      if (t >= 8 && !this.screamPlayed) {
        this.screamPlayed = true;
        const playback = this.audio?.playSfx?.('./assets/audio/sfx/player/red-ending-fire-scream.wav', { category: 'sfx', group: 'ending-ignition', volume: 1 });
        Promise.resolve(playback).then(source => { if (this.disposed) { try { source?.stop(); } catch {} } else this.ignitionSource = source; });
      }
      if (t >= 5 && t < 20 && t >= (this.nextCrackle ?? 0)) {
        this.nextCrackle = t + .48;
        this.audio?._playDesignedCue?.('ending-fire', { duration: .22, volume: .035 * fire, cutoffStart: 1200, cutoffEnd: 350, attack: .012, cooldown: .3 });
      }
    } else {
      const peace = smooth(t, 1, 8); this._updatePeace(t, peace, step);
    }
    p.mixer?.update(step);
    if (red) this._updateFire(...this.pendingFire); else if (t < 6) this._reliefPose(t);
    this.done = t >= (red ? 23.2 : 21.2);
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    if (this.renderRenderer && this.renderRenderer.getPixelRatio() === this.renderPixelRatio
      && this.graphicsRevision === this.renderRenderer._graphicsRevision) {
      this.renderRenderer.setPixelRatio(this.originalPixelRatio);
    }
    this._clearReliefPose();
    this.finalVoice?.dispose();
    this.presentation?.dispose(); this.light.shadow.dispose();
    for (const entry of this.actorShadowSettings ?? []) entry.node.receiveShadow = entry.receiveShadow;
    try { this.ignitionSource?.stop(); } catch {}
    const p = this.player, s = this.saved;
    s.parent?.add(p.group); p.group.position.copy(s.position); p.group.quaternion.copy(s.quaternion); p.group.scale.copy(s.scale);
    p.group.visible = s.visible; p.scriptedMovement = s.scripted; if (p.bodyMesh) { p.bodyMesh.visible = s.body; if (s.bodyScale) p.bodyMesh.scale.copy(s.bodyScale); }
    p.camera.fov = s.fov; p.camera.updateProjectionMatrix();
    for (const entry of this.dissolveOriginals || []) entry.node.material = entry.original;
    for (const material of this.dissolveMaterials || []) material.dispose();
    this.floor.geometry.dispose(); this.floor.material.dispose(); this.fireEffects?.dispose(); this.ashGeometry?.dispose(); this.ashMaterial?.dispose();
    this.sun?.shadow.dispose();
    for (const resource of this.roomResources ?? []) resource.dispose();
    const resources = new Set();
    for (const root of this.furniture) root.traverse(node => {
      if (node.geometry) resources.add(node.geometry);
      for (const m of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
        resources.add(m); for (const v of Object.values(m)) if (v?.isTexture) resources.add(v);
      }
    });
    for (const resource of resources) resource.dispose();
    this.scene.clear();
  }
}
export class GoodEndingCutscene extends EndingCutscene { constructor(player, assets, texture) { super(player, 'blue', assets, texture); } }
export class BadEndingCutscene extends EndingCutscene { constructor(player, assets, texture) { super(player, 'red', assets, texture); } }
