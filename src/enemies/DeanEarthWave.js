import * as THREE from 'three';

const ROWS = 9, COLUMNS = 3, COUNT = ROWS * COLUMNS;
const smooth = THREE.MathUtils.smoothstep;

/** A travelling rupture: planted stone slabs erupt in sequence, then settle into the earth. */
export class DeanEarthWave {
  constructor(root, rockMaterial, crackMaterial) {
    this.root = new THREE.Group(); this.root.name = 'DeanEarthRupture'; root.add(this.root);
    this.geometry = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const positions = this.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const taper = y > 0 ? 0.68 : 1;
      positions.setXYZ(i, x * taper + y * 0.15, y + (y > 0 ? x * 0.21 + z * 0.17 : 0), z * taper);
    }
    this.geometry.computeVertexNormals();
    this.crackGeometry = new THREE.PlaneGeometry(1, 1);
    this.dustGeometry = new THREE.PlaneGeometry(1, 1);
    const pixels = new Uint8Array(32 * 32 * 4);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const radius = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
      const index = (y * 32 + x) * 4;
      pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
      pixels[index + 3] = Math.round(180 * Math.max(0, 1 - radius) ** 2 * (0.8 + 0.2 * Math.sin(x * 2.3 + y * 1.7)));
    }
    this.dustTexture = new THREE.DataTexture(pixels, 32, 32); this.dustTexture.needsUpdate = true;
    this.dustMaterial = new THREE.MeshBasicMaterial({ color: 0xa89172, map: this.dustTexture,
      transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.object = new THREE.Object3D(); this.side = new THREE.Vector3();
    this.pool = Array.from({ length: 2 }, () => {
      const slabs = new THREE.InstancedMesh(this.geometry, rockMaterial, COUNT);
      const cracks = new THREE.InstancedMesh(this.crackGeometry, crackMaterial, COUNT);
      const dust = new THREE.InstancedMesh(this.dustGeometry, this.dustMaterial, COUNT * 2);
      const debris = new THREE.InstancedMesh(this.geometry, rockMaterial, COUNT * 2);
      for (const mesh of [slabs, cracks, dust, debris]) {
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        // Only a few small bounded batches; avoid rebuilding bounds during eruption.
        mesh.frustumCulled = false; mesh.visible = false; this.root.add(mesh);
      }
      slabs.receiveShadow = true;
      return { slabs, cracks, dust, debris, active: false, tiles: [], age: 0, hit: false };
    });
  }

  launch(origin, direction, enraged) {
    const wave = this.pool.find(wave => !wave.active) || this.pool.reduce((a, b) => a.age > b.age ? a : b);
    wave.active = true; wave.age = 0; wave.hit = false; wave.damage = enraged ? 23 : 18;
    wave.tiles.length = 0;
    this.side.set(-direction.z, 0, direction.x);
    for (let row = 0; row < ROWS; row++) for (let column = 0; column < COLUMNS; column++) {
      const index = row * COLUMNS + column;
      const offset = (column - 1) * (1.15 + row * 0.1);
      const distance = 1.6 + row * 1.7;
      const position = origin.clone().addScaledVector(direction, distance).addScaledVector(this.side, offset);
      position.y = 0;
      wave.tiles.push({ position, delay: row * (enraged ? 0.09 : 0.12) + Math.abs(column - 1) * 0.025,
        height: 1.25 + row * 0.1 + (column === 1 ? 0.45 : 0),
        yaw: Math.atan2(direction.x, direction.z) + Math.sin(index * 7.3) * 0.27,
        width: 0.95 + (column === 1 ? 0.15 : 0), depth: 1.05 + (index % 3) * 0.1 });
    }
    this._draw(wave, null);
    return wave;
  }

  update(dt, player) {
    for (const wave of this.pool) {
      if (!wave.active) continue;
      const last = wave.age; wave.age += dt;
      for (const tile of wave.tiles) {
        // The front keeps its original aim; players can evade sideways, jump, or roll through it.
        if (!wave.hit && !player.isDodging && player.group.position.y < 1.55
          && wave.age >= tile.delay + 0.04 && last <= tile.delay + 0.65
          && Math.hypot(player.group.position.x - tile.position.x, player.group.position.z - tile.position.z) < 1.05) {
          wave.hit = true; player.takeDamage(wave.damage, { type: 'blunt', source: tile.position });
        }
      }
      if (wave.age > 2.5) {
        wave.active = false; wave.slabs.visible = wave.cracks.visible = wave.dust.visible = wave.debris.visible = false;
      } else this._draw(wave, player.camera);
    }
  }

  _draw(wave, camera) {
    const object = this.object;
    wave.slabs.visible = wave.cracks.visible = wave.dust.visible = wave.debris.visible = true;
    wave.tiles.forEach((tile, index) => {
      const time = wave.age - tile.delay;
      const rise = smooth(time, 0, 0.13) * (1 - smooth(time, 0.72, 1.48));
      object.position.copy(tile.position); object.position.y = tile.height * (rise - 0.5) - 0.08;
      object.rotation.set(0, tile.yaw, Math.sin(index * 2) * 0.09 * rise);
      object.scale.set(tile.width, tile.height, tile.depth);
      // Fully hide underground geometry to avoid shadows or edges leaking through the ground.
      if (time <= 0 || time >= 1.48) object.scale.setScalar(0);
      object.updateMatrix(); wave.slabs.setMatrixAt(index, object.matrix);
      const crack = smooth(time, -0.16, 0.02) * (1 - smooth(time, 1.25, 1.9));
      object.position.copy(tile.position); object.position.y = 0.075;
      object.rotation.set(-Math.PI / 2, 0, -tile.yaw);
      object.scale.set(tile.width * 1.3 * crack, tile.depth * 1.6 * crack, 1);
      object.updateMatrix(); wave.cracks.setMatrixAt(index, object.matrix);
      for (let chip = 0; chip < 2; chip++) {
        const life = time - 0.07, visible = life > 0 && life < 0.95;
        const spread = 0.25 + Math.max(0, life) * 1.3;
        object.position.copy(tile.position);
        object.position.x += Math.sin(index * 5 + chip * 3) * spread;
        object.position.z += Math.cos(index * 5 + chip * 3) * spread;
        object.position.y = 0.3 + Math.max(0, life) * 1.5;
        if (camera) object.quaternion.copy(camera.quaternion); else object.rotation.set(0, 0, 0);
        object.scale.setScalar(visible ? (0.7 + life * 2.3) * (1 - smooth(life, 0.45, 0.95)) : 0);
        object.updateMatrix(); wave.dust.setMatrixAt(index * 2 + chip, object.matrix);
        object.position.copy(tile.position);
        object.position.x += Math.sin(index * 5 + chip * 3) * Math.max(0, life) * 2.1;
        object.position.z += Math.cos(index * 5 + chip * 3) * Math.max(0, life) * 2.1;
        object.position.y = 0.15 + life * (3.5 + (index % 3) * 0.5) - 5 * life * life;
        object.rotation.set(life * 5, tile.yaw + life * 3, life * 4);
        object.scale.setScalar(visible && object.position.y > 0 ? 0.12 + (index % 3) * 0.04 : 0);
        object.updateMatrix(); wave.debris.setMatrixAt(index * 2 + chip, object.matrix);
      }
    });
    wave.slabs.instanceMatrix.needsUpdate = wave.cracks.instanceMatrix.needsUpdate = wave.dust.instanceMatrix.needsUpdate = wave.debris.instanceMatrix.needsUpdate = true;
  }

  async prepare(renderer, scene, camera) {
    const wave = this.pool[0];
    for (const mesh of [wave.slabs, wave.cracks, wave.dust, wave.debris]) mesh.visible = true;
    try { await renderer?.compileAsync?.(scene, camera); }
    finally { this.clear(); }
  }

  clear() {
    for (const wave of this.pool) { wave.active = false; wave.slabs.visible = wave.cracks.visible = wave.dust.visible = wave.debris.visible = false; }
  }

  dispose() {
    this.clear(); this.root.removeFromParent();
    for (const wave of this.pool) { wave.slabs.dispose(); wave.cracks.dispose(); wave.dust.dispose(); wave.debris.dispose(); }
    for (const resource of [this.geometry, this.crackGeometry, this.dustGeometry, this.dustTexture, this.dustMaterial]) resource.dispose();
  }
}
