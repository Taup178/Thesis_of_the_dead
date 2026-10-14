import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SOPHOMORE_LAYOUT as layout } from '../levels/SophomoreLayout.js';

const ROW_COUNT = 9, COLUMNS = 14, HEIGHT = 1.4, SLOT_TIME = 2.4;
export const SPIKE_CYCLE = SLOT_TIME * 3;

export function getRetractingSpikeState(time, bank) {
  const phase = THREE.MathUtils.euclideanModulo(time - bank * SLOT_TIME, SPIKE_CYCLE);
  let extension = 0;
  if (phase >= 0.35 && phase < 0.6) extension = THREE.MathUtils.smoothstep(phase, 0.35, 0.6);
  else if (phase >= 0.6 && phase < 1.45) extension = 1;
  else if (phase >= 1.45 && phase < 1.85) extension = 1 - THREE.MathUtils.smoothstep(phase, 1.45, 1.85);
  return { extension, warning: phase < 0.35 };
}

/** A perforated stone floor with lined sockets, moving steel spikes and a fixed three-bank sequence. */
export class RetractingSpikes {
  constructor(level) {
    this.level = level; this.root = new THREE.Group(); this.root.name = 'RetractingSpikeCorridor';
    level.root.add(this.root); this.time = 0; this.disposed = false;
    const center = (layout.spikeCorridorMinZ + layout.spikeCorridorMaxZ) / 2;
    const halfLength = (layout.spikeCorridorMaxZ - layout.spikeCorridorMinZ) / 2;
    const halfWidth = layout.deckWidth / 2;
    const floorShape = new THREE.Shape();
    floorShape.moveTo(-halfWidth, -halfLength); floorShape.lineTo(halfWidth, -halfLength);
    floorShape.lineTo(halfWidth, halfLength); floorShape.lineTo(-halfWidth, halfLength); floorShape.closePath();
    this.rows = Array.from({ length: ROW_COUNT }, (_, index) => ({ index, bank: index % 3,
      z: layout.spikeCorridorMaxZ - 4 - index * 4, extension: 0, slots: [] }));
    for (const row of this.rows) for (let column = 0; column < COLUMNS; column++) {
      const x = -halfWidth + column + 0.5;
      row.slots.push({ x, z: row.z });
      const hole = new THREE.Path(); hole.absarc(x, row.z - center, 0.22, 0, Math.PI * 2, true);
      floorShape.holes.push(hole);
    }
    const floorGeometry = new THREE.ExtrudeGeometry(floorShape, { depth: 0.65, bevelEnabled: false, curveSegments: 12 });
    floorGeometry.rotateX(Math.PI / 2);
    this.floor = new THREE.Mesh(level.floors.mapGeometry(floorGeometry, 0, center), level.floors.material);
    this.floor.name = 'PerforatedStoneFloor'; this.floor.position.z = center;
    this.floor.castShadow = this.floor.receiveShadow = true; this.root.add(this.floor);
    this.surface = { minX: -halfWidth, maxX: halfWidth, minZ: layout.spikeCorridorMinZ,
      maxZ: layout.spikeCorridorMaxZ, y: 0, tile: null };
    const steel = new THREE.MeshStandardMaterial({ color: 0x89918e, metalness: 0.82, roughness: 0.43 });
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x202624, metalness: 0.65, roughness: 0.68, side: THREE.DoubleSide });
    const cone = new THREE.ConeGeometry(0.16, HEIGHT, 8); cone.translate(0, -HEIGHT / 2, 0);
    const shaft = new THREE.CylinderGeometry(0.075, 0.085, 0.65, 10); shaft.translate(0, -HEIGHT - 0.325, 0);
    const spikeGeometry = mergeGeometries([cone, shaft]); cone.dispose(); shaft.dispose();
    const socketGeometry = new THREE.CylinderGeometry(0.22, 0.22, 1.8, 12, 1, true);
    const bottomGeometry = new THREE.CircleGeometry(0.22, 12); bottomGeometry.rotateX(-Math.PI / 2);
    const collarGeometry = new THREE.TorusGeometry(0.24, 0.035, 6, 20); collarGeometry.rotateX(-Math.PI / 2);
    this.banks = Array.from({ length: 3 }, (_, bank) => {
      const slots = this.rows.filter(row => row.bank === bank).flatMap(row => row.slots);
      const count = slots.length;
      const spike = new THREE.InstancedMesh(spikeGeometry, steel, count);
      spike.name = `RetractingSpikesBank_${bank + 1}`;
      spike.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const collars = new THREE.InstancedMesh(collarGeometry,
        new THREE.MeshStandardMaterial({ color: 0x414945, metalness: 0.75, roughness: 0.5, emissive: 0xd16a12, emissiveIntensity: 0 }), count);
      collars.name = `SpikeSocketRims_${bank + 1}`;
      const sockets = new THREE.InstancedMesh(socketGeometry, darkSteel, count);
      sockets.name = 'RecessedSpikeSockets';
      const bottoms = new THREE.InstancedMesh(bottomGeometry, new THREE.MeshStandardMaterial({ color: 0x080909, roughness: 1 }), count);
      bottoms.name = 'SpikeSocketBottoms';
      const matrix = new THREE.Matrix4();
      slots.forEach((slot, index) => {
        matrix.makeTranslation(slot.x, 0.006, slot.z); collars.setMatrixAt(index, matrix);
        matrix.makeTranslation(slot.x, -0.9, slot.z); sockets.setMatrixAt(index, matrix);
        matrix.makeTranslation(slot.x, -1.8, slot.z); bottoms.setMatrixAt(index, matrix);
      });
      for (const mesh of [spike, collars, sockets, bottoms]) {
        mesh.castShadow = mesh.receiveShadow = true;
        // Include the full piston travel when culling the animated instance mesh.
        if (mesh === spike) {
          mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-halfWidth, -2.1, layout.spikeCorridorMinZ),
            new THREE.Vector3(halfWidth, HEIGHT, layout.spikeCorridorMaxZ));
          mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(new THREE.Sphere());
        } else mesh.computeBoundingSphere();
        this.root.add(mesh);
      }
      return { spike, collars, slots, extension: 0 };
    });
    this.update(0);
  }

  update(dt) {
    if (this.disposed) return;
    this.time += dt;
    const matrix = new THREE.Matrix4();
    this.banks.forEach((bank, index) => {
      const state = getRetractingSpikeState(this.time, index);
      bank.extension = state.extension;
      bank.collars.material.emissiveIntensity = state.warning ? 0.65 + Math.sin(this.time * 24) * 0.12 : 0;
      bank.slots.forEach((slot, instance) => {
        matrix.makeTranslation(slot.x, state.extension * HEIGHT - 0.035, slot.z);
        bank.spike.setMatrixAt(instance, matrix);
      });
      bank.spike.instanceMatrix.needsUpdate = true;
    });
    for (const row of this.rows) row.extension = this.banks[row.bank].extension;
  }

  hitsPlayer(player) {
    const position = player.group.position;
    if (position.y > HEIGHT || position.z < this.surface.minZ || position.z > this.surface.maxZ) return false;
    return this.rows.some(row => row.extension * HEIGHT - 0.035 > 0.12 &&
      position.y <= row.extension * HEIGHT - 0.035 && row.slots.some(slot =>
        (position.x - slot.x) ** 2 + (position.z - slot.z) ** 2 <= 0.56 ** 2));
  }

  clearCrossingDelay(row, arrivalTime, duration) {
    // Plan the guide's crossing against the exact same sequence used by visible spikes.
    for (let delay = 0; delay <= SPIKE_CYCLE + 0.05; delay += 0.05) {
      let clear = true;
      for (let sample = 0; sample <= 8; sample++) {
        if (getRetractingSpikeState(arrivalTime + delay + duration * sample / 8, row.bank).extension > 0.025) {
          clear = false; break;
        }
      }
      if (clear) return delay;
    }
    return SPIKE_CYCLE;
  }

  dispose() { this.disposed = true; }
}
