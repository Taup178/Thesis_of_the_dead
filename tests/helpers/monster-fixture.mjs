import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createTransformationMonster } from '../../src/enemies/TransformationMonster.js';
import { TransformationDegreeCatch } from '../../src/props/TransformationDegreeCatch.js';
import { createDegreeScroll } from '../../src/props/DegreeScroll.js';

let asset;
export async function monsterFixture() {
  asset ??= (async () => {
    const source = new URL('../../public/assets/models/monster/scene.gltf', import.meta.url);
    const data = JSON.parse(await readFile(source, 'utf8'));
    data.buffers[0].uri = `data:application/octet-stream;base64,${(await readFile(new URL('scene.bin', source))).toString('base64')}`;
    data.materials = data.materials.map(() => ({})); delete data.images; delete data.textures;
    globalThis.ProgressEvent ??= class {};
    return new GLTFLoader().parseAsync(JSON.stringify(data), '');
  })();
  const loaded = await asset, root = new THREE.Group();
  const monster = createTransformationMonster(root, { scene: clone(loaded.scene), animations: loaded.animations });
  const scroll = createDegreeScroll(); root.add(scroll); scroll.scale.set(0.82, 0.78, 0.78);
  const degreeCatch = new TransformationDegreeCatch(root, monster, scroll, { scrollLaunch: 0.1, scrollCatch: 0.8 });
  degreeCatch.start(new THREE.Vector3());
  for (let i = 0; i < 200; i++) degreeCatch.update(i / 60, 1 / 60);
  monster.group.visible = true;
  const player = { group: new THREE.Group(), camera: new THREE.PerspectiveCamera(), alive: true,
    isDodging: false, health: 100, hits: [], takeDamage(damage) { this.hits.push(damage); } };
  player.group.position.set(0, 0, 14);
  return { root, monster, scroll, degreeCatch, player };
}
