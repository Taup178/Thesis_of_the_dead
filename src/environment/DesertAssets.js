import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const DESERT_ASSET_ROOT = './assets/models/desert/';

export async function loadDesertAssets(onProgress) {
  const loader = new GLTFLoader();
  const names = ['desert_building', 'desert__rocks__stones__pack', 'desert_shrubs', 'desert'];
  let loaded = 0;
  const models = await Promise.all(names.map(async name => {
    const base = `${DESERT_ASSET_ROOT}${name}/`;
    const response = await fetch(`${base}scene.gltf`);
    if (!response.ok) throw new Error(`Desert asset unavailable: ${name}`);
    const json = await response.json();
    // The original desert pack uses the retired specular/glossiness extension.
    // Retain its supplied diffuse textures when loading with modern Three.js.
    for (const material of json.materials || []) {
      const legacy = material.extensions?.KHR_materials_pbrSpecularGlossiness;
      if (legacy) {
        material.pbrMetallicRoughness = { baseColorFactor: legacy.diffuseFactor || [1, 1, 1, 1],
          baseColorTexture: legacy.diffuseTexture, metallicFactor: 0, roughnessFactor: 0.95 };
        delete material.extensions.KHR_materials_pbrSpecularGlossiness;
      }
    }
    json.extensionsRequired = json.extensionsRequired?.filter(name => name !== 'KHR_materials_pbrSpecularGlossiness');
    json.extensionsUsed = json.extensionsUsed?.filter(name => name !== 'KHR_materials_pbrSpecularGlossiness');
    const gltf = await loader.parseAsync(JSON.stringify(json), base);
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = node.receiveShadow = true;
      for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
        mat.metalness = 0; mat.roughness = Math.max(mat.roughness, 0.85);
        if (mat.alphaTest > 0) { mat.alphaTest = 0.45; mat.side = THREE.DoubleSide; }
      }
    });
    onProgress?.(++loaded / names.length);
    return gltf.scene;
  }));
  return { building: models[0], rocks: models[1], shrubs: models[2], scenery: models[3] };
}

/** Extract each supplied prop with its original orientation, centered and grounded. */
export function extractDesertProps(scene) {
  const props = [];
  scene.updateMatrixWorld(true);
  scene.traverse(node => {
    if (!node.isMesh) return;
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox, center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -box.min.y, -center.z);
    const mesh = new THREE.Mesh(geometry, node.material);
    mesh.name = node.name;
    mesh.castShadow = mesh.receiveShadow = true;
    props.push(mesh);
  });
  return props;
}

export function createSandTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d'), data = ctx.createImageData(512, 512);
  let state = 92817;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const grain = (state / 4294967296 - 0.5) * 19;
    const ripple = Math.sin(y * Math.PI / 16 + Math.sin(x * Math.PI / 128) * 1.2) * 3;
    const offset = (y * 512 + x) * 4;
    data.data.set([190 + grain + ripple, 151 + grain + ripple, 98 + grain + ripple, 255], offset);
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(50, 50); texture.anisotropy = 4;
  return texture;
}
