import * as THREE from 'three';

/** A rolled parchment degree, tied with a ribbon and a gold academic seal. */
export function createDegreeScroll() {
  const scroll = new THREE.Group();
  scroll.name = 'DegreeScroll';

  // Fine paper grain gives the parchment a natural surface under the forest light.
  const pixels = new Uint8Array(128 * 128 * 4);
  let grainSeed = 73;
  for (let i = 0; i < pixels.length; i += 4) {
    grainSeed = (Math.imul(grainSeed, 1664525) + 1013904223) >>> 0;
    const grain = (grainSeed >>> 28) - 8;
    pixels.set([245 + grain, 232 + grain, 202 + grain, 255], i);
  }
  const paperTexture = new THREE.DataTexture(pixels, 128, 128);
  paperTexture.colorSpace = THREE.SRGBColorSpace;
  paperTexture.wrapS = paperTexture.wrapT = THREE.RepeatWrapping;
  paperTexture.magFilter = THREE.LinearFilter;
  paperTexture.needsUpdate = true;
  const parchment = new THREE.MeshStandardMaterial({
    map: paperTexture, bumpMap: paperTexture, bumpScale: 0.0015, roughness: 0.92
  });
  const paperEdge = new THREE.MeshStandardMaterial({ color: 0xc6a36b, roughness: 0.9 });
  const ribbon = new THREE.MeshStandardMaterial({ color: 0xa71930, roughness: 0.85, side: THREE.DoubleSide });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe9b83f, metalness: 0.6, roughness: 0.35 });

  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.85, 32), parchment);
  roll.rotation.z = Math.PI / 2;
  scroll.add(roll);

  // Exposed spirals at both ends make this read as rolled paper.
  for (const end of [-1, 1]) {
    const points = [];
    for (let i = 0; i <= 48; i++) {
      const t = i / 48;
      const angle = t * Math.PI * 5;
      const radius = 0.01 + t * 0.085;
      points.push(new THREE.Vector3(end * 0.43, Math.cos(angle) * radius, Math.sin(angle) * radius));
    }
    const spiral = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.0035, 5, false), paperEdge
    );
    scroll.add(spiral);
  }

  // Place the ribbon beside the grip so it does not sit inside his fingers.
  const ribbonOffset = 0.2;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.109, 0.109, 0.065, 32), ribbon);
  band.rotation.z = Math.PI / 2;
  band.position.x = ribbonOffset;
  scroll.add(band);

  for (const side of [-1, 1]) {
    const vertices = [];
    const indices = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = side * t * 0.025;
      const width = 0.045 * (1 - t * 0.15);
      const y = -t * 0.18;
      const z = Math.sin(t * Math.PI) * 0.025;
      vertices.push(x - width / 2, y, z, x + width / 2, y, z);
      if (i < 8) {
        const start = i * 2;
        indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const tail = new THREE.Mesh(geometry, ribbon);
    tail.position.set(ribbonOffset + side * 0.025, -0.025, 0.113);
    tail.userData.degreeRibbonTail = true;
    scroll.add(tail);
  }

  const seal = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 16), gold);
  seal.rotation.x = Math.PI / 2;
  seal.position.set(ribbonOffset, 0, 0.12);
  scroll.add(seal);

  // A small mortarboard stamped into the seal identifies it as the player's degree.
  const capShape = new THREE.Shape();
  capShape.moveTo(-0.05, 0.01);
  capShape.lineTo(0, 0.035);
  capShape.lineTo(0.05, 0.01);
  capShape.lineTo(0, -0.015);
  capShape.closePath();
  const cap = new THREE.Mesh(new THREE.ShapeGeometry(capShape), paperEdge);
  cap.position.set(ribbonOffset, 0, 0.132);
  scroll.add(cap);
  const capBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.005), paperEdge);
  capBase.position.set(ribbonOffset, -0.023, 0.132);
  scroll.add(capBase);

  scroll.traverse(child => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return scroll;
}

/** Keep the left fingers curled around the degree while the arm follows its run clip. */
export function createLeftHandDegreeGrip(hand, scroll) {
  const curls = [
    ['Index1.L', -0.18], ['Index2.L', -0.7], ['Index3.L', -0.25],
    ['Middle1.L', -0.12], ['Middle2.L', 0.85], ['Middle3.L', -0.35],
    ['Pinky1.L', -0.1], ['Pinky2.L', -0.65], ['Pinky3.L', -0.2],
    ['Thumb1.L', 0.1], ['Thumb2.L', -0.25],
  ];
  const poses = [];
  for (const [name, angle] of curls) {
    const bone = hand.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
    if (!bone) continue;
    const rotation = bone.quaternion.clone().multiply(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle)
    );
    poses.push({ bone, rotation, position: bone.position.clone() });
  }
  const tails = scroll.children.filter(child => child.userData.degreeRibbonTail);
  const scrollRotation = new THREE.Quaternion();
  const localDown = new THREE.Vector3(0, -1, 0);
  const gravity = new THREE.Vector3();
  return () => {
    for (const pose of poses) {
      pose.bone.quaternion.copy(pose.rotation);
      pose.bone.position.copy(pose.position);
    }
    // Loose ribbon ends hang down instead of pointing up when the wrist rotates.
    scroll.getWorldQuaternion(scrollRotation).invert();
    gravity.set(0, -1, 0).applyQuaternion(scrollRotation);
    for (const tail of tails) tail.quaternion.setFromUnitVectors(localDown, gravity);
  };
}
