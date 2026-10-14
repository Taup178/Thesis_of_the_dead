import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** The supplied creature, sized and grounded once while Level 3 is loading. No combat AI. */
export async function loadTransformationMonster(root) {
  const gltf = await new GLTFLoader().loadAsync('./assets/models/monster/scene.gltf');
  return createTransformationMonster(root, gltf);
}

export function createTransformationMonster(root, gltf) {
  const group = new THREE.Group(); group.name = 'ViceChancellorReveal';
  const model = gltf.scene; group.add(model); root.add(group);
  const mixer = new THREE.AnimationMixer(model);
  // The combined source contains other actions after the first idle. Reveal only that idle.
  const idle = gltf.animations[0] && THREE.AnimationUtils.subclip(gltf.animations[0], 'MonsterRevealIdle', 0, 50, 30);
  if (idle) mixer.clipAction(idle).play();
  mixer.update(0); group.updateMatrixWorld(true);
  model.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = false; node.receiveShadow = true;
    if (node.isSkinnedMesh) node.computeBoundingBox();
  });
  const bounds = new THREE.Box3().setFromObject(model);
  const scale = 4.5 / Math.max(0.01, bounds.max.y - bounds.min.y);
  const center = bounds.getCenter(new THREE.Vector3());
  model.scale.multiplyScalar(scale);
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  group.visible = false;
  return { group, model, mixer, height: 4.5 };
}
