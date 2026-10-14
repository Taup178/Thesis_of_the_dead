import * as THREE from 'three';
import { TransformationDust } from '../props/TransformationDust.js';

const smooth = THREE.MathUtils.smoothstep;

/** Death, unnatural revival, swelling, a concealing dust blast, then a held creature reveal. */
export class DeanTransformation {
  constructor(root, dean, monster, scroll = null, dustColor = undefined) {
    this.dean = dean; this.monster = monster; this.scroll = scroll;
    const death = dean.actions?.Death;
    const fallEnd = (death?.getClip().duration ?? 1.3) + 0.55;
    this.timing = { fallEnd, wakeEnd: fallEnd + 1.9, swellStart: fallEnd + 2.05,
      burst: fallEnd + 4.2, swap: fallEnd + 4.65, clearStart: fallEnd + 6.4,
      clearEnd: fallEnd + 12.9, end: fallEnd + 14.4 };
    this.time = 0; this.started = false; this.done = false; this.swapped = false; this.disposed = false;
    this.dust = new TransformationDust(root, dustColor, monster.height);
    this.scale = dean.group.scale.clone();
    this.bones = ['Torso', 'Abdomen', 'Neck', 'Head'].map(name => {
      const node = dean.group.getObjectByName(name);
      return node && { node, scale: node.scale.clone() };
    }).filter(Boolean);
    this.origin = new THREE.Vector3(); this.cameraPosition = new THREE.Vector3();
    this.monsterObstacle = { x: 0, z: 0, radius: 1.2 };
    this.cameraAim = new THREE.Vector3(); this.startPosition = new THREE.Vector3();
    this.startRotation = new THREE.Quaternion(); this.aimRotation = new THREE.Quaternion();
    this.cameraDirection = new THREE.Vector3(); this.swellScale = new THREE.Vector3();
    this.monsterMeshes = []; monster.group.traverse(node => { if (node.isMesh) this.monsterMeshes.push(node); });
    this.materials = [];
    for (const [group, actor] of [[dean.group, 'dean'], [monster.group, 'monster']]) group.traverse(node => {
      if (!node.isSkinnedMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        this.materials.push({ material, actor, transparent: material.transparent, opacity: material.opacity,
          depthWrite: material.depthWrite, forceSinglePass: material.forceSinglePass });
        material.transparent = true; material.opacity = actor === 'monster' ? 0 : 1;
        material.forceSinglePass = true;
        material.needsUpdate = true;
      }
    });
  }

  prepareAudio(context) { this.sound = new TransformationSound(context, this.timing); }

  async prepare(renderer, scene, camera) {
    // Compile and upload both skins and the instanced dust shader behind the loading screen.
    this.monster.group.visible = true; this.dust.root.visible = true;
    this.monster.group.traverse(node => { if (node.isMesh) node.castShadow = true; });
    try {
      await renderer?.compileAsync?.(scene, camera);
      renderer?.initTexture?.(this.dust.noiseTexture);
      this.monster.group.traverse(node => {
        if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const value of Object.values(material)) if (value?.isTexture) renderer?.initTexture?.(value);
        }
      });
    } finally { this.monster.group.visible = false; this.dust.root.visible = false; }
  }

  start(camera) {
    if (this.started) return;
    this.started = true;
    // The killing shot's combat flash must not tint the revival or swelling pose.
    this.dean.group.traverse(node => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        material.emissive?.setHex(0); if ('emissiveIntensity' in material) material.emissiveIntensity = 0;
      }
    });
    this.origin.copy(this.dean.group.position); this.origin.y = 0;
    this.dean.group.position.copy(this.origin);
    this.monster.group.position.copy(this.origin); this.monster.group.quaternion.copy(this.dean.group.quaternion);
    this.monsterObstacle.x = this.origin.x; this.monsterObstacle.z = this.origin.z;
    if (camera) { this.startPosition.copy(camera.position); this.startRotation.copy(camera.quaternion); }
    const yaw = this.dean.group.rotation.y;
    this.cameraPosition.set(6.2, 2.8, 9.4).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(this.origin);
    this.cameraDirection.copy(this.cameraPosition).sub(this.origin).setY(0).normalize();
  }

  update(dt, camera, volume = 0.7) {
    if (!this.started || this.disposed) return;
    if (this.done) { this.monster.mixer?.update(dt); return; } // Hold the reveal with breathing, without starting another encounter.
    this.time = Math.min(this.timing.end, this.time + dt);
    const t = this.time, timing = this.timing, death = this.dean.actions?.Death;
    if (t < timing.fallEnd) {
      this.dean.mixer?.update(dt);
    } else if (t < timing.wakeEnd) {
      if (death) {
        if (!this.waking) { this.dean._playAction?.('Death', 0, true); this.waking = true; }
        // Reverse the complete native fall with eased motion, preserving the grounded pose.
        death.paused = true; death.enabled = true;
        death.time = death.getClip().duration * (1 - smooth(t, timing.fallEnd, timing.wakeEnd));
        this.dean.mixer?.update(0);
      }
    } else if (t < timing.swap) {
      if (!this.standing) { this.dean._playAction?.('Idle', 0.22, true); this.standing = true; }
      for (const saved of this.bones) saved.node.scale.copy(saved.scale);
      this.dean.mixer?.update(dt);
      const swelling = smooth(t, timing.swellStart, timing.burst);
      const breath = Math.sin((t - timing.swellStart) * 7) * 0.018 * swelling * (1 - swelling);
      this.swellScale.set(1 + swelling * 0.3 + breath, 1 + swelling * 0.08, 1 + swelling * 0.32 + breath);
      this.dean.group.scale.copy(this.scale).multiply(this.swellScale);
      for (const saved of this.bones) {
        const belly = saved.node.name === 'Abdomen';
        if (saved.node.name === 'Head') continue;
        if (saved.node.name === 'Neck') {
          // Keep the face recognizable while the belly and chest distend around it.
          saved.node.scale.copy(saved.scale).divide(this.swellScale.set((1 + swelling * 0.32) * (1 + swelling * 0.18), 1,
            (1 + swelling * 0.38) * (1 + swelling * 0.2)));
        } else {
          saved.node.scale.copy(saved.scale).multiply(this.swellScale.set(1 + swelling * (belly ? 0.32 : 0.18), 1,
            1 + swelling * (belly ? 0.38 : 0.2)));
        }
      }
    }
    // Keep the camera's planned movement independent of breathing or dust particles.
    if (camera) {
      const pullback = smooth(t, timing.swellStart, timing.burst) * 1.25;
      this.cameraAim.copy(this.origin); this.cameraAim.y += THREE.MathUtils.lerp(1.35, 2.4, smooth(t, timing.swellStart, timing.clearStart));
      const blend = smooth(t, 0, 0.8);
      camera.position.lerpVectors(this.startPosition, this.cameraPosition, blend);
      const revealDolly = smooth(t, timing.clearStart + 0.8, timing.end) * 3.3;
      camera.position.addScaledVector(this.cameraDirection, pullback - revealDolly);
      camera.lookAt(this.cameraAim); this.aimRotation.copy(camera.quaternion);
      camera.quaternion.slerpQuaternions(this.startRotation, this.aimRotation, blend);
      camera.updateMatrixWorld(true);
    }
    const clearing = smooth(t, timing.clearStart, timing.clearEnd);
    this.dust.update(t - timing.burst, this.origin, camera, clearing);
    if (!this.swapped && t >= timing.swap && this.dust.coverage > 0.99) {
      this.dean.group.visible = false; if (this.scroll) this.scroll.visible = false;
      this.monster.group.visible = true; this.swapped = true;
    }
    // The dust itself conceals the switch and reveals a solid creature as it thins.
    const deanOpacity = 1;
    const monsterOpacity = this.swapped ? 1 : 0;
    for (const saved of this.materials) {
      saved.material.opacity = saved.actor === 'dean' ? deanOpacity : monsterOpacity;
      saved.material.depthWrite = saved.material.opacity >= 0.99;
    }
    if (this.swapped) for (const mesh of this.monsterMeshes) mesh.castShadow = clearing > 0.6;
    if (this.swapped) this.monster.mixer?.update(dt);
    this.sound?.update(t, volume);
    this.done = t >= timing.end;
    if (this.done) this.sound?.stop();
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.sound?.stop(); this.dust.dispose();
    this.dean.group.scale.copy(this.scale);
    for (const saved of this.bones) saved.node.scale.copy(saved.scale);
    for (const saved of this.materials) {
      saved.material.transparent = saved.transparent; saved.material.opacity = saved.opacity;
      saved.material.depthWrite = saved.depthWrite; saved.material.forceSinglePass = saved.forceSinglePass;
      saved.material.needsUpdate = true;
    }
  }
}

/** Cached, quiet pressure and dirt sounds; no noise buffers are generated during playback. */
class TransformationSound {
  constructor(context, timing) {
    this.context = context; this.timing = timing; this.voices = new Map();
    if (!context?.createBuffer) return;
    this.buffers = [timing.burst - timing.swellStart, timing.clearEnd - timing.burst].map((duration, kind) => {
      const buffer = context.createBuffer(1, Math.ceil(duration * context.sampleRate), context.sampleRate);
      const data = buffer.getChannelData(0); let brown = 0, seed = 39417 + kind;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = seed / 2147483648 - 1, t = i / context.sampleRate;
        brown = (brown + noise * 0.045) / 1.045;
        const envelope = kind ? Math.exp(-t * 1.4) * smooth(t, 0, 0.018)
          : smooth(t, 0, duration * 0.7) * (1 - smooth(t, duration - 0.08, duration));
        data[i] = kind ? (brown * 1.7 + noise * 0.12 + Math.sin(t * Math.PI * 2 * 46) * Math.exp(-t * 12) * 0.5) * envelope
          : (brown * 0.7 + Math.sin(t * Math.PI * 2 * 39) * 0.1) * envelope;
      }
      return buffer;
    });
  }
  update(time, volume) {
    const context = this.context;
    if (context?.state !== 'running' || !this.buffers) return;
    const starts = [this.timing.swellStart, this.timing.burst];
    this.buffers.forEach((buffer, index) => {
      const offset = time - starts[index];
      if (offset < 0 || offset >= buffer.duration) return;
      if (!this.voices.has(index)) {
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = buffer; source.connect(gain); gain.connect(context.destination);
        this.voices.set(index, { source, gain });
        source.onended = () => { source.disconnect(); gain.disconnect(); };
        source.start(context.currentTime, offset);
      }
      this.voices.get(index).gain.gain.setValueAtTime(THREE.MathUtils.clamp(volume, 0, 1) * (index ? 0.28 : 0.16), context.currentTime);
    });
  }
  stop() {
    for (const { source } of this.voices.values()) { try { source.stop(); } catch {} }
    this.voices.clear();
  }
}
