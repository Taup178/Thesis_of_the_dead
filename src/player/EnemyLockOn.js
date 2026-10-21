import * as THREE from 'three';

const heads = new WeakMap();
const position = new THREE.Vector3(), forward = new THREE.Vector3(), direction = new THREE.Vector3();

function visible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function descriptor(object, height) {
  if (!heads.has(object)) {
    let head = null;
    object.traverse(node => { if (!head && node.isBone && /^head(?:_|$)/i.test(node.name)) head = node; });
    heads.set(object, head);
  }
  return { object, height, head: heads.get(object) };
}

/** All active hostile actors; guides and unreleased ambush enemies are excluded. */
export function getEnemyLockTargets(level) {
  const targets = [], seen = new Set();
  for (const enemy of level.zombies ?? []) {
    if (!enemy.alive || !enemy.group || !visible(enemy.group) || seen.has(enemy.group)) continue;
    seen.add(enemy.group); targets.push(descriptor(enemy.group, 1.15));
  }
  const boss = level.getLockOnTarget?.();
  if (boss?.object && visible(boss.object) && !seen.has(boss.object)) targets.push(descriptor(boss.object, boss.height));
  return targets;
}

export function selectEnemyLockTarget(targets, player, includeBehind = false) {
  player.camera.getWorldDirection(forward);
  let best = null, bestScore = Infinity;
  for (const target of targets) {
    target.object.getWorldPosition(position); position.y += target.height;
    direction.subVectors(position, player.camera.position);
    const distance = direction.length(), facing = direction.normalize().dot(forward);
    if (!includeBehind && facing < 0.2) continue;
    const score = (1 - facing) * 12 + distance * 0.1;
    if (score < bestScore) { best = target; bestScore = score; }
  }
  return best;
}

export function getEnemyPinPosition(target, out) {
  if (target.head) { target.head.getWorldPosition(out); out.y += 0.4; }
  else { target.object.getWorldPosition(out); out.y += target.height + 0.9; }
  return out;
}
