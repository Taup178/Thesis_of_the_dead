import * as THREE from 'three';

export const QUALITY_LEVELS = ['low', 'medium', 'high'];
const STORAGE_KEY = 'thesis-of-the-dead:quality';
// Medium keeps the initial frame budget suitable for integrated lab GPUs.
const DEFAULT_QUALITY = 'medium';

export function qualityConfig(level) {
  switch (level) {
    case 'low':
      return { pixelRatioCap: 0.75, shadowType: THREE.PCFShadowMap, shadowMapCap: 512, blur: false };
    case 'medium':
      return { pixelRatioCap: 1, shadowType: THREE.PCFSoftShadowMap, shadowMapCap: 1024, blur: false };
    default:
      return { pixelRatioCap: 2, shadowType: THREE.VSMShadowMap, shadowMapCap: 2048, blur: true };
  }
}

export function loadQuality() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return QUALITY_LEVELS.includes(saved) ? saved : DEFAULT_QUALITY;
  } catch {
    return DEFAULT_QUALITY;
  }
}

export function saveQuality(level) {
  if (!QUALITY_LEVELS.includes(level)) return;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, level); } catch { /* private mode etc. */ }
}

// Live-applies a preset. Lights loaded after this call (level loads) are re-capped
// by calling this again once the level is in the scene.
export function applyQuality(renderer, scene, level) {
  const config = qualityConfig(level);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, config.pixelRatioCap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.type = config.shadowType;
  renderer.shadowMap.needsUpdate = true;
  scene.traverse(object => {
    if (object.isLight && object.shadow) {
      // Retain the authored size so switching from Medium back to High can
      // restore the larger map rather than staying permanently capped.
      object.shadow._qualityBaseMapSize ??= object.shadow.mapSize.x;
      const size = Math.min(object.shadow._qualityBaseMapSize, config.shadowMapCap);
      if (size !== object.shadow.mapSize.x) {
        object.shadow.mapSize.set(size, size);
        object.shadow.map?.dispose();
        object.shadow.map = null;
      }
    }
    const material = object.material;
    if (Array.isArray(material)) material.forEach(entry => { entry.needsUpdate = true; });
    else if (material) material.needsUpdate = true;
  });
  return config;
}
