import * as THREE from 'three';

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
    this.shootCooldown = 0; this.bashCooldown = 0; this.pendingBash = null;
    this.kills = 0; this.rewarded = new WeakSet(); this.notice = ''; this.noticeTime = 0;
  }

  update(dt, player, level, input, getTargets) {
    if (this.level !== level) { this.reset(); this.level = level; }
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    this.bashCooldown = Math.max(0, this.bashCooldown - dt);
    this.noticeTime = Math.max(0, this.noticeTime - dt);
    if (level.allowsShooting === false || player.scriptedMovement) {
      this.pendingBash = null;
      for (const projectile of this.projectiles) projectile.mesh.removeFromParent();
      this.projectiles = []; return;
    }
    if (this.pendingBash) {
      this.pendingBash -= dt;
      if (this.pendingBash <= 0) { this.pendingBash = null; this.hitWithGun(player, level, getTargets()); }
    }
    const bashPressed = input.consumeKeyPress?.('KeyF');
    if (input.pointerLocked && player.alive) {
      if (bashPressed || input.isMouseButtonDown(0) && player.ammo === 0) {
        if (this.bashCooldown <= 0 && player.startGunBash()) {
          this.pendingBash = 0.22; this.bashCooldown = 0.75;
        }
      } else if (input.isMouseButtonDown(0) && this.shootCooldown <= 0 && player.bashTime <= 0) {
        this.fire(player, getTargets());
      }
    }
    this.updateProjectiles(dt, player, level, this.projectiles.length ? getTargets() : []);
    this.updatePickups(dt, player);
  }

  fire(player, targets) {
    if (!player.alive || player.ammo <= 0 || player.bashTime > 0 || this.shootCooldown > 0) return false;
    player.camera.updateMatrixWorld(true);
    this.ray.near = 0; this.ray.far = 100; this.ray.setFromCamera(this.center, player.camera);
    const aimHit = this.ray.intersectObjects(targets, false)[0];
    const destination = aimHit?.point || this.ray.ray.at(100, new THREE.Vector3());
    let origin = player.getMuzzleWorldPosition(), direction = destination.clone().sub(origin).normalize();
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
    this.projectiles.push({ mesh, direction, distance: 0 });
    player.ammo--; player.shotTime = 0.14; player.weaponPresentation?.update(0);
    this.shootCooldown = 0.22;
    return true;
  }

  updateProjectiles(dt, player, level, targets) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bullet = this.projectiles[i], travel = Math.min(65 * dt, 100 - bullet.distance);
      this.ray.set(bullet.mesh.position, bullet.direction); this.ray.near = 0; this.ray.far = travel;
      const hit = this.ray.intersectObjects(targets, false)[0];
      if (hit) {
        if (!level.handleBulletHit?.(hit, 15, player)) {
          const zombie = level.zombies.find(z => z.alive && z.group.visible && belongsTo(hit.object, z.group));
          if (zombie) this.damageZombie(zombie, 15, player);
        }
      } else { bullet.mesh.position.addScaledVector(bullet.direction, travel); bullet.distance += travel; }
      if (hit || bullet.distance >= 100) { bullet.mesh.removeFromParent(); this.projectiles.splice(i, 1); }
    }
  }

  hitWithGun(player, level, targets) {
    const origin = player.group.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    const forward = player.getForwardDirection();
    const candidates = level.zombies.filter(zombie => zombie.alive && zombie.group.visible && !zombie.isBoss)
      .map(zombie => ({ zombie, center: zombie.group.position.clone().add(new THREE.Vector3(0, 1, 0)) }))
      .filter(({ center }) => center.distanceTo(origin) <= 2.25 && center.clone().sub(origin).normalize().dot(forward) > 0.45)
      .sort((a, b) => a.center.distanceToSquared(origin) - b.center.distanceToSquared(origin));
    for (const { zombie, center } of candidates) {
      this.ray.set(origin, center.clone().sub(origin).normalize()); this.ray.near = 0; this.ray.far = origin.distanceTo(center) + 0.1;
      const hit = this.ray.intersectObjects(targets, false)[0];
      if (!hit || !belongsTo(hit.object, zombie.group)) continue;
      this.damageZombie(zombie, 30, player); return zombie;
    }
    return null;
  }

  damageZombie(zombie, damage, player) {
    if (!zombie.takeDamage(damage) || this.rewarded.has(zombie)) return;
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
      if (pickup.amount === 0) { pickup.group.removeFromParent(); this.pickups.splice(i, 1); }
    }
  }

  dispose() {
    this.reset(); this.root.removeFromParent();
    for (const value of Object.values(this)) if (value?.isBufferGeometry || value?.isMaterial) value.dispose();
  }
}
