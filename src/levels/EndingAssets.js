import * as THREE from 'three';

export async function loadEndingTextures() {
  const loader = new THREE.TextureLoader();
  const entries = await Promise.all(Object.entries({
    fire: 'para-fire-02.png', smoke: 'kenney-smoke.png', window: 'kenney-window.png',
  }).map(async ([key, file]) => {
    try {
      const texture = await loader.loadAsync(`./assets/vfx/endings/${file}`);
      texture.colorSpace = key === 'fire' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      // Atlas mipmaps bleed neighbouring frames into one another at a distance.
      if (key === 'fire') { texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter; }
      return [key, texture];
    } catch (error) {
      console.warn(`Ending texture unavailable: ${file}; using procedural fallback.`, error);
      return [key, null];
    }
  }));
  return Object.fromEntries(entries);
}
