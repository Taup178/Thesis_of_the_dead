import * as THREE from 'three';

/** One supplied stone finish, with the same texture scale on every walkable surface. */
export class StoneFloors {
  constructor() {
    this.materials = new Set(); this.disposed = false;
    this.material = this.register(new THREE.MeshStandardMaterial({ color: 0xffffff,
      roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1), aoMapIntensity: 0.5479115422602233 }));
  }

  register(material) {
    this.materials.add(material);
    if (this.maps) this._apply(material);
    return material;
  }

  mapGeometry(geometry, x = 0, z = 0) {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv'), repeatSize = 2.8;
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const nx = Math.abs(normals.getX(vertex)), ny = Math.abs(normals.getY(vertex)), nz = Math.abs(normals.getZ(vertex));
      const wx = positions.getX(vertex) + x, wz = positions.getZ(vertex) + z, y = positions.getY(vertex);
      if (ny >= nx && ny >= nz) uv.setXY(vertex, wx / repeatSize, -wz / repeatSize);
      else uv.setXY(vertex, (nx > nz ? -wz : wx) / repeatSize, y / repeatSize);
    }
    return geometry;
  }

  async load() {
    const loader = new THREE.TextureLoader();
    const [color, surface, normal] = await Promise.all(['baseColor', 'metallicRoughness', 'normal'].map(name =>
      loader.loadAsync(`./assets/models/floor-material/textures/floortile1_${name}.png`)));
    if (this.disposed) { for (const texture of [color, surface, normal]) texture.dispose(); return; }
    for (const texture of [color, surface, normal]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.flipY = false; texture.anisotropy = 8; texture.needsUpdate = true;
    }
    color.colorSpace = THREE.SRGBColorSpace;
    this.maps = { map: color, roughnessMap: surface, aoMap: surface, normalMap: normal };
    for (const material of this.materials) this._apply(material);
  }

  _apply(material) { Object.assign(material, this.maps); material.needsUpdate = true; }
  dispose() { this.disposed = true; this.materials.clear(); }
}
