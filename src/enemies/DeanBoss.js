import * as THREE from 'three';
import { installDeanAttackMotion } from './DeanAttackMotion.js';
import { DeanEarthWave } from './DeanEarthWave.js';

const CENTER = new THREE.Vector3(0, 0, -4);
const MOVES = [
  { name: 'Double jab', duration: 1.05, windup: 0.3 },
  { name: 'Sweeping hook', duration: 1.15, windup: 0.5 },
  { name: 'Charging uppercut', duration: 1.2, windup: 0.4 },
  { name: 'Fist slide', duration: 2.05, windup: 0.55 },
  { name: 'Shadow leap', duration: 2.3, windup: 0.55 },
  { name: 'Rush punches', duration: 2.0, windup: 0.42 },
  { name: 'Ground smash', duration: 1.75, windup: 0.78 },
];
const CLOSE_MOVES = ['Double jab', 'Sweeping hook', 'Charging uppercut'];
const FAR_MOVES = ['Fist slide', 'Ground smash', 'Rush punches', 'Shadow leap'];

const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const directionTo = (a, b) => new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
const segmentDistance = (point, start, end) => {
  const dx = end.x - start.x, dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz || 1;
  const t = THREE.MathUtils.clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared, 0, 1);
  return Math.hypot(point.x - start.x - dx * t, point.z - start.z - dz * t);
};

/** Timed attacks, readable floor warnings, and physical rock hazards for the Dean. */
export class DeanBoss {
  constructor(root, dean) {
    this.dean = dean;
    this.phase = 'waiting';
    this.closeMoveIndex = 0;
    this.farMoveIndex = 0;
    this.move = null;
    this.moveTime = 0;
    this.cooldown = 0.7;
    this.introTime = 0;
    this.enraged = false;
    this.enrageNoticeTime = 0;
    this.model = dean.group.children[0] || null;
    this.modelRestY = this.model?.position.y ?? 0;
    this.modelRestPitch = this.model?.rotation.x ?? 0;
    this.attackClips = installDeanAttackMotion(dean);
    this.turnQuaternion = new THREE.Quaternion();
    this.hitWindows = new Set();
    this.cracks = [];
    this.slideMarks = [];
    this.warning = '';
    this.effects = new THREE.Group();
    this.effects.name = 'DeanAttackWarnings';
    root.add(this.effects);
    this.warningMaterial = new THREE.MeshBasicMaterial({ color: 0xef552e, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide });
    this.centerMaterial = new THREE.MeshBasicMaterial({ color: 0xf4ca66, transparent: true, opacity: 0.62, depthWrite: false, side: THREE.DoubleSide });
    this.shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x211715, transparent: true, opacity: 0.64, depthWrite: false });
    this.rockMaterial = new THREE.MeshStandardMaterial({ color: 0x715b46, roughness: 1, flatShading: true });
    this.crackMaterial = new THREE.MeshBasicMaterial({ color: 0x30231c, side: THREE.DoubleSide, depthWrite: false });
    this.slideMaterial = new THREE.MeshBasicMaterial({ color: 0x4a3021, transparent: true, opacity: 0.38,
      side: THREE.DoubleSide, depthWrite: false });
    this.circleGeometry = new THREE.CircleGeometry(1, 40);
    this.ringGeometry = new THREE.RingGeometry(0.88, 1, 40);
    this.earthWave = new DeanEarthWave(this.effects, this.rockMaterial, this.crackMaterial);
    this.stripGeometry = new THREE.BufferGeometry();
    this.stripGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.stripGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.floorWarning = new THREE.Mesh(this.ringGeometry, this.warningMaterial);
    this.floorWarning.rotation.x = -Math.PI / 2;
    this.floorWarning.position.y = 0.055;
    this.floorWarning.visible = false;
    this.effects.add(this.floorWarning);
    this.centerMarker = new THREE.Mesh(this.ringGeometry, this.centerMaterial);
    this.centerMarker.rotation.x = -Math.PI / 2;
    this.centerMarker.position.y = 0.05;
    this.centerMarker.scale.setScalar(4.5);
    this.centerMarker.visible = false;
    this.effects.add(this.centerMarker);
    this.shadow = new THREE.Mesh(this.circleGeometry, this.shadowMaterial);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.04;
    this.shadow.visible = false;
    this.effects.add(this.shadow);
    this.aimStrip = new THREE.Mesh(this.stripGeometry, this.warningMaterial);
    this.aimStrip.visible = false;
    this.effects.add(this.aimStrip);
    this.enrageLight = new THREE.PointLight(0xf12919, 0, 6);
    this.enrageLight.position.set(0, 1.5, 0);
    dean.group.add(this.enrageLight);
    this.dean.health = 300;
    this.dean.maxHealth = 300;
  }

  start(player) {
    if (this.phase !== 'waiting') return;
    this.phase = 'approach';
    this.centerMarker.visible = false;
    this.warning = 'THE DEAN IS COMING';
    this.dean._playAction('Run');
    // The final wave is over; the player gets enough ammunition to fight the boss.
    if (typeof player.ammo === 'number') player.ammo = Math.min(player.maxAmmo ?? 120, Math.max(player.ammo, 45));
  }

  takeDamage(amount) {
    if (this.phase !== 'combat' || !this.dean.alive) return false;
    const died = this.dean.takeDamage(amount);
    if (died) {
      this.phase = 'defeated';
      this.warning = '';
      this.floorWarning.visible = this.shadow.visible = this.aimStrip.visible = false;
      this._clearRocks();
      this.enrageLight.intensity = 0;
      this.dean.group.position.y = 0;
      this._setButtPose(0);
    } else if (!this.enraged && this.dean.health <= this.dean.maxHealth * 0.4) {
      this.enraged = true;
      this.enrageNoticeTime = 2.2;
      this.warning = 'THE DEAN IS ENRAGED';
      this.cooldown = Math.min(this.cooldown, 0.16);
      this.enrageLight.intensity = 1.7;
      this.warningMaterial.color.setHex(0xff352b);
      if (this.move) this.dean.actions[`Dean ${this.move.name}`]?.setEffectiveTimeScale(1.28);
    }
    return died;
  }

  update(dt, player) {
    if (this.phase === 'waiting' || this.phase === 'defeated') return;
    const boss = this.dean.group.position, target = player.group.position;
    this.enrageNoticeTime = Math.max(0, this.enrageNoticeTime - dt);
    if (this.phase === 'approach') {
      const toward = directionTo(boss, CENTER);
      const step = Math.min(flatDistance(boss, CENTER), 11 * dt);
      boss.addScaledVector(toward, step);
      boss.y = THREE.MathUtils.lerp(boss.y, 0, Math.min(1, 5 * dt));
      this.dean.group.lookAt(target.x, boss.y, target.z);
      if (flatDistance(boss, CENTER) < 0.08) {
        boss.copy(CENTER);
        this.phase = 'introEnd';
        this.introTime = 0;
        this.warning = 'THE DEAN LOCKED ON';
        this.dean._playAction('Idle');
      }
      return;
    }
    if (this.phase === 'introEnd') {
      this.introTime += dt;
      this.dean.group.lookAt(target.x, boss.y, target.z);
      if (this.introTime >= 0.85) {
        this.phase = 'combat';
        this.cooldown = 0.6;
        this.warning = '';
      }
      return;
    }

    this._updateRocks(dt, player);
    if (this.move) {
      this._updateMove(dt, player);
      return;
    }
    this._face(target, dt);
    const distance = flatDistance(boss, target);
    if (distance > 6) {
      const step = Math.min(distance - 6, (this.enraged ? 6.8 : 4.4) * dt);
      boss.addScaledVector(directionTo(boss, target), step);
      this.dean._playAction('Run');
    } else this.dean._playAction('Idle', 0.2);
    this.cooldown -= dt;
    if (this.cooldown <= 0) this._beginMove(player);
  }

  _beginMove(player) {
    const close = flatDistance(this.dean.group.position, player.group.position) <= 3.1;
    const pool = close ? CLOSE_MOVES : FAR_MOVES;
    const index = close ? this.closeMoveIndex++ : this.farMoveIndex++;
    this.move = MOVES.find(move => move.name === pool[index % pool.length]);
    this.moveTime = 0;
    this.slideStopped = false;
    this.slideMarkTime = 0;
    this.hitWindows.clear();
    this.aim = player.group.position.clone();
    this.aim.y = 0;
    this.leapOrigin = this.dean.group.position.clone();
    this.direction = directionTo(this.dean.group.position, this.aim);
    this.warning = this.move.name.toUpperCase();
    this.floorWarning.visible = true;
    const leap = this.move.name === 'Shadow leap';
    this.floorWarning.position.set(leap ? this.aim.x : this.dean.group.position.x, 0.055,
      leap ? this.aim.z : this.dean.group.position.z);
    this.floorWarning.scale.setScalar(leap || this.move.name === 'Ground smash' ? 3.1 : 2.35);
    this.shadow.visible = this.move.name === 'Shadow leap';
    if (this.shadow.visible) {
      this.shadow.position.set(this.aim.x, 0.04, this.aim.z);
      this.shadow.scale.setScalar(2.7);
    }
    this.aimStrip.visible = ['Charging uppercut', 'Fist slide', 'Rush punches', 'Ground smash'].includes(this.move.name);
    if (this.aimStrip.visible) this._updateAimStrip();
    const actionName = `Dean ${this.move.name}`;
    const action = this.dean.actions[actionName];
    if (action) {
      action.setEffectiveTimeScale(this.enraged ? 1.28 : 1);
      this.dean._playAction(actionName, 0.12, true);
    } else if (leap) this.dean._playAction('Jump', 0.15, true);
    else this._playPunch(this.move.name === 'Fist slide' || this.move.name === 'Rush punches' ? 'Run_Attack' : 'Punch');
  }

  _face(target, dt) {
    const position = this.dean.group.position;
    if (flatDistance(position, target) < 0.01) return;
    this.turnQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(target.x - position.x, target.z - position.z));
    this.dean.group.quaternion.rotateTowards(this.turnQuaternion, dt * 7);
  }

  _updateAimStrip() {
    const start = this.dean.group.position;
    const end = this.move?.name === 'Fist slide' && flatDistance(start, this.aim) > 24
      ? start.clone().addScaledVector(directionTo(start, this.aim), 24) : this.aim;
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz) || 1, sideX = -dz / length * 0.28, sideZ = dx / length * 0.28;
    const positions = this.stripGeometry.getAttribute('position');
    positions.setXYZ(0, start.x + sideX, 0.065, start.z + sideZ);
    positions.setXYZ(1, start.x - sideX, 0.065, start.z - sideZ);
    positions.setXYZ(2, end.x - sideX, 0.065, end.z - sideZ);
    positions.setXYZ(3, end.x + sideX, 0.065, end.z + sideZ);
    positions.needsUpdate = true;
    this.stripGeometry.computeBoundingSphere();
  }

  _updateMove(dt, player) {
    const scaledDt = dt * (this.enraged ? 1.28 : 1);
    const last = this.moveTime;
    this.moveTime = Math.min(this.move.duration, this.moveTime + scaledDt);
    const t = this.moveTime;
    const boss = this.dean.group.position;
    const name = this.move.name;
    if (t < this.move.windup && name !== 'Shadow leap') {
      this.direction.copy(directionTo(boss, player.group.position));
      this.aim.copy(player.group.position); this.aim.y = 0;
      if (this.aimStrip.visible) this._updateAimStrip();
      this._face(player.group.position, scaledDt);
    }
    this.floorWarning.material.opacity = 0.27 + 0.2 * Math.sin(t * 19) ** 2;
    if (name !== 'Shadow leap') this.floorWarning.position.set(boss.x, 0.055, boss.z);
    if (name === 'Double jab' || name === 'Sweeping hook') {
      const stepTime = Math.max(0, Math.min(t, this.move.windup) - last);
      const reach = name === 'Double jab' ? 1.65 : 1.8;
      const gap = flatDistance(boss, player.group.position) - reach;
      if (stepTime > 0 && gap > 0) boss.addScaledVector(directionTo(boss, player.group.position), Math.min(gap, 5 * stepTime));
    }

    if (name === 'Double jab') {
      for (const [start, end] of [[0.19, 0.34], [0.48, 0.65]]) {
        const stepTime = Math.max(0, Math.min(t, end) - Math.max(last, start));
        boss.addScaledVector(this.direction, Math.min(stepTime * 2, Math.max(0, flatDistance(boss, this.aim) - 1.3)));
      }
      this._strikeAt('jab1', 0.34, last, t, player, 2.25, 8, 0.45);
      this._strikeAt('jab2', 0.65, last, t, player, 2.35, 9, 0.45);
    } else if (name === 'Sweeping hook') {
      this._strikeAt('hook', 0.55, last, t, player, 2.8, 17, -0.15);
    } else if (name === 'Charging uppercut') {
      const chargeTime = Math.max(0, Math.min(t, 0.62) - Math.max(last, 0.4));
      if (chargeTime) boss.addScaledVector(this.direction, Math.min(15 * chargeTime, Math.max(0, flatDistance(boss, this.aim) - 1.1)));
      this._strikeAt('uppercut', 0.6, last, t, player, 2.2, 20, 0.2);
    } else if (name === 'Fist slide') {
      const slideTime = this.slideStopped ? 0 : Math.max(0, Math.min(t, 1.45) - Math.max(last, 0.55));
      if (slideTime > 0) {
        const previous = boss.clone();
        boss.addScaledVector(this.direction, 28 * slideTime);
        boss.x = THREE.MathUtils.clamp(boss.x, -44, 44);
        boss.z = THREE.MathUtils.clamp(boss.z, -44, 44);
        for (let markTime = 0.11 - this.slideMarkTime; markTime <= slideTime; markTime += 0.11) {
          const markPosition = previous.clone().lerp(boss, markTime / slideTime);
          this._spawnSlideMark(markPosition);
        }
        this.slideMarkTime = (this.slideMarkTime + slideTime) % 0.11;
        if (!player.isDodging && segmentDistance(player.group.position, previous, boss) < 1.75) {
          this._hitOnce('slide', player, 22);
          this.slideStopped = true;
          this.slideStopTime = t;
        }
        if (Math.abs(boss.x) >= 44 || Math.abs(boss.z) >= 44) {
          this.slideStopped = true;
          this.slideStopTime = t;
        }
      }
      const recovery = this.slideStopped ? this.slideStopTime : 1.45;
      const pose = t < 0.55 ? THREE.MathUtils.smoothstep(t, 0.15, 0.55) * 0.7
        : 1 - THREE.MathUtils.smoothstep(t, recovery, recovery + 0.42);
      this._setSlidePose(pose);
    } else if (name === 'Shadow leap') {
      if (last < 0.55 && t >= 0.55) this.dean._playAction('Jump_Idle', 0.1);
      if (t >= 0.55 && t < 1.55) {
        const flight = (t - 0.55) / 1;
        boss.x = THREE.MathUtils.lerp(this.leapOrigin.x, this.aim.x, flight);
        boss.z = THREE.MathUtils.lerp(this.leapOrigin.z, this.aim.z, flight);
        boss.y = Math.sin(Math.PI * flight) * 6.5;
        this._setButtPose(THREE.MathUtils.smoothstep(flight, 0.55, 0.95));
        this.shadow.material.opacity = 0.42 + flight * 0.42;
        this.shadow.scale.setScalar(2.7 * (1.2 - flight * 0.2));
      }
      if (last < 1.55 && t >= 1.55) {
        boss.set(this.aim.x, 0, this.aim.z);
        this.dean._playAction('Jump_Land', 0.08, true);
        this.shadow.visible = false;
        this._setButtPose(1);
        this._fractureGround();
        this._radialHit(player, 3.0, 24);
      }
      if (t >= 1.55) this._setButtPose(1 - THREE.MathUtils.smoothstep(t, 1.65, 2.22));
    } else if (name === 'Rush punches') {
      for (const [i, start] of [0.44, 0.86, 1.28].entries()) {
        if (last < start && t >= start) {
          this.aim.copy(player.group.position); this.aim.y = 0;
          this.direction.copy(directionTo(boss, this.aim));
          this._updateAimStrip();
          this._face(this.aim, 0.12);
        }
        const burstTime = Math.max(0, Math.min(t, start + 0.21) - Math.max(last, start));
        if (burstTime > 0) {
          boss.addScaledVector(this.direction, Math.min(22 * burstTime, Math.max(0, flatDistance(boss, this.aim) - 1.1)));
          const facing = directionTo(boss, player.group.position).dot(this.direction);
          if (t >= start + 0.11 && flatDistance(boss, player.group.position) < 1.8 && facing > -0.45) this._hitOnce(`rush${i}`, player, 10);
        }
      }
    } else if (name === 'Ground smash') {
      if (last < 0.78 && t >= 0.78) {
        this._radialHit(player, 2.8, 18);
        this._fractureGround();
        this._launchRocks();
      }
    }
    if (t >= this.move.duration) {
      boss.y = 0;
      this._setButtPose(0);
      this.floorWarning.visible = this.shadow.visible = this.aimStrip.visible = false;
      this.move = null;
      this.warning = '';
      this.cooldown = this.enraged ? 0.12 : 0.48;
      this.dean._playAction('Idle', 0.2);
    }
  }

  _setButtPose(strength) {
    if (!this.model) return;
    this.model.rotation.x = this.modelRestPitch + 1.08 * strength;
    this.model.position.y = this.modelRestY - 0.42 * strength;
  }

  _setSlidePose(strength) {
    if (!this.model) return;
    this.model.rotation.x = this.modelRestPitch - 0.46 * strength;
    this.model.position.y = this.modelRestY - 0.22 * strength;
  }

  _spawnSlideMark(position) {
    const mesh = new THREE.Mesh(this.circleGeometry, this.slideMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(this.direction.x, this.direction.z);
    mesh.position.set(position.x, 0.075, position.z);
    mesh.scale.set(0.35, 0.8, 1);
    this.effects.add(mesh);
    this.slideMarks.push({ mesh, age: 0 });
  }

  _playPunch(name) {
    const action = this.dean.actions[name] || this.dean.actions.Punch;
    if (!action) return;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    this.dean._playAction(this.dean.actions[name] ? name : 'Punch', 0.1, true);
  }

  _strikeAt(key, strikeTime, last, now, player, radius, damage, arc) {
    if (last >= strikeTime || now < strikeTime) return;
    const boss = this.dean.group.position, target = player.group.position;
    if (flatDistance(boss, target) <= radius && directionTo(boss, target).dot(this.direction) > arc) this._hitOnce(key, player, damage);
  }

  _radialHit(player, radius, damage) {
    if (flatDistance(this.dean.group.position, player.group.position) <= radius) this._hitOnce('impact', player, damage);
  }

  _hitOnce(key, player, damage) {
    if (this.hitWindows.has(key)) return;
    this.hitWindows.add(key);
    if (!player.isDodging) player.takeDamage(damage * (this.enraged ? 1.25 : 1), { type: 'blunt', source: this.dean.group.position });
  }

  _launchRocks() {
    this.earthWave.launch(this.dean.group.position, this.direction, this.enraged);
  }

  _fractureGround() {
    const center = this.dean.group.position;
    const positions = [];
    for (let ray = 0; ray < 9; ray++) {
      const angle = ray / 9 * Math.PI * 2 + 0.15;
      const direction = new THREE.Vector2(Math.sin(angle), Math.cos(angle));
      const sideways = new THREE.Vector2(-direction.y, direction.x);
      let start = 0.42;
      for (let segment = 0; segment < 3; segment++) {
        const end = start + 0.85 + (ray % 3) * 0.2;
        const offset = Math.sin(ray * 3 + segment * 4) * 0.18;
        const width = 0.1 + (2 - segment) * 0.045;
        const x1 = center.x + direction.x * start + sideways.x * offset;
        const z1 = center.z + direction.y * start + sideways.y * offset;
        const x2 = center.x + direction.x * end + sideways.x * (offset + Math.sin(ray + segment) * 0.2);
        const z2 = center.z + direction.y * end + sideways.y * (offset + Math.sin(ray + segment) * 0.2);
        const a = [x1 + sideways.x * width, 0.07, z1 + sideways.y * width];
        const b = [x1 - sideways.x * width, 0.07, z1 - sideways.y * width];
        const c = [x2 - sideways.x * width * 0.65, 0.07, z2 - sideways.y * width * 0.65];
        const d = [x2 + sideways.x * width * 0.65, 0.07, z2 + sideways.y * width * 0.65];
        positions.push(...a, ...b, ...c, ...a, ...c, ...d);
        start = end;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geometry, this.crackMaterial);
    this.effects.add(mesh);
    this.cracks.push({ mesh, age: 0 });
  }

  _updateRocks(dt, player) {
    for (let i = this.slideMarks.length - 1; i >= 0; i--) {
      const mark = this.slideMarks[i];
      mark.age += dt;
      if (mark.age > 1.1) {
        mark.mesh.removeFromParent();
        this.slideMarks.splice(i, 1);
      }
    }
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const crack = this.cracks[i];
      crack.age += dt;
      if (crack.age > 3.5) {
        crack.mesh.removeFromParent(); crack.mesh.geometry.dispose(); this.cracks.splice(i, 1);
      }
    }
    this.earthWave.update(dt, player);
  }

  _clearRocks() {
    this.earthWave.clear();
    for (const crack of this.cracks) { crack.mesh.removeFromParent(); crack.mesh.geometry.dispose(); }
    this.cracks.length = 0;
    for (const mark of this.slideMarks) mark.mesh.removeFromParent();
    this.slideMarks.length = 0;
  }

  dispose() {
    this._clearRocks();
    this._setButtPose(0);
    this.enrageLight.removeFromParent();
    this.effects.removeFromParent();
    this.earthWave.dispose();
    for (const clip of this.attackClips) {
      this.dean.actions[clip.name]?.stop();
      this.dean.mixer?.uncacheClip(clip);
      delete this.dean.actions[clip.name];
    }
    for (const resource of [this.warningMaterial, this.shadowMaterial, this.rockMaterial, this.crackMaterial, this.slideMaterial,
      this.centerMaterial, this.circleGeometry, this.ringGeometry, this.stripGeometry]) resource.dispose();
  }
}
