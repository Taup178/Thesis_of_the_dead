import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWoodsLayout, woodsClearance, extractNatureVariants, StylizedWoods, WOODS_ASSETS } from '../src/environment/StylizedWoods.js';

globalThis.ProgressEvent ??= class { constructor(type, values) { this.type = type; Object.assign(this, values); } };
const assetRoot = new URL('../public/assets/models/stylized-nature/', import.meta.url);

async function readModel(name) {
  const bytes = readFileSync(new URL(`${name}.glb`, assetRoot));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  const binary = bytes.subarray(28 + length);
  json.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`;
  json.materials = json.materials.map(() => ({ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  return new GLTFLoader().parseAsync(JSON.stringify(json), '');
}

test('downloaded pack contains valid embedded GLBs and its runtime plants are grounded upright', async () => {
  assert.equal(readdirSync(assetRoot).filter(name => name.endsWith('.glb')).length, 12);
  for (const name of WOODS_ASSETS) {
    const model = await readModel(name), variants = extractNatureVariants(model.scene);
    assert.ok(variants.length >= 2, name);
    for (const variant of variants) {
      const bounds = new THREE.Box3();
      for (const part of variant.parts) bounds.union(part.geometry.boundingBox);
      assert.ok(Math.abs(bounds.min.y) < 0.0001, `${variant.name} rests on the ground`);
      assert.ok(Math.abs(bounds.max.y - 1) < 0.0001, `${variant.name} has normalized height`);
      assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 0.0001, `${variant.name} has no gallery offset`);
      for (const part of variant.parts) part.geometry.dispose();
    }
    model.scene.traverse(mesh => { if (mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); } });
  }
});

test('forest preserves routes to every credit, the wake-up clearing, and both portals', () => {
  for (let seed = 0; seed < 12; seed++) {
    const credits = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos(i * Math.PI / 4) * (10 + (seed * 7 + i * 3) % 25),
      z: Math.sin(i * Math.PI / 4) * (10 + (seed * 7 + i * 3) % 25) }));
    const layout = createWoodsLayout(credits);
    assert.ok(layout.placements.length > 1000);
    for (const obstacle of layout.obstacles) {
      assert.ok(woodsClearance(obstacle.x, obstacle.z, credits) > obstacle.radius,
        'No obstacle intrudes on a path or objective clearing');
    }
    assert.deepEqual(createWoodsLayout(credits), layout, 'Scenery layout is repeatable');
  }
});

test('woods disposal releases shared assets once and removes the instanced scenery', () => {
  const scene = new THREE.Scene(), woods = new StylizedWoods(scene, []);
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, 2);
  woods.root.add(mesh); woods.resources.add(geometry); woods.resources.add(material);
  let geometryDisposals = 0, materialDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  woods.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
  assert.equal(woods.resources.size, 0);
});
