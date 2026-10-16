import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function add(group, name, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name; mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return mesh;
}

function metalEnvironment() {
  if (typeof document === 'undefined') return null;
  const faces = Array.from({ length: 6 }, (_, face) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 0, 64);
    gradient.addColorStop(0, '#a2a8a9'); gradient.addColorStop(0.44, '#303b43');
    gradient.addColorStop(0.52, '#a6aeb0'); gradient.addColorStop(0.62, '#252b2e'); gradient.addColorStop(1, '#393128');
    context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
    if (face !== 3) { context.fillStyle = '#dce1df'; context.fillRect(face % 2 ? 38 : 12, 3, 7, 46); }
    return canvas;
  });
  const texture = new THREE.CubeTexture(faces); texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true; return texture;
}

function materials() {
  const environment = metalEnvironment();
  const metal = (color, roughness, metalness = 0.88) => new THREE.MeshStandardMaterial({
    color, roughness, metalness, envMap: environment, envMapIntensity: 0.55,
  });
  const data = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) {
    const value = 95 + Math.round((Math.sin(i * 127.13) * 43758.5453 % 1 + 1) * 40);
    data.set([value, value, value, 255], i * 4);
  }
  const grain = new THREE.DataTexture(data, 64, 64); grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(3, 6); grain.magFilter = THREE.LinearFilter; grain.needsUpdate = true;
  const grip = color => new THREE.MeshStandardMaterial({ color, roughness: 0.87, bumpMap: grain, bumpScale: 0.0012 });
  return { steel: metal(0xc7d0d2, 0.25), edge: metal(0xe6e9e6, 0.15), tip: metal(0xb7c3c7, 0.21),
    dark: metal(0x292c2d, 0.38, 0.72), slide: metal(0x78848b, 0.29, 0.75),
    brass: metal(0xa28b58, 0.34), hamon: metal(0xaebdc0, 0.39, 0.72),
    leather: grip(0x30221b), braid: grip(0x181b1b), raySkin: grip(0xb8aa86),
    polymer: grip(0x292b2b), seam: grip(0x59412b),
    bore: new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 0.95 }),
    sight: new THREE.MeshStandardMaterial({ color: 0xd8d7bc, roughness: 0.5 }) };
}

function fitting(width, height, length, bevel = 0.002) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2); shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height / 2); shape.lineTo(-width / 2, height / 2); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: true,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 });
  geometry.translate(0, 0, -length / 2); return geometry;
}

/** Closed, faceted cross sections produce real edge bevels and a raised blade ridge. */
function bladeGeometry(stations, profile) {
  const positions = [], groups = [];
  const vertex = (station, index) => new THREE.Vector3(station.x + profile[index][0] * station.width,
    profile[index][1] * station.thickness, station.z);
  const triangle = (a, b, c) => positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  for (let segment = 0; segment < stations.length - 1; segment++) {
    const current = stations[segment], next = stations[segment + 1];
    for (let side = 0; side < profile.length; side++) {
      const start = positions.length / 3, adjacent = (side + 1) % profile.length;
      const a = vertex(current, side), b = vertex(current, adjacent), c = vertex(next, adjacent), d = vertex(next, side);
      triangle(a, b, c); if (next.width > 0) triangle(a, c, d);
      const material = next.width === 0 ? 2 : side === 0 || side === profile.length - 1 ? 1 : 0;
      groups.push({ start, count: positions.length / 3 - start, material });
    }
  }
  const start = positions.length / 3, base = stations[0];
  const center = new THREE.Vector3(base.x, 0, base.z);
  for (let side = 0; side < profile.length; side++) triangle(center, vertex(base, (side + 1) % profile.length), vertex(base, side));
  groups.push({ start, count: positions.length / 3 - start, material: 0 });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  for (const group of groups) geometry.addGroup(group.start, group.count, group.material);
  return geometry;
}

function gripCore(group, material, start, end, radius, flatten = 0.75) {
  const points = [[0.94, 0], [1, 0.08], [1.05, 0.35], [1.02, 0.68], [0.91, 0.95], [0.88, 1]]
    .map(([r, t]) => new THREE.Vector2(radius * r, THREE.MathUtils.lerp(start, end, t)));
  const geometry = new THREE.LatheGeometry(points, 16);
  geometry.rotateX(Math.PI / 2); geometry.scale(1, flatten, 1);
  return add(group, 'Grip', geometry, material);
}

function wrapGrip(group, material, start, end, rx, ry, turns, crossed, bandWidth) {
  const positions = [];
  const steps = Math.ceil(turns * 48);
  for (const direction of crossed ? [-1, 1] : [1]) {
    for (let i = 0; i < steps; i++) {
      const vertices = [];
      for (const [step, edge] of [[i, -1], [i, 1], [i + 1, 1], [i + 1, -1]]) {
        const t = step / steps, angle = t * turns * Math.PI * 2 * direction;
        const swell = 0.96 + Math.sin(Math.PI * t) * 0.055;
        vertices.push([Math.cos(angle) * rx * swell, Math.sin(angle) * ry * swell,
          THREE.MathUtils.lerp(start, end, t) + edge * bandWidth / 2]);
      }
      for (const index of [0, 1, 2, 0, 2, 3]) positions.push(...vertices[index]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  material.side = THREE.DoubleSide;
  return add(group, crossed ? 'CrossedSilkWrap' : 'LeatherWrap', geometry, material);
}

function marker(group, name, x, y, z) {
  const tip = new THREE.Object3D(); tip.name = name; tip.position.set(x, y, z); group.add(tip);
}

export function createKatana() {
  const group = new THREE.Group(), m = materials();
  const stations = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32;
    return { x: 0.042 * t * t, z: -0.125 - 1.05 * t,
      width: 0.058 * (1 - 0.28 * t), thickness: 0.0045 * (1 - 0.45 * t) };
  });
  stations.push({ x: 0.063, z: -1.175 - 0.085, width: 0, thickness: 0 });
  const profile = [[-0.5, 0], [-0.24, 0.6], [0.12, 1], [0.5, 0.55], [0.5, -0.55], [0.12, -1], [-0.24, -0.6]];
  add(group, 'CurvedKatanaBlade', bladeGeometry(stations, profile), [m.steel, m.edge, m.tip]);
  const hamonPositions = [];
  for (const side of [-1, 1]) for (let i = 0; i < stations.length - 2; i++) {
    const points = [];
    for (const [index, offset] of [[i, -1], [i, 1], [i + 1, 1], [i + 1, -1]]) {
      const station = stations[index];
      const f = 0.15 + Math.sin(index * 1.9) * 0.018 + offset * 0.012;
      points.push([station.x + (-0.5 + f) * station.width,
        side * (station.thickness * f / 0.26 * 0.6 + 0.00009), station.z]);
    }
    for (const index of [0, 1, 2, 0, 2, 3]) hamonPositions.push(...points[index]);
  }
  const hamon = new THREE.BufferGeometry(); hamon.setAttribute('position', new THREE.Float32BufferAttribute(hamonPositions, 3));
  hamon.computeVertexNormals(); m.hamon.side = THREE.DoubleSide; add(group, 'TemperLine', hamon, m.hamon);
  const guard = new THREE.Shape(); guard.absellipse(0, 0, 0.075, 0.052, 0, Math.PI * 2, false, 0);
  for (const x of [-0.046, 0.046]) { const hole = new THREE.Path(); hole.absellipse(x, 0, 0.009, 0.015, 0, Math.PI * 2, true, 0); guard.holes.push(hole); }
  const tsuba = new THREE.ExtrudeGeometry(guard, { depth: 0.011, bevelEnabled: true,
    bevelSize: 0.0018, bevelThickness: 0.0015, bevelSegments: 2, curveSegments: 32, steps: 1 });
  add(group, 'Tsuba', tsuba, m.dark, 0, 0, -0.085);
  add(group, 'Habaki', fitting(0.06, 0.019, 0.048, 0.001), m.brass, 0, 0, -0.113);
  gripCore(group, m.raySkin, -0.063, 0.285, 0.027);
  wrapGrip(group, m.braid, -0.052, 0.272, 0.0285, 0.022, 7, true, 0.012);
  add(group, 'Fuchi', fitting(0.055, 0.041, 0.019, 0.002), m.dark, 0, 0, -0.058);
  add(group, 'Kashira', fitting(0.051, 0.038, 0.021, 0.003), m.dark, 0, 0, 0.282);
  for (const z of [0.035, 0.178]) {
    const pin = add(group, 'Mekugi', new THREE.CylinderGeometry(0.004, 0.004, 0.045, 8), m.brass, 0, 0, z);
    pin.rotation.z = Math.PI / 2;
  }
  marker(group, 'BladeTip', 0.063, 0, -1.26);
  return group;
}

export function createDagger() {
  const group = new THREE.Group(), m = materials();
  const stations = [[0, 0.067, 0.0045], [0.07, 0.067, 0.0045], [0.26, 0.06, 0.004],
    [0.37, 0.045, 0.003], [0.43, 0.027, 0.002], [0.49, 0, 0]]
    .map(([distance, width, thickness]) => ({ x: 0, z: -0.12 - distance, width, thickness }));
  add(group, 'DoubleEdgedDaggerBlade', bladeGeometry(stations, [[-0.5, 0], [0, 1], [0.5, 0], [0, -1]]), [m.steel, m.edge, m.tip]);
  add(group, 'Ricasso', fitting(0.05, 0.012, 0.025, 0.001), m.tip, 0, 0, -0.111);
  const guard = new THREE.Shape();
  guard.moveTo(-0.1, -0.11); guard.quadraticCurveTo(-0.08, -0.126, -0.043, -0.092);
  guard.lineTo(0.043, -0.092); guard.quadraticCurveTo(0.08, -0.126, 0.1, -0.11);
  guard.lineTo(0.092, -0.083); guard.quadraticCurveTo(0.045, -0.057, 0, -0.066);
  guard.quadraticCurveTo(-0.045, -0.057, -0.092, -0.083); guard.closePath();
  const geometry = new THREE.ExtrudeGeometry(guard, { depth: 0.012, bevelEnabled: true,
    bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 12, steps: 1 });
  geometry.rotateX(Math.PI / 2); add(group, 'CurvedCrossguard', geometry, m.dark, 0, 0.006, 0);
  gripCore(group, m.leather, -0.052, 0.17, 0.026);
  wrapGrip(group, m.seam, -0.04, 0.157, 0.0275, 0.021, 11, false, 0.004);
  add(group, 'GripCollar', fitting(0.052, 0.039, 0.018, 0.002), m.dark, 0, 0, -0.05);
  add(group, 'Pommel', fitting(0.049, 0.038, 0.025, 0.004), m.dark, 0, 0, 0.17);
  marker(group, 'BladeTip', 0, 0, -0.61);
  return group;
}

export function createPistol() {
  const group = new THREE.Group(), m = materials();
  const slide = new THREE.Group(); slide.name = 'PistolSlide'; group.add(slide);
  add(slide, 'BeveledSlide', fitting(0.105, 0.093, 0.35, 0.006), m.slide, 0, 0.069, -0.17);
  add(slide, 'SlideTop', fitting(0.073, 0.012, 0.3, 0.003), m.dark, 0, 0.117, -0.17);
  add(slide, 'EjectionPort', fitting(0.002, 0.034, 0.071, 0.001), m.bore, 0.059, 0.083, -0.153);
  const cuts = [];
  for (const side of [-1, 1]) for (const [start, count] of [[-0.035, 7], [-0.255, 4]]) {
    for (let i = 0; i < count; i++) {
      const geometry = new THREE.BoxGeometry(0.003, 0.063, 0.004);
      geometry.rotateX(-0.17); geometry.translate(side * 0.059, 0.071, start - i * 0.011); cuts.push(geometry);
    }
  }
  add(slide, 'SlideSerrations', mergeGeometries(cuts), m.dark); cuts.forEach(geometry => geometry.dispose());
  add(slide, 'RearSight', fitting(0.057, 0.018, 0.019, 0.002), m.dark, 0, 0.133, -0.027);
  add(slide, 'SightNotch', new THREE.BoxGeometry(0.013, 0.014, 0.021), m.bore, 0, 0.139, -0.027);
  add(slide, 'FrontSight', fitting(0.011, 0.018, 0.023, 0.001), m.dark, 0, 0.133, -0.312);
  add(slide, 'FrontSightDot', new THREE.SphereGeometry(0.0028, 6, 4), m.sight, 0, 0.137, -0.299);
  add(group, 'Frame', fitting(0.093, 0.066, 0.31, 0.005), m.dark, 0, 0.006, -0.153);
  add(group, 'AccessoryRail', fitting(0.068, 0.02, 0.105, 0.002), m.dark, 0, -0.034, -0.258);
  const barrel = add(group, 'Barrel', new THREE.CylinderGeometry(0.021, 0.021, 0.072, 24), m.steel, 0, 0.067, -0.322);
  barrel.rotation.x = Math.PI / 2;
  const bore = add(group, 'BarrelBore', new THREE.CircleGeometry(0.014, 24), m.bore, 0, 0.067, -0.359);
  bore.rotation.y = Math.PI;
  const crown = add(group, 'MuzzleCrown', new THREE.TorusGeometry(0.017, 0.003, 8, 24), m.edge, 0, 0.067, -0.36);
  crown.rotation.y = Math.PI;
  const grip = new THREE.Group(); grip.position.set(0, -0.117, 0.019); grip.rotation.x = -0.21; group.add(grip);
  add(grip, 'GripFrame', fitting(0.086, 0.216, 0.091, 0.009), m.dark);
  for (const side of [-1, 1]) {
    add(grip, 'StippledGripPanel', fitting(0.004, 0.177, 0.071, 0.002), m.polymer, side * 0.053, -0.003, 0);
    for (const y of [-0.073, 0.066]) {
      const pin = add(grip, 'GripPin', new THREE.CylinderGeometry(0.004, 0.004, 0.003, 10), m.slide, side * 0.058, y, 0);
      pin.rotation.z = Math.PI / 2;
    }
  }
  add(grip, 'MagazineBase', fitting(0.097, 0.016, 0.106, 0.003), m.dark, 0, -0.113, 0);
  const guard = new THREE.Shape();
  guard.moveTo(-0.026, -0.025); guard.lineTo(-0.136, -0.025);
  guard.quadraticCurveTo(-0.168, -0.04, -0.155, -0.105);
  guard.quadraticCurveTo(-0.105, -0.127, -0.025, -0.096); guard.closePath();
  const hole = new THREE.Path(); hole.moveTo(-0.043, -0.041); hole.lineTo(-0.13, -0.041);
  hole.quadraticCurveTo(-0.148, -0.051, -0.139, -0.091); hole.quadraticCurveTo(-0.1, -0.104, -0.043, -0.083); hole.closePath(); guard.holes.push(hole);
  const guardGeometry = new THREE.ExtrudeGeometry(guard, { depth: 0.026, bevelEnabled: true,
    bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2, curveSegments: 12, steps: 1 });
  guardGeometry.rotateY(-Math.PI / 2); guardGeometry.translate(0.013, 0, 0);
  add(group, 'TriggerGuard', guardGeometry, m.dark);
  const trigger = add(group, 'Trigger', fitting(0.012, 0.05, 0.009, 0.002), m.slide, 0, -0.057, -0.06);
  trigger.rotation.x = -0.35;
  add(group, 'SlideRelease', fitting(0.008, 0.012, 0.049, 0.001), m.slide, -0.051, 0.012, -0.047);
  marker(group, 'PistolMuzzle', 0, 0.067, -0.368);
  return group;
}
