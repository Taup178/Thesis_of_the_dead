import * as THREE from 'three';

/** Cover the portal and its steps with the game's existing circular obstacles. */
export function createPortalObstacles(root) {
  if (!root) return [];
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root, true);
  if (bounds.isEmpty()) return [];
  // Include the small visual pulse without rebuilding colliders every frame.
  bounds.expandByScalar(0.2);
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const alongX = size.x >= size.z;
  const radius = Math.max(0.25, Math.min(size.x, size.z) / 2);
  const length = Math.max(0, Math.max(size.x, size.z) - radius * 2);
  const steps = Math.ceil(length / radius);
  return Array.from({ length: steps + 1 }, (_, index) => {
    const offset = steps ? -length / 2 + length * index / steps : 0;
    return { x: center.x + (alongX ? offset : 0), z: center.z + (alongX ? 0 : offset), radius };
  });
}
