import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
globalThis.ProgressEvent ??= class { constructor(type, props) { Object.assign(this, props); } };
const asset = JSON.parse(fs.readFileSync('Zombie_Kit/monster/scene.gltf'));
asset.buffers[0].uri = `data:application/octet-stream;base64,${fs.readFileSync('Zombie_Kit/monster/scene.bin').toString('base64')}`;
asset.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }];
delete asset.extensionsUsed;
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(asset), '');
const mixer = new THREE.AnimationMixer(gltf.scene); const action = mixer.clipAction(gltf.animations[0]); action.play();
const pos = name => gltf.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(1));
for (const time of [0, 0.5, 1, 1.5, 2, 3, 5, 10, 17]) {
  mixer.setTime(time); gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(node => { if (node.isSkinnedMesh) node.computeBoundingBox(); });
  const box = new THREE.Box3().setFromObject(gltf.scene);
  console.log({ time, box: [box.min.toArray(), box.max.toArray()], head: pos('head_062'), eye: pos('L_eye_063'), hip: pos('hips_01') });
}
const dean = JSON.parse(fs.readFileSync('public/assets/models/zombies/Zombie_Arm.gltf'));
console.log('Dean animation times', dean.animations.filter(a => ['Death', 'Idle'].includes(a.name)).map(a => ({ name: a.name, time: dean.accessors[a.samplers[0].input].max })));
