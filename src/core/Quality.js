import * as THREE from 'three';
import { graphicsPreset, loadGraphics, normalizeGraphics, saveGraphics } from './GraphicsSettings.js';

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

export function qualityConfig(level, overrides = {}) {
  const settings = normalizeGraphics({ ...graphicsPreset(level), ...overrides, preset: level });
  return { ...settings,
    pixelRatioCap: level === 'ultra' ? 2 : level === 'high' ? 1.5 : 1,
    shadowType: settings.shadows === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap,
    shadowMapCap: { off: 0, low: 512, medium: 1024, high: 2048, ultra: 4096 }[settings.shadows],
    blur: settings.motionBlur,
  };
}

export const loadQuality = () => loadGraphics().preset;
export const saveQuality = level => { if (QUALITY_LEVELS.includes(level)) saveGraphics(graphicsPreset(level)); };

/** Apply real renderer, shadow and texture changes; all settings work live. */
export function applyQuality(renderer, scene, level, overrides = {}) {
  const config = qualityConfig(level, overrides);
  renderer._graphicsRevision = (renderer._graphicsRevision ?? 0) + 1;
  renderer._graphicsSettings = config;
  const shadows = config.shadows !== 'off';
  const lightingChanged = renderer.shadowMap.enabled !== shadows || renderer.shadowMap.type !== config.shadowType;
  renderer.setPixelRatio(Math.min(2.5, Math.min(window.devicePixelRatio || 1, config.pixelRatioCap) * config.renderScale));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = config.shadowType;
  renderer.shadowMap.needsUpdate = shadows;
  renderer.toneMappingExposure = config.brightness;
  const anisotropy = Math.min(config.textureFiltering, renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
  const textures = new Set();
  scene.traverse(object => {
    if (object.isLight && object.shadow && !shadows) {
      object.shadow.map?.dispose(); object.shadow.map = null;
      object.shadow.mapPass?.dispose(); object.shadow.mapPass = null;
    } else if (object.isLight && object.shadow) {
      const size = Math.min(config.shadowMapCap, object.isPointLight ? 1024 : 4096, renderer.capabilities?.maxTextureSize ?? 4096);
      if (size !== object.shadow.mapSize.x || lightingChanged) {
        object.shadow.mapSize.set(size, size);
        object.shadow.map?.dispose(); object.shadow.map = null;
        object.shadow.mapPass?.dispose(); object.shadow.mapPass = null;
        object.shadow.needsUpdate = true;
      }
    }
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of materials) {
      if (lightingChanged) material.needsUpdate = true;
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) {
    if (texture.anisotropy === anisotropy) continue;
    texture.anisotropy = anisotropy; texture.needsUpdate = true;
  }
  return config;
}
