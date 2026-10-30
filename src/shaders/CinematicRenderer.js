import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { qualityConfig } from '../core/Quality.js';

export const CINEMATIC_RESOLUTION = {
  low: { width: 1280, height: 720, ratio: .75 },
  medium: { width: 1920, height: 1080, ratio: 1 },
  high: { width: 2560, height: 1440, ratio: 1.5 },
  ultra: { width: 3840, height: 2160, ratio: 2 },
};

/** Keep source texture detail and clean edges, without gameplay's heavy effects. */
export class CinematicRenderer {
  constructor(renderer) {
    this.renderer = renderer;
    this.prepared = new WeakMap(); this.size = new THREE.Vector2();
  }

  prepare(scene, quality = 'medium') {
    const renderer = this.renderer;
    const config = renderer._graphicsSettings ?? qualityConfig(quality);
    const revision = `${renderer._graphicsRevision ?? 0}:${quality}`;
    if (this.prepared.get(scene) === revision) return config;
    const anisotropy = Math.min(config.textureFiltering, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
    const textures = new Set();
    scene.traverse(node => {
      const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        for (const uniform of Object.values(material.uniforms ?? {})) if (uniform.value?.isTexture) textures.add(uniform.value);
      }
      if (node.isLight && node.castShadow && node.shadow && config.shadows !== 'off') {
        // A single 2K cinematic map gives crisp contact shadows without 4K's cost.
        const size = Math.min(config.shadowMapCap, 2048, renderer.capabilities?.maxTextureSize ?? 2048);
        if (node.shadow.mapSize.x !== size) {
          node.shadow.mapSize.set(size, size);
          node.shadow.map?.dispose(); node.shadow.map = null; node.shadow.needsUpdate = true;
        }
      }
    });
    for (const texture of textures) {
      if (texture.anisotropy === anisotropy) continue;
      texture.anisotropy = anisotropy; texture.needsUpdate = true;
    }
    this.prepared.set(scene, revision);
    return config;
  }

  render(scene, camera, quality = 'medium') {
    const renderer = this.renderer, config = this.prepare(scene, quality);
    if (!config.antiAliasing || !renderer.getContext) {
      renderer.render(scene, camera); return;
    }
    if (!this.composer) {
      this.composer = new EffectComposer(renderer);
      this.scenePass = new RenderPass(scene, camera);
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.scenePass);
      this.composer.addPass(new OutputPass());
      this.composer.addPass(this.fxaa);
    }
    this.scenePass.scene = scene; this.scenePass.camera = camera;
    renderer.getSize(this.size);
    const ratio = renderer.getPixelRatio();
    if (this.width !== this.size.x || this.height !== this.size.y || this.ratio !== ratio) {
      this.width = this.size.x; this.height = this.size.y; this.ratio = ratio;
      this.composer.setPixelRatio(ratio); this.composer.setSize(this.width, this.height);
      this.fxaa.uniforms.resolution.value.set(1 / Math.max(1, this.width * ratio), 1 / Math.max(1, this.height * ratio));
    }
    this.composer.render();
  }

  dispose() {
    if (!this.composer) return;
    for (const pass of this.composer.passes) pass.dispose?.();
    this.composer.dispose(); this.composer = null;
  }
}

/** Match the opening's diffuse furniture; avoid black metals or glowing bedding. */
export function prepareRoomFurniture(model) {
  model.traverse(node => {
    if (!node.isMesh) return;
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      material.emissive?.setHex(0); material.emissiveIntensity = 0;
      material.roughness = Math.max(.72, material.roughness ?? 1);
      material.metalness = 0;
      if (material.transmission) material.transmission = 0;
    }
  });
}
