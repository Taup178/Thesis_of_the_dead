import * as THREE from 'three';
import { weaponById } from './WeaponInventory.js';
import { SWORD_ATTACKS, SWORD_COMBO_WINDOW } from './SwordSwings.js';

const belongsTo = (object, group) => {
  for (let node = object; node; node = node.parent) if (node === group) return true;
  return false;
};

/** Moving bullets, gun strikes and collectible ammunition, shared by combat levels. */
export class WeaponCombat {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); this.root.name = 'PlayerCombatEffects'; scene.add(this.root);
    this.ray = new THREE.Raycaster(); this.center = new THREE.Vector2();
    this.bulletGeometry = new THREE.CylinderGeometry(0.018, 0.029, 0.25, 6);
    this.trailGeometry = new THREE.CylinderGeometry(0.009, 0.022, 0.7, 5);
    this.bulletMaterial = new THREE.MeshBasicMaterial({ color: 0xffedac, toneMapped: false });
    this.trailMaterial = new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.65, toneMapped: false });
    this.boxGeometry = new THREE.BoxGeometry(0.45, 0.26, 0.32);
    this.boxMaterial = new THREE.MeshStandardMaterial({ color: 0x405a39, roughness: 0.75, emissive: 0x244d12, emissiveIntensity: 0.6 });
    this.roundGeometry = new THREE.CylinderGeometry(0.035, 0.045, 0.22, 6);
    this.roundMaterial = new THREE.MeshStandardMaterial({ color: 0xdcb85d, metalness: 0.6, roughness: 0.35 });
    this.ringGeometry = new THREE.TorusGeometry(0.36, 0.02, 6, 24);
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: 0xa4ed73, toneMapped: false });
    this.reset();
  }

  reset() {
    this.root.clear(); this.projectiles = []; this.pickups = [];
    this.shootCooldown = 0; this.bashCooldown = 0; this.pendingBash = null; this.pendingMelee = null;
    this.cancelMelee(); this.attackClickHeld = false; this.weaponId = null;
    this.kills = 0; this.rewarded = new WeakSet(); this.notice = ''; this.noticeTime = 0; this.firstZombieHit = false;
  }

  cancelMelee() {
    this.pendingBash = null; this.pendingMelee = null;
    this.swordQueue = []; this.swordComboStep = 0; this.swordComboTime = 0;
  }

  update(dt, player, level, input, getTargets) {
    if (this.level !== level) { this.reset(); this.level = level; }
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.bashCooldown = Math.max(0, this.bashCooldown - dt);
    this.swordComboTime = Math.max(0, this.swordComboTime - dt);
    this.noticeTime = Math.max(0, this.noticeTime - dt);
    const held = input.isMouseButtonDown(0);
    const clicks = input.consumeMousePresses?.(0) ?? (held && !this.attackClickHeld ? 1 : 0);
    this.attackClickHeld = held;
    if (this.weaponId !== player.weapon) { this.cancelMelee(); this.weaponId = player.weapon; }
    if (level.allowsShooting === false || player.scriptedMovement || !player.alive || (!input.pointerLocked && !input.gamepadInUse)) {
      this.cancelMelee();
      for (const projectile of this.projectiles) projectile.mesh.removeFromParent();
      this.projectiles = []; return;
    }
    if (player.isDodging) {
      this.cancelMelee();
      input.consumeKeyPress?.('KeyF');
      this.updateProjectiles(dt, player, level, this.projectiles.length ? getTargets() : []);
      this.updatePickups(dt, player);
      return;
    }
    if (this.pendingBash) {
      this.pendingBash -= dt;
      if (this.pendingBash <= 0) {
        this.pendingBash = null;
        this.hitWithGun(player, level, getTargets(), this.pendingMelee);
        this.pendingMelee = null;
      }
    }
    const weapon = weaponById(player.weapon) || weaponById('smg');
    const bashPressed = input.consumeKeyPress?.('KeyF');
    if ((input.pointerLocked || input.gamepadInUse) && player.alive) {
      if (weapon.id === 'sword') {
        if (clicks || bashPressed) {
          if (this.swordComboTime === 0 || (this.swordComboStep === SWORD_ATTACKS.length
            && this.swordQueue.length === 0 && player.bashTime <= 0)) this.swordComboStep = 0;
        }
        for (let press = 0; press < Math.min(SWORD_ATTACKS.length, clicks + (bashPressed ? 1 : 0)); press++) {
          if (this.swordComboStep >= SWORD_ATTACKS.length
            || this.swordQueue.length + (player.bashTime > 0 ? 1 : 0) >= SWORD_ATTACKS.length) break;
          this.swordQueue.push(SWORD_ATTACKS[this.swordComboStep++]);
          this.swordComboTime = SWORD_COMBO_WINDOW;
        }
        const attack = this.swordQueue[0];
        const previous = player.swordAttack;
        const chain = attack && previous?.chainAt && player.bashTime > 0 && !this.pendingBash
          && previous.duration - player.bashTime >= previous.chainAt
          && SWORD_ATTACKS[SWORD_ATTACKS.indexOf(previous) + 1] === attack;
        if (attack && (chain || this.bashCooldown <= 0) && player.startMeleeAttack(attack, { chain: !!chain })) {
          this.swordQueue.shift();
          this.pendingMelee = { damage: attack.damage, reach: attack.reach, arc: attack.arc };
          this.pendingBash = attack.contact; this.bashCooldown = attack.cooldown;
        }
      } else if (weapon.type === 'melee') {
        if ((bashPressed || input.isMouseButtonDown(0)) && this.bashCooldown <= 0 && player.startMeleeAttack()) {
          this.pendingMelee = { damage: weapon.damage, reach: weapon.reach, arc: weapon.arc };
          this.pendingBash = weapon.id === 'sword' ? 0.28 : 0.16;
          this.bashCooldown = weapon.cooldown;
        }
      } else if (bashPressed || input.isMouseButtonDown(0) && player.ammo === 0 && !level.hasUnlimitedAmmo?.(weapon.id)) {
        if (this.bashCooldown <= 0 && player.startGunBash()) {
          this.pendingMelee = null;
          this.pendingBash = 0.22; this.bashCooldown = 0.75;
        }
      } else if ((input.isMouseButtonDown(0) || weapon.id === 'dual' && input.isMouseButtonDown(2))
        && this.shootCooldown <= 0 && player.bashTime <= 0) {
        const single = weapon.id === 'dual' && !input.isMouseButtonDown(0) && input.isMouseButtonDown(2);
        this.fire(player, getTargets(), single ? 1 : null);
      }
    }
    this.updateProjectiles(dt, player, level, this.projectiles.length ? getTargets() : []);
    this.updatePickups(dt, player);
  }

  fire(player, targets, requestedShots = null) {
    const weapon = weaponById(player.weapon) || weaponById('smg');
    const unlimited = this.level?.hasUnlimitedAmmo?.(weapon.id) === true;
    if (!player.alive || player.isDodging || (!unlimited && player.ammo <= 0) || player.bashTime > 0 || this.shootCooldown > 0) return false;
    if (weapon.type !== 'gun') return false;
    player.camera.updateMatrixWorld(true);
    this.ray.near = 0; this.ray.far = 100; this.ray.setFromCamera(this.center, player.camera);
    const aimHit = this.ray.intersectObjects(targets, false)[0];
    const destination = aimHit?.point || this.ray.ray.at(100, new THREE.Vector3());
    const shots = unlimited ? (requestedShots ?? weapon.ammo) : Math.min(player.ammo, requestedShots ?? weapon.ammo);
    for (let i = 0; i < shots; i++) {
      const hand = weapon.id === 'dual' && i === 1 ? 'left' : 'right';
      let origin = player.getMuzzleWorldPosition(hand), direction = destination.clone().sub(origin).normalize();
      // A barrel poking into nearby cover must hit that cover, even if the camera sees past it.
      if (player.group) {
        const grip = player.group.position.clone().add(new THREE.Vector3(0, 1.1, 0));
        const barrelDirection = origin.clone().sub(grip).normalize();
        this.ray.set(grip, barrelDirection); this.ray.far = grip.distanceTo(origin);
        const obstruction = this.ray.intersectObjects(targets, false)[0];
        if (obstruction) { origin = obstruction.point.clone().addScaledVector(barrelDirection, -0.03); direction = barrelDirection; }
      }
      const mesh = new THREE.Group();
      const bullet = new THREE.Mesh(this.bulletGeometry, this.bulletMaterial);
      const trail = new THREE.Mesh(this.trailGeometry, this.trailMaterial); trail.position.y = -0.42;
      mesh.add(bullet, trail); mesh.position.copy(origin);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction); this.root.add(mesh);
      this.projectiles.push({ mesh, direction, distance: 0, damage: weapon.damage });
    }
    if (!unlimited) player.ammo -= shots;
    player.shotTime = 0.14; player.aimTime = 0.38;
    player.weaponPresentation?.update(0);
    this.shootCooldown = weapon.cooldown;
    const audio = globalThis.__thesisAudioManager;
    if (weapon.id === 'smg') {
      audio?.playRandom(['./assets/audio/sfx/weapon/smg-bang-01.ogg', './assets/audio/sfx/weapon/smg-bang-02.ogg', './assets/audio/sfx/weapon/smg-bang-03.ogg'],
        { volume: 0.72, pitch: 0.96 + Math.random() * 0.08, category: 'sfx', group: 'weapon', maxVoices: 5 });
    } else {
      for (let i = 0; i < shots; i++) audio?.playRandom(['./assets/audio/sfx/weapon/pistol-bang-01.ogg', './assets/audio/sfx/weapon/pistol-bang-02.ogg'],
        { volume: 0.68, pitch: 0.96 + Math.random() * 0.08, category: 'sfx', group: 'weapon', maxVoices: 5, delay: i * 0.035 });
    }
    return true;
  }

  updateProjectiles(dt, player, level, targets) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bullet = this.projectiles[i], travel = Math.min(65 * dt, 100 - bullet.distance);
      this.ray.set(bullet.mesh.position, bullet.direction); this.ray.near = 0; this.ray.far = travel;
      const hit = this.ray.intersectObjects(targets, false)[0];
      if (hit) {
        if (!level.handleBulletHit?.(hit, bullet.damage ?? 15, player)) {
          const zombie = level.zombies.find(z => z.alive && z.group.visible && belongsTo(hit.object, z.group));
          if (zombie) {
            globalThis.__thesisAudioManager?.playRandom(['./assets/audio/sfx/weapon/bullet-impact-1.ogg', './assets/audio/sfx/weapon/bullet-impact-2.ogg'],
              { volume: 0.48, position: hit.point, category: 'sfx', group: 'weapon', maxVoices: 5 });
            this.damageZombie(zombie, bullet.damage ?? 15, player);
          }
        }
      } else { bullet.mesh.position.addScaledVector(bullet.direction, travel); bullet.distance += travel; }
      if (hit || bullet.distance >= 100) { bullet.mesh.removeFromParent(); this.projectiles.splice(i, 1); }
    }
  }

  hitWithGun(player, level, targets, attack = null) {
    const origin = player.group.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    const forward = player.getForwardDirection();
    const reach = attack?.reach ?? 2.25, arc = attack?.arc ?? 0.45;
    const candidates = [...level.zombies, ...(level.dean?.alive && level.bossFight?.phase === 'combat' ? [level.dean] : []),
      ...(level.monsterFight?.alive && level.monsterFight.phase === 'combat' ? [level.monsterFight] : [])]
      .filter(zombie => zombie.alive && zombie.group.visible)
      .map(zombie => ({ zombie, center: zombie.group.position.clone().add(new THREE.Vector3(0, zombie.meleeHeight ?? 1, 0)) }))
      .filter(({ zombie, center }) => center.distanceTo(origin) <= reach + (zombie.bodyRadius ?? 0)
        && center.clone().sub(origin).normalize().dot(forward) > arc)
      .sort((a, b) => a.center.distanceToSquared(origin) - b.center.distanceToSquared(origin));
    for (const { zombie, center } of candidates) {
      this.ray.set(origin, center.clone().sub(origin).normalize()); this.ray.near = 0; this.ray.far = Math.min(reach, origin.distanceTo(center) + 0.1);
      const hit = this.ray.intersectObjects(targets, false)[0];
      if (!hit || !belongsTo(hit.object, zombie.group)) continue;
      globalThis.__thesisAudioManager?.playRandom(['./assets/audio/sfx/weapon/melee-impact-1.ogg', './assets/audio/sfx/weapon/melee-impact-2.ogg'],
        { volume: zombie.isBoss ? 1 : 0.68, position: center, category: 'sfx', group: 'weapon', maxVoices: 5 });
      if (zombie.isBoss) level.handleMeleeHit?.(zombie, attack ? attack.damage : 20, player);
      else this.damageZombie(zombie, attack ? attack.damage : 30, player);
      return zombie;
    }
    return null;
  }

  damageZombie(zombie, damage, player) {
    const wasAlive = zombie.alive;
    const killed = zombie.takeDamage(damage);
    if (wasAlive && weaponById(player.weapon)?.type === 'gun') this.firstZombieHit = true;
    if (!killed || this.rewarded.has(zombie)) return;
    this.rewarded.add(zombie); player.addScore(200); this.kills++;
    // Every second defeated zombie guarantees supplies, while others leave no ammo.
    if (this.kills % 2 === 0) this.dropAmmo(zombie.group.position);
  }

  dropAmmo(position) {
    const group = new THREE.Group(); group.name = 'AmmoPickup'; group.position.set(position.x, 0.3, position.z);
    group.add(new THREE.Mesh(this.boxGeometry, this.boxMaterial));
    for (let i = 0; i < 4; i++) {
      const round = new THREE.Mesh(this.roundGeometry, this.roundMaterial); round.position.set((i - 1.5) * 0.09, 0.17, 0); group.add(round);
    }
    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = -0.22; group.add(ring);
    this.root.add(group); this.pickups.push({ group, amount: 12, age: 0 });
  }

  updatePickups(dt, player) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i]; pickup.age += dt;
      pickup.group.position.y = 0.3 + Math.sin(pickup.age * 3) * 0.06; pickup.group.rotation.y += dt * 0.55;
      if (!player.alive || player.scriptedMovement || player.ammo >= player.maxAmmo || pickup.group.position.distanceTo(player.group.position) > 1.4) continue;
      const amount = Math.min(pickup.amount, player.maxAmmo - player.ammo);
      player.ammo += amount; pickup.amount -= amount; this.notice = `+${amount} bullets`; this.noticeTime = 2;
      globalThis.__thesisAudioManager?.playRandom(['./assets/audio/sfx/collect/ammo-pickup-event-a.wav', './assets/audio/sfx/collect/ammo-pickup-event-b.wav'],
        { volume: 0.48, category: 'sfx', group: 'pickup', maxVoices: 1, cooldownKey: 'ammo-pickup', cooldown: 0.15 });
      if (pickup.amount === 0) { pickup.group.removeFromParent(); this.pickups.splice(i, 1); }
    }
  }

  dispose() {
    this.reset(); this.root.removeFromParent();
    for (const value of Object.values(this)) if (value?.isBufferGeometry || value?.isMaterial) value.dispose();
  }
}
