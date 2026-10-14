import * as THREE from 'three';

/** Continuous dark skull masonry using the supplied tileable PBR maps. */
export class SkullWalls {
  constructor(root, backZ, frontZ) {
    this.root = root; this.backZ = backZ; this.disposed = false;
    this.material = new THREE.MeshStandardMaterial({ color: 0x625d55, roughness: 0.94,
      metalness: 0, normalScale: new THREE.Vector2(1.2, -1.2), aoMapIntensity: 1 });
    const length = frontZ - backZ, center = (backZ + frontZ) / 2;
    // The inner surface stays at x +/-10, flush with the torch mounting plates.
    for (const x of [-10.325, 10.325]) this._wall(new THREE.BoxGeometry(0.65, 27, length), x, 1.5, center);
    for (const z of [backZ, frontZ]) this._wall(new THREE.BoxGeometry(20, 27, 0.65), 0, 1.5, z);
  }

  _wall(geometry, x, y, z) {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv'), tileSize = 3.2;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const wx = positions.getX(vertex) + x, wy = positions.getY(vertex) + y, wz = positions.getZ(vertex) + z;
      if (Math.abs(normals.getY(vertex)) > 0.5) uv.setXY(vertex, (wx + 10) / tileSize, (wz - this.backZ) / tileSize);
      else uv.setXY(vertex, (Math.abs(normals.getX(vertex)) > 0.5 ? wz - this.backZ : wx + 10) / tileSize, (wy + 12) / tileSize);
    }
    const mesh = new THREE.Mesh(geometry, this.material); mesh.name = 'SkullWall';
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; this.root.add(mesh);
  }

  async load() {
    const loader = new THREE.TextureLoader();
    const [color, surface, normal] = await Promise.all(['baseColor', 'metallicRoughness', 'normal'].map(name =>
      loader.loadAsync(`./assets/models/skull-wall/textures/Material_${name}.png`)));
    if (this.disposed) { for (const texture of [color, surface, normal]) texture.dispose(); return; }
    for (const texture of [color, surface, normal]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      // The supplied maps use the glTF image convention; keep the skulls upright.
      texture.flipY = false; texture.anisotropy = 4; texture.needsUpdate = true;
    }
    color.colorSpace = THREE.SRGBColorSpace;
    this.material.map = color; this.material.normalMap = normal;
    this.material.roughnessMap = surface; this.material.aoMap = surface;
    this.material.needsUpdate = true;
  }

  dispose() { this.disposed = true; }
}
