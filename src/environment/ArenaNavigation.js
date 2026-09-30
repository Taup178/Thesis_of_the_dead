/** Small arena grid: zombies route around houses instead of walking through walls. */
export class ArenaNavigation {
  constructor(obstacles, limit = 46, cell = 2) {
    this.obstacles = obstacles; this.limit = limit; this.cell = cell;
    this.width = Math.floor(limit * 2 / cell) + 1;
  }

  clear(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, length = dx * dx + dz * dz;
    return this.obstacles.every(o => {
      const t = length ? Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / length)) : 0;
      return (a.x + dx * t - o.x) ** 2 + (a.z + dz * t - o.z) ** 2 > (o.radius + 0.55) ** 2;
    });
  }

  route(start, goal) {
    if (this.clear(start, goal)) return [{ x: goal.x, z: goal.z }];
    const coordinate = value => Math.max(0, Math.min(this.width - 1, Math.round((value + this.limit) / this.cell)));
    const point = id => ({ x: (id % this.width) * this.cell - this.limit, z: Math.floor(id / this.width) * this.cell - this.limit });
    const first = coordinate(start.z) * this.width + coordinate(start.x);
    const last = coordinate(goal.z) * this.width + coordinate(goal.x);
    const open = [first], parents = new Map(), costs = new Map([[first, 0]]), closed = new Set();
    const heuristic = id => Math.hypot(point(id).x - goal.x, point(id).z - goal.z);
    let nearest = first;
    while (open.length) {
      open.sort((a, b) => costs.get(b) + heuristic(b) - costs.get(a) - heuristic(a));
      const id = open.pop();
      if (closed.has(id)) continue;
      if (heuristic(id) < heuristic(nearest)) nearest = id;
      if (id === last) { nearest = id; break; }
      closed.add(id);
      const col = id % this.width, row = Math.floor(id / this.width);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if ((!dx && !dz) || col + dx < 0 || col + dx >= this.width || row + dz < 0 || row + dz >= this.width) continue;
        const next = (row + dz) * this.width + col + dx;
        if (closed.has(next) || !this.clear(id === first ? start : point(id), point(next))) continue;
        const cost = costs.get(id) + Math.hypot(dx, dz) * this.cell;
        if (cost >= (costs.get(next) ?? Infinity)) continue;
        parents.set(next, id); costs.set(next, cost); open.push(next);
      }
    }
    const path = [];
    for (let id = nearest; id !== first; id = parents.get(id)) path.unshift(point(id));
    if (this.clear(path.at(-1) || start, goal)) path.push({ x: goal.x, z: goal.z });
    // Shorten the path only when the whole segment clears every obstacle.
    for (let i = path.length - 1; i > 0; i--) if (this.clear(start, path[i])) return path.slice(i);
    return path;
  }
}
