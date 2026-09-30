import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

/** Keep the kit's geometry and UVs; split it into wall/roof pieces for collapse. */
export function createHouseFragments(template) {
  const source = template.geometry.index ? template.geometry.toNonIndexed() : template.geometry.clone();
  const names = ['position', 'normal', 'uv', 'uv1'].filter(name => source.hasAttribute(name));
  const triangles = [];
  for (let i = 0; i < source.getAttribute('position').count; i += 3) {
    triangles.push(Array.from({ length: 3 }, (_, k) => Object.fromEntries(names.map(name => {
      const attribute = source.getAttribute(name), start = (i + k) * attribute.itemSize;
      return [name, Array.from(attribute.array.slice(start, start + attribute.itemSize))];
    }))));
  }
  // Clip across actual break planes. Assigning whole triangles to a sector leaves
  // long spikes on large source triangles when a wall starts moving.
  const clip = (vertices, normal, offset) => {
    const result = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const distance = vertex => normal[0] * vertex.position[0] + normal[1] * vertex.position[1] + normal[2] * vertex.position[2] + offset;
      const da = distance(a), db = distance(b);
      if (da >= -1e-7) result.push(a);
      if ((da > 1e-7 && db < -1e-7) || (da < -1e-7 && db > 1e-7)) {
        const t = da / (da - db);
        result.push(Object.fromEntries(names.map(name => [name, a[name].map((value, k) => value + (b[name][k] - value) * t)])));
      }
    }
    return result;
  };
  const fragments = [];
  for (let sector = 0; sector < 12; sector++) for (let layer = 0; layer < 4; layer++) {
    const startAngle = -Math.PI + sector * Math.PI / 6, endAngle = startAngle + Math.PI / 6;
    const low = layer * 1.1, high = layer === 3 ? 6 : low + 1.1;
    const planes = [[[-Math.sin(startAngle), 0, Math.cos(startAngle)], 0],
      [[Math.sin(endAngle), 0, -Math.cos(endAngle)], 0], [[0, 1, 0], -low], [[0, -1, 0], high]];
    const values = Object.fromEntries(names.map(name => [name, []]));
    for (const triangle of triangles) {
      if (triangle.every(v => v.position[1] < low) || triangle.every(v => v.position[1] > high)) continue;
      let polygon = triangle;
      for (const [normal, offset] of planes) { polygon = clip(polygon, normal, offset); if (polygon.length < 3) break; }
      for (let k = 1; k < polygon.length - 1; k++) {
        for (const vertex of [polygon[0], polygon[k], polygon[k + 1]]) {
          for (const name of names) values[name].push(...vertex[name]);
        }
      }
    }
    if (!values.position.length) continue;
    const geometry = new THREE.BufferGeometry();
    for (const name of names) {
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(values[name], source.getAttribute(name).itemSize));
    }
    geometry.normalizeNormals();
    geometry.computeBoundingBox();
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    fragments.push({ geometry, center });
  }
  source.dispose();
  return fragments;
}

export function createHouseEffectTextures() {
  const dust = document.createElement('canvas'); dust.width = dust.height = 64;
  const ctx = dust.getContext('2d'), gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,0.7)'); gradient.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  const cracks = document.createElement('canvas'); cracks.width = cracks.height = 256;
  const pen = cracks.getContext('2d');
  pen.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.4, length = 45 + (i * 19) % 65;
    for (const [color, width] of [['rgba(64,38,18,0.4)', 5], ['rgba(42,23,10,0.9)', 2]]) {
      pen.strokeStyle = color; pen.lineWidth = width; pen.beginPath(); pen.moveTo(128, 128);
      for (let j = 1; j <= 6; j++) {
        const turn = angle + Math.sin(j * 7 + i) * 0.3;
        pen.lineTo(128 + Math.cos(turn) * length * j / 6, 128 + Math.sin(turn) * length * j / 6);
      }
      pen.stroke();
    }
  }
  return { dust: new THREE.CanvasTexture(dust), cracks: new THREE.CanvasTexture(cracks) };
}

export class MudHouse {
  constructor(root, fragments, material, position, index, textures) {
    this.maxHealth = 100; this.health = 100; this.alive = true;
    this.damageStage = 0; this.hitTime = 0; this.destroyTime = 0;
    this.index = index; this.textures = textures;
    this.root = new THREE.Group(); this.root.name = `MudHouse_${index + 1}`;
    this.root.position.copy(position); root.add(this.root);
    this.material = material.clone(); this.material.side = THREE.DoubleSide;
    this.material.roughness = 1; this.material.metalness = 0;
    this.pieces = fragments.map(({ geometry, center }) => {
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.copy(center); mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.mudHouse = this; this.root.add(mesh);
      return { mesh, home: center.clone(), detached: false, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), age: 0 };
    });
    this.doors = Array.from({ length: 4 }, (_, i) => {
      const direction = new THREE.Vector3(Math.sin(i * Math.PI / 2), 0, Math.cos(i * Math.PI / 2));
      return { index: i, direction, start: position.clone().addScaledVector(direction, 1.65),
        end: position.clone().addScaledVector(direction, 5.8), delay: i * 0.5 };
    });
    this.obstacle = { x: position.x, z: position.z, radius: 4.45 };
    this.bursts = []; this.debris = []; this.marks = [];
    this.chipGeometry = new THREE.DodecahedronGeometry(0.11, 0);
    this.chipMaterial = new THREE.MeshStandardMaterial({ color: 0x9f7148, roughness: 1 });
    this.root.updateMatrixWorld(true);
  }

  get shootableMeshes() { return this.alive ? this.pieces.filter(p => !p.detached).map(p => p.mesh) : []; }

  takeDamage(amount, hit = null) {
    if (!this.alive || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount); this.hitTime = 0.22;
    const point = hit?.point?.clone() || this.root.position.clone().add(new THREE.Vector3(0, 2, 3));
    const normal = hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 0.4, 1);
    this._burst(point, normal, 20, 0.6);
    this._chips(point, normal, 7);
    if (hit) this._mark(hit, normal, 0.65 + (1 - this.health / this.maxHealth) * 1.2);
    const stage = this.health === 0 ? 4 : Math.floor((100 - this.health) / 25);
    if (stage > this.damageStage) {
      for (let n = this.damageStage; n < Math.min(stage, 3); n++) {
        const candidates = this.pieces.filter(p => !p.detached && p.home.y > 2.1);
        candidates.sort((a, b) => a.mesh.getWorldPosition(new THREE.Vector3()).distanceToSquared(point) - b.mesh.getWorldPosition(new THREE.Vector3()).distanceToSquared(point));
        for (const piece of candidates.slice(0, 2 + n)) this._detach(piece, 1.8);
        this._crackWalls(n);
      }
      this.damageStage = stage;
    }
    if (this.health > 0) return false;
    this.alive = false;
    for (const piece of this.pieces) if (!piece.detached) this._detach(piece, 2.8);
    this._burst(this.root.position.clone().add(new THREE.Vector3(0, 1.4, 0)), new THREE.Vector3(0, 1, 0), 100, 3.6);
    this._chips(this.root.position.clone().add(new THREE.Vector3(0, 2.5, 0)), new THREE.Vector3(0, 1, 0), 22);
    return true;
  }

  _crackWalls(stage) {
    this.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + Math.PI / 4 + stage * 0.11;
      const center = this.root.position.clone().add(new THREE.Vector3(0, 1.4 + stage * 0.45, 0));
      const direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      ray.set(center.clone().addScaledVector(direction, 7), direction.clone().negate());
      const hit = ray.intersectObjects(this.shootableMeshes, false)[0];
      if (hit) this._mark(hit, hit.face.normal.clone().transformDirection(hit.object.matrixWorld), 1.6 + stage * 0.45);
    }
  }

  _mark(hit, normal, size) {
    if (!this.textures?.cracks) return;
    const orientation = new THREE.Object3D(); orientation.lookAt(normal);
    const geometry = new DecalGeometry(hit.object, hit.point, orientation.rotation, new THREE.Vector3(size, size, 0.35));
    const material = new THREE.MeshStandardMaterial({ map: this.textures.cracks, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    const mark = new THREE.Mesh(geometry, material);
    // DecalGeometry is in world space. Attach it to the hit fragment so it falls with the wall.
    mark.applyMatrix4(hit.object.matrixWorld.clone().invert()); hit.object.add(mark);
    this.marks.push(mark);
    if (this.marks.length > 28) { const oldest = this.marks.shift(); oldest.removeFromParent(); oldest.geometry.dispose(); oldest.material.dispose(); }
  }

  _detach(piece, strength) {
    piece.detached = true;
    const outward = new THREE.Vector3(piece.home.x, 0, piece.home.z).normalize();
    piece.velocity.copy(outward).multiplyScalar(strength * (0.65 + Math.random() * 0.5));
    piece.velocity.y = 0.5 + Math.random() * 1.1;
    piece.spin.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 2);
  }

  _burst(point, normal, count, spread) {
    const positions = new Float32Array(count * 3), velocities = [];
    const local = this.root.worldToLocal(point.clone());
    for (let i = 0; i < count; i++) {
      positions.set([local.x + (Math.random() - 0.5) * spread, local.y, local.z + (Math.random() - 0.5) * spread], i * 3);
      velocities.push(new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * 1.1, (Math.random() - 0.5) * spread).addScaledVector(normal, 0.5));
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xd7b386, map: this.textures?.dust || null, size: spread * 0.6 + 0.35,
      transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true });
    const points = new THREE.Points(geometry, material); this.root.add(points);
    this.bursts.push({ points, velocities, age: 0, lifetime: spread > 1 ? 3.2 : 1.1 });
  }

  _chips(point, normal, count) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.chipGeometry, this.chipMaterial);
      mesh.position.copy(this.root.worldToLocal(point.clone())); mesh.scale.setScalar(0.5 + Math.random() * 1.5);
      this.root.add(mesh);
      this.debris.push({ mesh, age: 0, velocity: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 3).addScaledVector(normal, 2) });
    }
  }

  update(dt) {
    this.hitTime = Math.max(0, this.hitTime - dt);
    this.material.emissive.setHex(0x7a421e); this.material.emissiveIntensity = this.hitTime * 0.7;
    if (!this.alive) this.destroyTime += dt;
    for (const piece of this.pieces) {
      if (!piece.detached) {
        piece.mesh.position.copy(piece.home); piece.mesh.position.x += Math.sin(this.hitTime * 120) * this.hitTime * 0.08;
        continue;
      }
      piece.age += dt;
      if (piece.age > 3) continue;
      piece.velocity.y -= dt * 12;
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      piece.mesh.rotation.x += piece.spin.x * dt; piece.mesh.rotation.y += piece.spin.y * dt; piece.mesh.rotation.z += piece.spin.z * dt;
      piece.mesh.scale.y = THREE.MathUtils.lerp(1, 0.25, Math.min(1, piece.age / 1.6));
      if (piece.mesh.position.y < 0.12) { piece.mesh.position.y = 0.12; piece.velocity.set(0, 0, 0); piece.spin.multiplyScalar(0.2); }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const burst = this.bursts[i]; burst.age += dt;
      const attribute = burst.points.geometry.getAttribute('position');
      burst.velocities.forEach((v, n) => {
        attribute.setXYZ(n, attribute.getX(n) + v.x * dt, attribute.getY(n) + v.y * dt, attribute.getZ(n) + v.z * dt);
      });
      attribute.needsUpdate = true; burst.points.material.opacity = 0.7 * Math.max(0, 1 - burst.age / burst.lifetime);
      if (burst.age >= burst.lifetime) { burst.points.removeFromParent(); burst.points.geometry.dispose(); burst.points.material.dispose(); this.bursts.splice(i, 1); }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const chip = this.debris[i]; chip.age += dt; chip.velocity.y -= 16 * dt;
      chip.mesh.position.addScaledVector(chip.velocity, dt); chip.mesh.rotation.x += dt * 4;
      if (chip.mesh.position.y < 0.05) { chip.mesh.position.y = 0.05; chip.velocity.set(0, 0, 0); }
      if (chip.age > 4) { chip.mesh.removeFromParent(); this.debris.splice(i, 1); }
    }
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const burst of this.bursts) { burst.points.geometry.dispose(); burst.points.material.dispose(); }
    for (const mark of this.marks) { mark.geometry.dispose(); mark.material.dispose(); }
    this.chipGeometry.dispose(); this.chipMaterial.dispose(); this.material.dispose();
    this.bursts = []; this.marks = []; this.debris = []; this.root.removeFromParent();
    // Fragment geometries and kit textures are shared and owned by the level.
  }
}
