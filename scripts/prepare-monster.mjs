import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

const source = new URL('../Zombie_Kit/monster/', import.meta.url);
const destination = new URL('../public/assets/models/monster/', import.meta.url);
await mkdir(new URL('textures/', destination), { recursive: true });
const asset = JSON.parse(await readFile(new URL('scene.gltf', source), 'utf8'));
// Convert the legacy Sketchfab material to the PBR workflow supported by our Three.js loader.
// Keep the original skin color, normal and occlusion textures; this creature is non-metallic.
for (const material of asset.materials) {
  const legacy = material.extensions?.KHR_materials_pbrSpecularGlossiness;
  if (!legacy) continue;
  material.pbrMetallicRoughness = { baseColorFactor: legacy.diffuseFactor,
    baseColorTexture: legacy.diffuseTexture, metallicFactor: 0, roughnessFactor: 0.78 };
  delete material.extensions.KHR_materials_pbrSpecularGlossiness;
  if (!Object.keys(material.extensions).length) delete material.extensions;
}
for (const key of ['extensionsUsed', 'extensionsRequired']) {
  if (asset[key]) asset[key] = asset[key].filter(name => name !== 'KHR_materials_pbrSpecularGlossiness');
  if (asset[key]?.length === 0) delete asset[key];
}
// Copy all referenced images so the original glTF texture indices remain valid.
for (const file of ['scene.bin', 'license.txt', ...asset.images.map(image => image.uri)]) {
  await copyFile(new URL(file, source), new URL(file, destination));
}
await writeFile(new URL('scene.gltf', destination), JSON.stringify(asset));
await writeFile(new URL('SOURCES.md', destination), `# Monster\n\nThis work is based on "Monster" (https://sketchfab.com/3d-models/monster-4cb82518b83e4176a4b131273b6294c5) by DJMaesen (https://sketchfab.com/bumstrum), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).\n\nSupplied in Zombie_Kit/monster. The served material was converted from legacy specular/glossiness to non-metallic PBR. The original mesh, rig, animation, textures and license are preserved.\n`);
console.log('Prepared the supplied Monster model and attribution.');
