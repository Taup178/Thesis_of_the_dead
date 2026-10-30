import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

function crossesPlayer(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = THREE.MathUtils.clamp(-(a.x * dx + a.z * dz) / (dx * dx + dz * dz || 1), 0, 1);
  const height = THREE.MathUtils.lerp(a.y, b.y, t);
  return Math.hypot(a.x + dx * t, a.z + dz * t) < 0.7 && height > 0.12 && height < 1.85;
}

/** The actual degree makes two separately dodgeable passes, then returns to its grip. */
export class MonsterDegreeFlight {
  constructor(root, scroll, grip) {
    this.root = root; this.scroll = scroll; this.grip = grip; this.active = false;
    this.returnAim = V(); this.lastPlayer = V(); this.previous = V(); this.position = V();
    this.relativeA = V(); this.relativeB = V(); this.tangent = V(); this.scale = V();
    this.age = 0; this.hit = new Set(); this.speed = 18;
  }

  launch(aim) {
    if (this.active) return;
    this.root.updateWorldMatrix(true, true);
    this.scroll.getWorldScale(this.scale); this.scroll.getWorldPosition(this.position);
    this.launchRotation = this.scroll.getWorldQuaternion(new THREE.Quaternion());
    this.lastPlayer.copy(aim);
    const target = aim.clone(); target.y += 1;
    const direction = target.clone().sub(this.position).setY(0);
    if (direction.lengthSq() < 0.01) direction.set(0, 0, 1);
    direction.normalize();
    const side = V(-direction.z, 0, direction.x);
    const beyond = target.clone().addScaledVector(direction, 7).addScaledVector(side, 2.4);
    beyond.y = 1.2;
    this.curve = new THREE.CatmullRomCurve3([this.position.clone(),
      this.position.clone().lerp(target, 0.5), target, beyond], false, 'centripetal');
    this.curve.arcLengthDivisions = 300;
    this.duration = this.curve.getLength() / this.speed;
    this.root.attach(this.scroll); this.scroll.visible = true;
    this.leg = 'outbound'; this.age = this.spinAge = 0; this.hit.clear(); this.active = true;
  }

  _return(playerPosition) {
    this.returnAim.copy(playerPosition); this.returnAim.y += 1;
    this.curve.getTangentAt(1, this.tangent);
    this.grip.getWorldPosition(this.catchPoint = V());
    // Continue the outgoing tangent before curving back: no instantaneous reversal.
    const turn = this.position.clone().addScaledVector(this.tangent, 3.5);
    const approach = this.catchPoint.clone().lerp(this.returnAim, 0.18);
    this.curve = new THREE.CatmullRomCurve3([this.position.clone(), turn,
      this.returnAim.clone(), approach, this.catchPoint.clone()], false, 'centripetal');
    this.curve.arcLengthDivisions = 300;
    this.duration = this.curve.getLength() / this.speed; this.age = 0; this.leg = 'return';
  }

  update(dt, player) {
    if (!this.active) return;
    if (player.alive === false) { this.clear(); return; }
    const total = Math.max(0, dt), startPlayer = this.lastPlayer.clone();
    let elapsed = 0;
    while (elapsed < total && this.active) {
      const step = Math.min(1 / 120, total - elapsed, Math.max(1e-6, this.duration - this.age));
      this.previous.copy(this.position);
      this.relativeA.copy(this.previous).sub(this.lastPlayer);
      elapsed += step; this.age += step; this.spinAge += step;
      this.lastPlayer.lerpVectors(startPlayer, player.group.position, Math.min(1, elapsed / total));
      this.curve.getPointAt(Math.min(1, this.age / this.duration), this.position);
      if (this.leg === 'return') {
        // Bend the final approach toward the live hand as the monster moves.
        // Zero weight at the turn preserves the outgoing curve and second pass.
        const hand = this.grip.getWorldPosition(this.tangent);
        this.position.addScaledVector(hand.sub(this.catchPoint),
          THREE.MathUtils.smootherstep(this.age / this.duration, 0.35, 1));
      }
      this.relativeB.copy(this.position).sub(this.lastPlayer);
      if (!this.hit.has(this.leg) && !player.isDodging && crossesPlayer(this.relativeA, this.relativeB)) {
        this.hit.add(this.leg);
        player.takeDamage(22, { type: 'blunt', source: this.previous.clone(),
          direction: this.position.clone().sub(this.previous).normalize() });
      }
      if (this.age >= this.duration - 1e-6) {
        if (this.leg === 'outbound') this._return(this.lastPlayer);
        else { this.clear(); break; }
      }
    }
    if (!this.active) return;
    this.scroll.position.copy(this.root.worldToLocal(this.position.clone()));
    this.curve.getTangentAt(Math.min(1, this.age / this.duration), this.tangent);
    const orientation = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), this.tangent.normalize());
    orientation.multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.spinAge * 17));
    orientation.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0.18));
    if (this.leg === 'return') orientation.slerp(this.grip.getWorldQuaternion(new THREE.Quaternion()),
      THREE.MathUtils.smootherstep(this.age, this.duration - 0.2, this.duration));
    const parent = this.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.scroll.quaternion.copy(parent).multiply(orientation);
  }

  clear() {
    if (this.active) {
      this.grip.add(this.scroll); this.scroll.position.set(0, 0, 0); this.scroll.quaternion.identity();
      this.scroll.scale.copy(this.scale).divide(this.grip.getWorldScale(V()));
    }
    this.active = false;
  }

  dispose() { this.clear(); }
}
