import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WIDTH = 20, PANEL_SIZE = 2.5, BASE_Y = -11.75;
const SOURCE_WIDTH = 0.6, SOURCE_HEIGHT = 0.18506157398223877;

/** The supplied Spike Trap 01, tiled across the whole pit in small instanced batches. */
export class SpikeTrapPit {
  constructor(parent, backZ, frontZ) {
    this.root = new THREE.Group(); this.root.name = 'SpikePit'; parent.add(this.root);
    this.backZ = backZ; this.frontZ = frontZ; this.disposed = false;
    this.batches = [];
    this.columns = Math.ceil(WIDTH / PANEL_SIZE);
    this.rows = Math.ceil((frontZ - backZ) / PANEL_SIZE);
    this.count = this.columns * this.rows;
    this.tipY = BASE_Y + SOURCE_HEIGHT * PANEL_SIZE / SOURCE_WIDTH;
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync('./assets/models/spike-trap-01/scene.gltf');
    gltf.scene.updateMatrixWorld(true);
    let source; gltf.scene.traverse(node => { if (node.isMesh) source = node; });
    if (this.disposed) {
      source.geometry.dispose(); source.material.dispose();
      for (const texture of new Set(Object.values(source.material).filter(value => value?.isTexture))) texture.dispose();
      return;
    }
    const geometry = source.geometry, material = source.material;
    geometry.applyMatrix4(source.matrixWorld); geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -geometry.boundingBox.min.y, -center.z);
    const panelWidth = WIDTH / this.columns, panelDepth = (this.frontZ - this.backZ) / this.rows;
    const scaleY = panelWidth / size.x;
    this.tipY = BASE_Y + size.y * scaleY;
    // A trap panel is small and viewed from above the pit; avoid uploading three 4K maps for it.
    const resized = new Map();
    for (const texture of new Set(Object.values(material).filter(value => value?.isTexture))) {
      const original = texture.image;
      if (typeof document !== 'undefined' && Math.max(original.width, original.height) > 1024) {
        if (!resized.has(original)) {
          const canvas = document.createElement('canvas'), scale = 1024 / Math.max(original.width, original.height);
          canvas.width = Math.round(original.width * scale); canvas.height = Math.round(original.height * scale);
          canvas.getContext('2d').drawImage(original, 0, 0, canvas.width, canvas.height); resized.set(original, canvas);
        }
        texture.image = resized.get(original);
      }
      texture.anisotropy = 4; texture.needsUpdate = true;
    }
    const transform = new THREE.Object3D();
    // Batches let the renderer cull distant panels from the torch shadow maps.
    for (let startRow = 0; startRow < this.rows; startRow += 8) {
      const rowCount = Math.min(8, this.rows - startRow);
      const mesh = new THREE.InstancedMesh(geometry, material, this.columns * rowCount);
      mesh.name = 'SpikeTrap01'; mesh.castShadow = mesh.receiveShadow = true;
      for (let row = 0; row < rowCount; row++) for (let column = 0; column < this.columns; column++) {
        transform.position.set(-WIDTH / 2 + (column + 0.5) * panelWidth, BASE_Y,
          this.backZ + (startRow + row + 0.5) * panelDepth);
        transform.scale.set(panelWidth / size.x, scaleY, panelDepth / size.z);
        transform.updateMatrix(); mesh.setMatrixAt(row * this.columns + column, transform.matrix);
      }
      mesh.computeBoundingSphere(); this.root.add(mesh);
      this.batches.push({ mesh, minZ: this.backZ + startRow * panelDepth,
        maxZ: this.backZ + (startRow + rowCount) * panelDepth });
    }
  }

  updateView(cameraPosition) {
    // Most of the long pit is hidden under opaque decks. Keep nearby detail
    // for jumps and falls instead of drawing the entire pit through the floor.
    const range = cameraPosition.y < 0 ? 120 : 80;
    for (const batch of this.batches) batch.mesh.visible =
      cameraPosition.z >= batch.minZ - range && cameraPosition.z <= batch.maxZ + range;
  }

  dispose() { this.disposed = true; }
}
