import * as THREE from 'three';
import { Zombie } from '../enemies/Zombie.js';

/**
 * Level 1 - "The Freshman Woods"
 * Bright autumn forest. Collect credits, shoot zombies, chase the Dean.
 *
 * Mechanic: Navigation & Collection
 * Visual Identity: Warm sunlight, long shadows, autumn palette.
 */
export class Level1 {
  constructor(scene) {
    this.scene = scene;
    this.zombies = [];
    this.credits = [];       // collectible orbs
    this.disposables = [];   // track for cleanup
    this.creditsRequired = 5;
    this.creditsCollected = 0;
    this.bossReached = false;
    this.levelComplete = false;

    // References
    this.bossMarker = null;
    this.voidPortal = null;
  }

  /** Async load (procedural, so mostly sync). Returns loading progress callbacks. */
  async load(onProgress) {
    this._createLighting();
    onProgress && onProgress(0.2);

    this._createGround();
    onProgress && onProgress(0.4);

    this._createTrees(40);
    onProgress && onProgress(0.6);

    this._createCredits(8);
    onProgress && onProgress(0.8);

    this._createBossMarker();
    this._createZombies(6);
    onProgress && onProgress(1.0);
  }

  get spawnPoint() {
    return new THREE.Vector3(0, 0, 0);
  }

  get title() {
    return 'Chapter 1: The Freshman Woods';
  }

  _createLighting() {
    // Warm directional sun
    this.sunLight = new THREE.DirectionalLight(0xffe4b5, 2.0);
    this.sunLight.position.set(30, 40, 20);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -50;
    this.sunLight.shadow.camera.right = 50;
    this.sunLight.shadow.camera.top = 50;
    this.sunLight.shadow.camera.bottom = -50;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 100;
    this.sunLight.shadow.bias = -0.001;
    this.scene.add(this.sunLight);
    this.disposables.push(this.sunLight);

    // Ambient fill
    this.ambientLight = new THREE.AmbientLight(0x8899aa, 0.4);
    this.scene.add(this.ambientLight);
    this.disposables.push(this.ambientLight);

    // Hemisphere for sky/ground colour bleed
    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5f0b, 0.3);
    this.scene.add(this.hemiLight);
    this.disposables.push(this.hemiLight);

    // Fog for depth
    this.fog = new THREE.FogExp2(0xc8d8e8, 0.012);
    this.scene.fog = this.fog;
  }

  _createGround() {
    const groundGeo = new THREE.PlaneGeometry(120, 120, 32, 32);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x4a7a3a,
      roughness: 0.95,
      metalness: 0.0
    });
    this.ground = new THREE.Mesh(groundGeo, groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.name = 'Ground';
    this.scene.add(this.ground);
    this.disposables.push(groundGeo, groundMat);
  }

  /** Procedural low-poly tree: Cylinder trunk + Cone canopy. */
  _createTree(x, z) {
    const tree = new THREE.Group();

    // Trunk
    const trunkH = 2.5 + Math.random() * 2;
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, trunkH, 6);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x8b5a2b,
      roughness: 0.9
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    // Canopy (autumn colours)
    const autumnColors = [0xd4762c, 0xc44e28, 0xe8a735, 0x8fba3a, 0xb85c2a];
    const canopyColor = autumnColors[Math.floor(Math.random() * autumnColors.length)];
    const canopyR = 1.2 + Math.random() * 0.8;
    const canopyGeo = new THREE.ConeGeometry(canopyR, canopyR * 2, 7);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: canopyColor,
      roughness: 0.85
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = trunkH + canopyR * 0.6;
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    tree.add(canopy);

    tree.position.set(x, 0, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(tree);

    // Track for disposal
    this.disposables.push(trunkGeo, trunkMat, canopyGeo, canopyMat);
    return tree;
  }

  _createTrees(count) {
    const radius = 50;
    const minDist = 4;
    const positions = [];

    for (let i = 0; i < count; i++) {
      let x, z, valid;
      let attempts = 0;
      do {
        x = (Math.random() - 0.5) * radius * 2;
        z = (Math.random() - 0.5) * radius * 2;
        // Keep clear of spawn area
        valid = Math.sqrt(x * x + z * z) > 6;
        // Keep clear of boss path
        if (z < -35 && Math.abs(x) < 4) valid = false;
        // Min distance from other trees
        for (const p of positions) {
          if (Math.hypot(p.x - x, p.z - z) < minDist) {
            valid = false;
            break;
          }
        }
        attempts++;
      } while (!valid && attempts < 30);

      if (valid) {
        positions.push({ x, z });
        this._createTree(x, z);
      }
    }
  }

  /** Glowing collectible orbs ("Credits"). */
  _createCredits(count) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = 10 + Math.random() * 25;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      const orbGeo = new THREE.SphereGeometry(0.3, 12, 8);
      const orbMat = new THREE.MeshStandardMaterial({
        color: 0xffd700,
        emissive: 0xffa000,
        emissiveIntensity: 1.5,
        roughness: 0.2,
        metalness: 0.8
      });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.set(x, 1.5, z);
      orb.name = 'Credit';

      // Glow point light
      const glow = new THREE.PointLight(0xffd700, 1, 5);
      orb.add(glow);

      this.scene.add(orb);
      this.credits.push({ mesh: orb, collected: false });
      this.disposables.push(orbGeo, orbMat);
    }
  }

  _createBossMarker() {
    // The Dean stands at the end of a clearing
    const bossGeo = new THREE.CylinderGeometry(0.5, 0.5, 3, 8);
    const bossMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      emissive: 0x4a0e4e,
      emissiveIntensity: 0.3,
      roughness: 0.5
    });
    this.bossMarker = new THREE.Mesh(bossGeo, bossMat);
    this.bossMarker.position.set(0, 1.5, -45);
    this.bossMarker.castShadow = true;
    this.bossMarker.name = 'Dean';
    this.scene.add(this.bossMarker);
    this.disposables.push(bossGeo, bossMat);

    // Floating text indicator
    const ringGeo = new THREE.TorusGeometry(1.5, 0.05, 8, 24);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 1.0
    });
    this.bossRing = new THREE.Mesh(ringGeo, ringMat);
    this.bossRing.position.set(0, 0.1, -45);
    this.bossRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.bossRing);
    this.disposables.push(ringGeo, ringMat);
  }

  _createZombies(count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 25;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const zombie = new Zombie(this.scene, new THREE.Vector3(x, 0, z));
      this.zombies.push(zombie);
    }
  }

  /**
   * Per-frame update.
   * Returns { creditCollected, bossReached, levelComplete }
   */
  update(dt, player, time) {
    const events = { creditCollected: false, bossReached: false, levelComplete: false };

    // Animate credits (bob & spin)
    for (const credit of this.credits) {
      if (credit.collected) continue;
      credit.mesh.position.y = 1.5 + Math.sin(time * 3 + credit.mesh.position.x) * 0.3;
      credit.mesh.rotation.y += dt * 2;

      // Collect if player is close
      const dist = player.group.position.distanceTo(credit.mesh.position);
      if (dist < 2.0) {
        credit.collected = true;
        this.scene.remove(credit.mesh);
        credit.mesh.geometry.dispose();
        credit.mesh.material.dispose();
        this.creditsCollected++;
        player.addScore(100);
        events.creditCollected = true;
      }
    }

    // Boss ring animation
    if (this.bossRing) {
      this.bossRing.rotation.z += dt * 0.5;
      this.bossRing.scale.setScalar(1 + Math.sin(time * 2) * 0.1);
    }

    // Check if player reached the boss
    if (!this.bossReached && this.bossMarker) {
      const distToBoss = player.group.position.distanceTo(this.bossMarker.position);
      if (distToBoss < 4 && this.creditsCollected >= this.creditsRequired) {
        this.bossReached = true;
        events.bossReached = true;
      }
    }

    // Update zombies
    for (const zombie of this.zombies) {
      if (!zombie.alive) continue;
      const result = zombie.update(dt, player.group.position);
      if (result.hit) {
        player.takeDamage(result.damage);
      }
    }

    return events;
  }

  /** Clean up EVERYTHING this level created. Critical for LAMP memory. */
  dispose() {
    // Dispose zombies
    for (const zombie of this.zombies) {
      zombie.dispose();
    }
    this.zombies = [];

    // Dispose credit orbs
    for (const credit of this.credits) {
      if (!credit.collected) {
        this.scene.remove(credit.mesh);
        credit.mesh.geometry.dispose();
        credit.mesh.material.dispose();
      }
    }
    this.credits = [];

    // Dispose ground
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      this.ground.material.dispose();
    }

    // Dispose boss
    if (this.bossMarker) {
      this.scene.remove(this.bossMarker);
      this.bossMarker.geometry.dispose();
      this.bossMarker.material.dispose();
    }
    if (this.bossRing) {
      this.scene.remove(this.bossRing);
      this.bossRing.geometry.dispose();
      this.bossRing.material.dispose();
    }

    // Dispose all tracked disposables (lights, geometries, materials)
    for (const d of this.disposables) {
      if (d.isLight || d.isFog) {
        this.scene.remove(d);
      } else if (d.dispose) {
        d.dispose();
      }
    }
    this.disposables = [];

    // Clear fog
    this.scene.fog = null;
  }
}
