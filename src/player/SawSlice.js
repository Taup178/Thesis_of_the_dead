import * as THREE from 'three';

const EPSILON = 1e-5;

export function getVisibleBodyBounds(body, bounds = new THREE.Box3()) {
  bounds.makeEmpty(); body.updateWorldMatrix(true, false); body.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  body.traverseVisible(mesh => {
    if (!mesh.isMesh) return;
    mesh.skeleton?.update();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      bounds.expandByPoint(point);
    }
  });
  return bounds;
}

function clipTriangle(vertices, plane, side) {
  const polygon = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const da = plane.distanceToPoint(a.position) * side;
    const db = plane.distanceToPoint(b.position) * side;
    if (da >= 0) polygon.push(a);
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      polygon.push({ position: a.position.clone().lerp(b.position, t),
        normal: a.normal.clone().lerp(b.normal, t).normalize(), uv: a.uv.clone().lerp(b.uv, t) });
    }
  }
  return polygon;
}

// The intersection follows the actual posed mesh, including the gaps between limbs.
function capGeometry(segments, plane, pivot) {
  const axis = Math.abs(plane.normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = axis.cross(plane.normal).normalize();
  const v = plane.normal.clone().cross(u).normalize();
  const nodes = new Map(), edges = new Set();
  const key = point => point.toArray().map(value => Math.round(value / EPSILON)).join(',');
  for (const [a, b] of segments) {
    const ka = key(a), kb = key(b);
    if (ka === kb) continue;
    const edge = [ka, kb].sort().join('|');
    if (edges.has(edge)) continue;
    edges.add(edge);
    if (!nodes.has(ka)) nodes.set(ka, { point: a, neighbors: [] });
    if (!nodes.has(kb)) nodes.set(kb, { point: b, neighbors: [] });
    nodes.get(ka).neighbors.push(kb); nodes.get(kb).neighbors.push(ka);
  }
  const positions = [];
  for (const start of nodes.keys()) {
    if (!nodes.get(start).neighbors.length) continue;
    const contour = [];
    let current = start, closed = false;
    for (let limit = 0; limit <= edges.size; limit++) {
      const node = nodes.get(current);
      contour.push(node.point);
      const next = node.neighbors.pop();
      if (!next) break;
      const reverse = nodes.get(next).neighbors;
      const index = reverse.indexOf(current);
      if (index >= 0) reverse.splice(index, 1);
      current = next;
      if (current === start) { closed = true; break; }
    }
    if (!closed || contour.length < 3) continue;
    const flat = contour.map(point => new THREE.Vector2(point.dot(u), point.dot(v)));
    for (const triangle of THREE.ShapeUtils.triangulateShape(flat, [])) {
      for (const index of triangle) positions.push(...contour[index].clone().sub(pivot).toArray());
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** Bake skinning once, then cut triangles into two closed, independently movable pieces. */
export function createSawSlice(body, plane, cutMaterial) {
  body.updateWorldMatrix(true, true);
  body.traverse(mesh => mesh.skeleton?.update());
  const halves = [new THREE.Group(), new THREE.Group()];
  const pivot = getVisibleBodyBounds(body).getCenter(new THREE.Vector3());
  const segments = [];
  for (const half of halves) half.position.copy(pivot);
  body.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
    mesh.skeleton?.update();
    const source = mesh.geometry, snapshot = source.clone();
    const baked = new Float32Array(source.attributes.position.count * 3);
    const point = new THREE.Vector3();
    for (let i = 0; i < source.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld).toArray(baked, i * 3);
    }
    snapshot.setAttribute('position', new THREE.BufferAttribute(baked, 3));
    snapshot.computeVertexNormals();
    const buffers = halves.map(() => ({ positions: [], normals: [], uvs: [], groups: [] }));
    const indices = source.index;
    const count = indices ? indices.count : source.attributes.position.count;
    const groups = source.groups.length ? source.groups : [{ start: 0, count, materialIndex: 0 }];
    const mirrored = mesh.matrixWorld.determinant() < 0;
    for (const group of groups) {
      const starts = buffers.map(buffer => buffer.positions.length / 3);
      for (let offset = group.start; offset < Math.min(count, group.start + group.count); offset += 3) {
        const vertices = [0, mirrored ? 2 : 1, mirrored ? 1 : 2].map(corner => {
          const index = indices ? indices.getX(offset + corner) : offset + corner;
          return { position: new THREE.Vector3().fromBufferAttribute(snapshot.attributes.position, index),
            normal: new THREE.Vector3().fromBufferAttribute(snapshot.attributes.normal, index).multiplyScalar(mirrored ? -1 : 1),
            uv: source.attributes.uv ? new THREE.Vector2().fromBufferAttribute(source.attributes.uv, index) : new THREE.Vector2() };
        });
        const intersections = [];
        for (let i = 0; i < 3; i++) {
          const a = vertices[i].position, b = vertices[(i + 1) % 3].position;
          const da = plane.distanceToPoint(a), db = plane.distanceToPoint(b);
          if ((da < 0) !== (db < 0)) intersections.push(a.clone().lerp(b, da / (da - db)));
        }
        if (intersections.length === 2) segments.push(intersections);
        for (let half = 0; half < 2; half++) {
          const polygon = clipTriangle(vertices, plane, half === 0 ? 1 : -1);
          for (let i = 1; i < polygon.length - 1; i++) {
            for (const vertex of [polygon[0], polygon[i], polygon[i + 1]]) {
              buffers[half].positions.push(...vertex.position.clone().sub(pivot).toArray());
              buffers[half].normals.push(...vertex.normal.toArray());
              buffers[half].uvs.push(...vertex.uv.toArray());
            }
          }
        }
      }
      buffers.forEach((buffer, index) => buffer.groups.push({ start: starts[index],
        count: buffer.positions.length / 3 - starts[index], materialIndex: group.materialIndex }));
    }
    snapshot.dispose();
    buffers.forEach((buffer, index) => {
      if (!buffer.positions.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffer.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffer.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffer.uvs, 2));
      for (const group of buffer.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
      const piece = new THREE.Mesh(geometry, mesh.material);
      piece.castShadow = piece.receiveShadow = true;
      halves[index].add(piece);
    });
  });
  const cap = capGeometry(segments, plane, pivot);
  for (const half of halves) {
    if (!cap.attributes.position.count) continue;
    const mesh = new THREE.Mesh(cap.clone(), cutMaterial);
    mesh.name = 'SawCutSurface'; mesh.castShadow = mesh.receiveShadow = true;
    half.add(mesh);
  }
  cap.dispose();
  return halves;
}
