import * as THREE from 'three';
import { MonsterBossMotion } from './MonsterBossMotion.js';
import { MonsterDegreeFlight } from './MonsterDegreeFlight.js';
import { MonsterRockWaves } from './MonsterRockWaves.js';
import { createMonsterCorpseObstacles } from './MonsterCorpse.js';
import { MonsterVocals } from '../audio/MonsterVocals.js';

const Y = new THREE.Vector3(0, 1, 0);
const ANGLES = [-Math.PI / 4, 0, Math.PI / 4];
const RELEASE = 0.8, TAKEOFF = 0.16, LAND_RECOVERY = 0.34, GRAVITY = 20;
const ATTACK_SPEED = 1.2;
const SPIN_DURATION = 0.95, SLAM_TAKEOFF = 0.3, SLAM_FLIGHT = 1.7;
export const MONSTER_SLAM_RADIUS = 9.5;

/** A returning degree, tracking smash combo, close spinning punch, and heavy body slam. */
export class MonsterBoss {
  constructor(root, monster, degreeCatch, rocks = null) {
    this.monster = monster; this.group = monster.group; this.isBoss = true;
    this.phase = 'waiting'; this.health = this.maxHealth = 600; this.alive = true;
    this.enraged = false; this.enragePending = false; this.enrageComplete = false; this.tempo = 1;
    this.meleeHeight = 2.2; this.bodyRadius = 1.2;
    this.motion = new MonsterBossMotion(monster, degreeCatch);
    this.degree = new MonsterDegreeFlight(root, degreeCatch.scroll, degreeCatch.grip);
    this.rocks = rocks || new MonsterRockWaves(root);
    this.state = 'idle'; this.time = 0; this.cooldown = 0.9; this.attackIndex = 0; this.impacts = 0;
    this.obstacle = { x: 0, z: 0, radius: 1.5 };
    this.previousFist = new THREE.Vector3(); this.spinHit = false;
    this.moveVelocity = new THREE.Vector3();
    this.vocals = new MonsterVocals(globalThis.__thesisAudioManager, this.group.position);
    this.group.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      mesh.frustumCulled = false;
      // Include the overhead hands and crouch in raycast broad-phase bounds.
      if (mesh.boundingBox) {
        mesh.boundingBox.expandByScalar(mesh.boundingBox.getSize(new THREE.Vector3()).y * 0.5);
        mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(new THREE.Sphere());
      }
    });
  }

  start() { if (this.phase === 'waiting') { this.phase = 'combat'; this.vocals.start(); } }

  takeDamage(amount) {
    if (this.phase !== 'combat' || !this.alive || !Number.isFinite(amount) || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) {
      if (!this.enraged && this.health <= this.maxHealth * 0.4) {
        this.enraged = true; this.enragePending = true;
        this.cooldown = Math.min(this.cooldown, 0.04);
      }
      return false;
    }
    this.alive = false; this.phase = 'dying'; this.time = 0;
    this.vocals.die();
    this.deathRotation = this.group.quaternion.clone();
    this.fallVelocity = 0;
    this.degree.clear(); this.rocks.clear(); return true;
  }

  update(dt, player) {
    if (this.phase === 'waiting' || this.phase === 'defeated' || this.disposed) return;
    if (player.alive === false) { this.vocals.stop(); this.degree.clear(); this.rocks.clear(); return; }
    // Advance contacts and events in bounded steps, including at low frame rates.
    let remaining = Math.max(0, dt);
    while (remaining > 1e-8) {
      const step = Math.min(1 / 60, remaining); remaining -= step; this._step(step, player);
      if (player.alive === false || this.phase === 'defeated') break;
    }
    this.obstacle.x = this.group.position.x; this.obstacle.z = this.group.position.z;
    if (player.alive === false) this.vocals.stop();
    else this.vocals.update(dt);
  }

  _step(dt, player) {
    if (this.phase === 'dying') {
      this.fallVelocity -= GRAVITY * dt;
      this.group.position.y = Math.max(0, this.group.position.y + this.fallVelocity * dt);
      this.time += dt;
      this.group.quaternion.copy(this.deathRotation).multiply(new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), -Math.PI / 2 * THREE.MathUtils.smootherstep(this.time, 0.25, 1.7)));
      this.motion.update('dying', this.time, dt);
      // Refresh the skin's inverse bind transform before measuring floor contact after a root roll.
      this.group.updateMatrixWorld(true);
      const floor = new THREE.Box3().setFromObject(this.group, true).min.y;
      if (this.deathGrounded || floor < 0.025) {
        this.group.position.y += 0.025 - floor; this.deathGrounded = true; this.fallVelocity = 0;
        this.group.updateMatrixWorld(true);
      }
      this.corpseObstacles = createMonsterCorpseObstacles(this.monster);
      if (this.time >= 2) this.phase = 'defeated'; return;
    }
    // Ease into the faster cadence rather than snapping an arm pose on the threshold frame.
    this.tempo = THREE.MathUtils.lerp(this.tempo, this.enrageComplete ? 1.35 : 1, 1 - Math.exp(-6 * dt));
    this.rocks.update(dt, player);
    if (player.alive === false) { this.degree.clear(); this.rocks.clear(); return; }
    if (this.enragePending && this.state === 'idle') {
      this.enragePending = false; this.state = 'enrage'; this.time = 0; this.chestBeats = 0;
      this.vocals.enrage();
    }
    if (this.state === 'idle') {
      const delta = player.group.position.clone().sub(this.group.position).setY(0);
      if (delta.lengthSq() > 0.01) {
        const target = new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(delta.x, delta.z));
        this.group.quaternion.slerp(target, 1 - Math.exp(-8 * dt));
      }
      // Close the distance on actual footfalls, accelerating smoothly into a brisk
      // approach instead of rotating a rigid stance and teleporting into a leap.
      const distance = delta.length();
      const desired = delta.clone().normalize().multiplyScalar(
        Math.min(this.enraged ? 7.2 : 5.6, Math.max(0, distance - 7) * 3)
          * THREE.MathUtils.smoothstep(this.cooldown, 0, 0.22));
      this.moveVelocity.lerp(desired, 1 - Math.exp(-10 * dt));
      const before = this.group.position.clone();
      this.group.position.addScaledVector(this.moveVelocity, dt);
      this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -42, 42);
      this.group.position.z = THREE.MathUtils.clamp(this.group.position.z, -42, 42);
      const travel = this.group.position.distanceTo(before);
      this.motion.walkDistance += travel; this.motion.moveSpeed = travel / dt;
      this.motion.update('idle', 0, dt); this.cooldown -= dt * this.tempo;
      if (this.cooldown <= 0) {
        const choices = delta.lengthSq() < 6 ** 2 ? ['spin', 'spin', 'slam', 'smash']
          : delta.lengthSq() > 24 ** 2 ? ['throw', 'throw', 'slam', 'smash', 'spin'] : ['throw', 'smash', 'slam', 'spin'];
        let attack = !this.enraged && this.attackIndex === 0 ? (delta.lengthSq() < 6 ** 2 ? 'spin' : 'throw')
          : !this.enraged && this.attackIndex === 1 ? 'smash' : choices[Math.floor(Math.random() * choices.length)];
        if (attack === this.lastAttack && this.attackRepeats >= 2) {
          const alternatives = choices.filter(choice => choice !== attack);
          attack = alternatives[Math.floor(Math.random() * alternatives.length)];
        }
        this.attackRepeats = attack === this.lastAttack ? this.attackRepeats + 1 : 1;
        this.lastAttack = this.state = attack; this.attackIndex++;
        this.time = 0; this.impacts = 0; this.released = false;
        this.aim = player.group.position.clone();
        const toward = this.aim.clone().sub(this.group.position).setY(0);
        if (toward.lengthSq() < 0.01) toward.set(0, 0, 1);
        this.direction = toward.normalize();
        if (this.state === 'smash') this._beginJump(player);
        else if (this.state === 'spin') this._beginSpinApproach(player);
        else if (this.state === 'slam') this._beginSlam(player);
      }
      return;
    }
    const inSlamFlight = this.state === 'slam' && this.time >= SLAM_TAKEOFF && this.time < SLAM_TAKEOFF + SLAM_FLIGHT;
    this.time += dt * (inSlamFlight ? 1 : this.tempo);
    if (this.state === 'enrage') {
      this.motion.update('enrage', this.time, dt);
      const contacts = [0.4, 0.75, 1.1];
      while (this.chestBeats < contacts.length && this.time >= contacts[this.chestBeats]) {
        this._sound('chest', this.motion.arms[1].hand.getWorldPosition(new THREE.Vector3()));
        this.chestBeats++;
      }
      if (this.time >= 1.5) { this.enrageComplete = true; this._finishAttack(0.04); }
    } else if (this.state === 'throw') {
      const wasActive = this.degree.active;
      this.motion.update('throw', this.time * ATTACK_SPEED, dt, 0, this.released ? 0 : 1);
      if (!this.released && this.time * ATTACK_SPEED >= RELEASE) {
        this.degree.launch(this.aim); this.released = true;
        this._sound('throw', this.degree.position);
      }
      this.degree.update(dt * this.tempo, player);
      if (player.alive === false) { this.degree.clear(); this.rocks.clear(); return; }
      if (wasActive && !this.degree.active) { this.state = 'recover'; this.time = 0; this._sound('catch', this.group.position); }
    } else if (this.state === 'smash') {
      this._updateJump(dt, player);
    } else if (this.state === 'spinApproach') {
      this._updateSpinApproach(dt, player);
    } else if (this.state === 'spin') {
      this._updateSpin(dt, player);
    } else if (this.state === 'slam') {
      this._updateSlam(dt, player);
    } else if (this.state === 'recover') {
      this.motion.update('recover', this.time * ATTACK_SPEED, dt, 0, THREE.MathUtils.smoothstep(this.time, 0, 0.16));
      if (this.time >= (this.enraged ? 0.28 : 0.5)) this._finishAttack(0.25);
    }
  }

  _finishAttack(cooldown) {
    this.moveVelocity.set(0, 0, 0); this.motion.moveSpeed = 0;
    this.state = 'idle'; this.cooldown = this.enraged ? 0.04 : cooldown;
  }

  _beginSpinApproach(player) {
    this.vocals.attack('rush');
    this.state = 'spinApproach'; this.time = 0; this.rushCommitted = false; this.rushBraking = false;
    this.rushTarget = player.group.position.clone().setY(0);
  }

  _updateSpinApproach(dt, player) {
    const position = this.group.position;
    if (!this.rushCommitted) {
      this.rushTarget.copy(player.group.position).setY(0);
      if (position.distanceTo(this.rushTarget) < 5.6) this.rushCommitted = true;
    }
    if (this.time >= 2.2) { this.rushCommitted = true; this.rushBraking = true; }
    const toward = this.rushTarget.clone().sub(position).setY(0), distance = toward.length();
    const direction = toward.normalize();
    const speed = this.rushBraking ? 0 : Math.min(this.enraged ? 12 : 10, Math.sqrt(2 * 26 * Math.max(0, distance - 2.5)));
    const desired = direction.clone().multiplyScalar(speed), change = desired.sub(this.moveVelocity);
    this.moveVelocity.addScaledVector(change, Math.min(1, 26 * dt / Math.max(1e-8, change.length())));
    if (distance > 0.01) this.group.quaternion.rotateTowards(
      new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(direction.x, direction.z)), 7 * dt);
    const travel = this.moveVelocity.clone().multiplyScalar(dt);
    if (travel.length() > Math.max(0, distance - 2.5)) travel.setLength(Math.max(0, distance - 2.5));
    position.add(travel);
    position.x = THREE.MathUtils.clamp(position.x, -42, 42); position.z = THREE.MathUtils.clamp(position.z, -42, 42);
    this.motion.walkDistance += travel.length(); this.motion.moveSpeed = travel.length() / dt;
    this.motion.update('sprint', this.time, dt);
    if ((distance < 2.75 || this.rushBraking) && this.moveVelocity.length() < 0.5) {
      this.moveVelocity.set(0, 0, 0); this.motion.moveSpeed = 0;
      this.state = 'spin'; this.time = 0; this._beginSpin();
    }
  }

  _beginSpin() {
    this.spinHit = false; this.spinWhoosh = false; this.spinRotation = this.group.quaternion.clone();
    // Pivot around the supporting foot, so the feet don't both skate around the center.
    const feet = this.motion.legs.map(leg => this.group.worldToLocal(leg.foot.getWorldPosition(new THREE.Vector3())));
    this.motion.spinSupport = feet[0].y < feet[1].y ? 0 : 1;
    this.motion.spinAnchor = feet[this.motion.spinSupport].clone();
    this.motion.spinAnchor.y = this.motion.legs[this.motion.spinSupport].anchor.y;
    this.spinFoot = this.motion.spinAnchor.clone().setY(0);
    this.spinPivot = this.group.localToWorld(this.spinFoot.clone());
    this.motion.update('spin', 0);
    this.previousFists = this.motion.arms.map(arm => arm.hand.getWorldPosition(new THREE.Vector3()));
    this.previousFist.copy(this.previousFists[1]);
  }

  _updateSpin(dt, player) {
    const progress = THREE.MathUtils.clamp(this.time / SPIN_DURATION, 0, 1);
    // Match the player's turning sword attack: gather, one full turn, then settle.
    const angle = Math.PI * 2 * THREE.MathUtils.smoothstep(progress, 0.08, 0.78);
    this.group.quaternion.copy(this.spinRotation).multiply(new THREE.Quaternion().setFromAxisAngle(Y, angle));
    const offset = this.spinFoot.clone().applyQuaternion(this.group.quaternion);
    this.group.position.x = this.spinPivot.x - offset.x;
    this.group.position.z = this.spinPivot.z - offset.z;
    this.motion.update('spin', this.time, dt);
    const fists = this.motion.arms.map(arm => arm.hand.getWorldPosition(new THREE.Vector3()));
    if (!this.spinHit && progress >= 0.23 && progress <= 0.82 && !player.isDodging) {
      const target = player.group.position.clone();
      target.y += 1.1;
      for (const [index, fist] of fists.entries()) {
        const path = new THREE.Line3(this.previousFists[index], fist);
        const contact = path.closestPointToPoint(target, true, new THREE.Vector3());
        // Both outstretched fists sweep visibly; one spin can still only hit once.
        const height = contact.y - player.group.position.y;
        if (height > 0.1 && height < 2 && Math.hypot(contact.x - target.x, contact.z - target.z) < 0.95) {
          this.spinHit = true; player.takeDamage(24, { type: 'blunt', source: contact });
          this._sound('punch', contact); break;
        }
      }
    }
    if (!this.spinWhoosh && progress >= 0.23) { this.spinWhoosh = true; this._sound('throw', fists[1]); }
    fists.forEach((fist, index) => this.previousFists[index].copy(fist));
    this.previousFist.copy(fists[1]);
    if (progress >= 1) { this._finishAttack(0.2); this.spinWhoosh = false; }
  }

  _beginSlam(player) {
    const from = this.group.position.clone().setY(0);
    const to = player.group.position.clone().setY(0), travel = to.clone().sub(from);
    if (travel.length() > 26) to.copy(from).addScaledVector(travel.normalize(), 26);
    to.x = THREE.MathUtils.clamp(to.x, -42, 42); to.z = THREE.MathUtils.clamp(to.z, -42, 42);
    this.slam = { from, to, impacted: false };
  }

  _updateSlam(dt, player) {
    if (this.time < SLAM_TAKEOFF) {
      this._beginSlam(player);
      const toward = player.group.position.clone().sub(this.group.position).setY(0);
      if (toward.lengthSq() > 0.01) this.group.quaternion.rotateTowards(
        new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(toward.x, toward.z)), 8 * dt);
      this.motion.update('slam', this.time / SLAM_TAKEOFF * 0.28, dt); return;
    }
    const flight = THREE.MathUtils.clamp((this.time - SLAM_TAKEOFF) / SLAM_FLIGHT, 0, 1);
    this.group.position.lerpVectors(this.slam.from, this.slam.to, flight);
    this.group.position.y = 0.5 * GRAVITY * SLAM_FLIGHT ** 2 * flight * (1 - flight);
    if (flight < 1) {
      // Push off with extended legs, tuck on ascent, and open into the seated landing on descent.
      const pose = flight < 0.25 ? THREE.MathUtils.lerp(0.28, 0.48, flight / 0.25)
        : flight < 0.55 ? THREE.MathUtils.lerp(0.48, 0.65, (flight - 0.25) / 0.3)
          : THREE.MathUtils.lerp(0.65, 1.05, (flight - 0.55) / 0.45);
      this.motion.update('slam', pose, dt, 0, 1, true); return;
    }
    const recovery = this.time - SLAM_TAKEOFF - SLAM_FLIGHT;
    this.motion.update('slam', 1.05 + recovery, dt);
    if (!this.slam.impacted) {
      this.slam.impacted = true;
      this.rocks.impact(this.group.position, MONSTER_SLAM_RADIUS);
      this._sound('smash', this.group.position);
      const target = player.group.position;
      if (!player.isDodging && target.y < 1.55 && target.y > -0.5
        && Math.hypot(target.x - this.group.position.x, target.z - this.group.position.z) <= MONSTER_SLAM_RADIUS) {
        player.takeDamage(32, { type: 'blunt', source: this.group.position.clone() });
      }
    }
    if (recovery >= 0.5) this._finishAttack(0.22);
  }

  _beginJump(player, age = 0) {
    const from = this.group.position.clone().setY(0);
    // Preserve the three approach angles, but center every landing on the live target.
    const lane = this.direction.clone().applyAxisAngle(Y, ANGLES[this.impacts]);
    const to = player.group.position.clone().setY(0).addScaledVector(lane, -4.8);
    const travel = to.clone().sub(from);
    if (travel.length() > 20) to.copy(from).addScaledVector(travel.normalize(), 20);
    to.x = THREE.MathUtils.clamp(to.x, -42, 42); to.z = THREE.MathUtils.clamp(to.z, -42, 42);
    if (to.distanceTo(from) < 2.6) {
      const side = new THREE.Vector3(lane.z, 0, -lane.x).multiplyScalar(this.impacts === 2 ? -3.2 : 3.2);
      to.add(side); to.x = THREE.MathUtils.clamp(to.x, -42, 42); to.z = THREE.MathUtils.clamp(to.z, -42, 42);
    }
    const toward = player.group.position.clone().sub(to).setY(0);
    if (toward.lengthSq() < 0.01) toward.copy(lane);
    toward.normalize();
    this.jump = { from, to, age, duration: THREE.MathUtils.clamp(from.distanceTo(to) / 28, 0.5, 0.7),
      direction: toward,
      landingRotation: new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(toward.x, toward.z)), impacted: false };
  }

  _updateJump(dt, player) {
    const jump = this.jump;
    const airborne = jump.age >= TAKEOFF && jump.age < TAKEOFF + jump.duration;
    jump.age += dt * (airborne ? 1 : this.tempo);
    if (jump.age < TAKEOFF) {
      // Retarget while his feet still push against the ground; never slide the landing point in midair.
      this._beginJump(player, jump.age);
      this.motion.update('smash', jump.age / TAKEOFF * 0.3, dt); return;
    }
    const u = THREE.MathUtils.clamp((jump.age - TAKEOFF) / jump.duration, 0, 1);
    this.group.position.lerpVectors(jump.from, jump.to, u);
    // Same gravity as the player; horizontal momentum stays constant in flight.
    this.group.position.y = 0.5 * GRAVITY * jump.duration ** 2 * u * (1 - u);
    if (!jump.impacted && u < 0.84) {
      const toward = player.group.position.clone().sub(this.group.position).setY(0);
      if (toward.lengthSq() > 0.01) {
        jump.direction.copy(toward).normalize();
        jump.landingRotation.setFromAxisAngle(Y, Math.atan2(toward.x, toward.z));
      }
    }
    // Turn smoothly through the leap, then commit just before the fists touch down.
    this.group.quaternion.rotateTowards(jump.landingRotation, 8 * dt);
    if (u < 1) {
      const poseTime = u < 0.45 ? THREE.MathUtils.lerp(0.3, 0.65, THREE.MathUtils.smootherstep(u, 0, 0.4))
        : THREE.MathUtils.lerp(0.65, 0.9, THREE.MathUtils.smootherstep(u, 0.45, 1));
      this.motion.update('smash', poseTime, dt); return;
    }
    const recovery = jump.age - TAKEOFF - jump.duration;
    // The pose curves already ease the rise; easing this clock again compresses
    // almost the entire stand-up into a few frames, especially when enraged.
    this.motion.update('smash', THREE.MathUtils.lerp(0.9, 1.6,
      THREE.MathUtils.clamp(recovery / LAND_RECOVERY, 0, 1)), dt);
    if (!jump.impacted) {
      jump.direction.set(0, 0, 1).applyQuaternion(this.group.quaternion).setY(0).normalize();
      this.rocks.launch(this.motion.impactPoint, jump.direction); jump.impacted = true; this.impacts++;
      this._sound('smash', this.motion.impactPoint);
    }
    if (recovery >= LAND_RECOVERY) {
      if (this.impacts < 3) this._beginJump(player);
      else this._finishAttack(0.25);
    }
  }

  _sound(kind, position) {
    if (kind === 'smash') this.vocals.attack('roar');
    const audio = globalThis.__thesisAudioManager;
    const clips = kind === 'throw' ? ['./assets/audio/sfx/weapon/artninja-sword-swing-01.ogg']
      : ['./assets/audio/sfx/weapon/melee-impact-1.ogg', './assets/audio/sfx/weapon/melee-impact-2.ogg'];
    audio?.playRandom(clips, { position, volume: kind === 'smash' ? 1 : 0.65,
      pitch: kind === 'smash' ? 0.65 : 0.8, category: 'sfx', group: 'monster-attacks', maxVoices: 3 });
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.vocals.stop();
    this.degree.dispose(); this.rocks.dispose(); this.motion.dispose();
  }
}
