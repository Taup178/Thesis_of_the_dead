import * as THREE from 'three';

/** Small overlapping body colliders preserve access to the paper at the fingertips. */
export function createMonsterCorpseObstacles(monster) {
  const find = pattern => { let bone; monster.group.traverse(node => { if (!bone && node.isBone && pattern.test(node.name)) bone = node; }); return bone; };
  const result = [];
  const segment = (a, b, radius) => {
    if (!a || !b) return;
    const start = a.getWorldPosition(new THREE.Vector3()), end = b.getWorldPosition(new THREE.Vector3());
    const count = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / (radius * 0.8)));
    for (let i = 0; i <= count; i++) {
      const point = start.clone().lerp(end, i / count);
      result.push({ x: point.x, z: point.z, radius, corpse: true });
    }
  };
  const hips = find(/^hips_/), chest = find(/^chest_/), head = find(/^head_/);
  segment(hips, chest, 0.7); segment(chest, head, 0.6);
  for (const side of ['L', 'R']) {
    const bone = part => find(new RegExp(`^${side}_${part}_\\d+`));
    segment(bone('leg'), bone('knee'), 0.36); segment(bone('knee'), bone('ankle'), 0.3);
    segment(bone('arm'), bone('elbow'), 0.3); segment(bone('elbow'), bone('wrist'), 0.29);
    segment(bone('wrist'), bone('wrist'), 0.34);
  }
  return result;
}
