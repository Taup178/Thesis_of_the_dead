import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CinematicRenderer, CINEMATIC_RESOLUTION, prepareRoomFurniture } from '../src/shaders/CinematicRenderer.js';
import { graphicsPreset } from '../src/core/GraphicsSettings.js';

test('isolated cinematic scenes receive the selected texture filtering and crisp shadow maps', () => {
  const map = new THREE.Texture(), normalMap = new THREE.Texture();
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial({ map, normalMap });
  const scene = new THREE.Scene(); scene.add(new THREE.Mesh(geometry, material));
  const light = new THREE.SpotLight(); light.castShadow = true; scene.add(light);
  const renderer = { _graphicsRevision: 1, _graphicsSettings: { ...graphicsPreset('high'), shadowMapCap: 2048 },
    capabilities: { getMaxAnisotropy: () => 8 } };
  const presentation = new CinematicRenderer(renderer);
  presentation.prepare(scene, 'high');
  assert.equal(map.anisotropy, 8); assert.equal(normalMap.anisotropy, 8);
  assert.equal(light.shadow.mapSize.x, 2048);
  const version = map.version; presentation.prepare(scene, 'high');
  assert.equal(map.version, version, 'unchanged frames do not re-upload textures');
  renderer._graphicsRevision++; renderer._graphicsSettings.textureFiltering = 2;
  presentation.prepare(scene, 'high'); assert.equal(map.anisotropy, 2);
  map.dispose(); normalMap.dispose(); geometry.dispose(); material.dispose();
});

test('furniture retains its texture and normal detail without glowing or black metallic surfaces', () => {
  const map = new THREE.Texture(), normalMap = new THREE.Texture();
  const material = new THREE.MeshPhysicalMaterial({ map, normalMap, metalness: 1, roughness: .1,
    emissive: 0xffffff, emissiveIntensity: 5, transmission: 1 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  prepareRoomFurniture(mesh);
  assert.equal(material.map, map); assert.equal(material.normalMap, normalMap);
  assert.equal(material.metalness, 0); assert.equal(material.emissiveIntensity, 0);
  assert.equal(material.transmission, 0); assert.ok(material.roughness >= .72);
  mesh.geometry.dispose(); material.dispose(); map.dispose(); normalMap.dispose();
});

test('cinematic anti-aliasing renders clean edges at the actual resolution and respects Off', () => {
  let direct = 0, composited = 0, ratio = 1;
  const renderer = { getContext() {}, getSize: target => target.set(1920, 1080), getPixelRatio: () => ratio,
    _graphicsRevision: 1, _graphicsSettings: graphicsPreset('high'), render() { direct++; } };
  const presentation = new CinematicRenderer(renderer);
  presentation.scenePass = {};
  presentation.fxaa = { uniforms: { resolution: { value: new THREE.Vector2() } } };
  presentation.composer = { setPixelRatio() {}, setSize() {}, render() { composited++; } };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  presentation.render(scene, camera, 'high');
  assert.equal(composited, 1); assert.equal(direct, 0);
  assert.equal(presentation.fxaa.uniforms.resolution.value.x, 1 / 1920);
  ratio = 1.5; presentation.render(scene, camera, 'high');
  assert.equal(presentation.fxaa.uniforms.resolution.value.x, 1 / 2880);
  renderer._graphicsSettings.antiAliasing = false; renderer._graphicsRevision++;
  presentation.render(scene, camera, 'high'); assert.equal(direct, 1);
  assert.equal(CINEMATIC_RESOLUTION.medium.height, 1080);
  assert.equal(CINEMATIC_RESOLUTION.ultra.height, 2160);
});
