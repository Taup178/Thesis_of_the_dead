import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
    this.creditsCollected = 0;
    this.bossSpawned = false;
    this.bossReached = false;
    this.levelComplete = false;

    // References
    this.bossMarker = null;
    this.bossRing = null;
    this.portalRoot = null;
    this.portalModel = null;
    this.portalMixer = null;
    this.portalLight = null;
    this.grassGround = null;
    this.treeModel = null;
    this.treeVariants = [];
    this.placedTrees = [];
    this.obstacles = [];
    this.treeMeshes = [];

    // Boss sequence: waiting -> running -> absorbing -> done
    this.bossState = 'waiting';
    this.portalTimer = 0;
  }

  /** Async load (procedural, so mostly sync). Returns loading progress callbacks. */
  async load(onProgress) {
    this._createLighting();
    onProgress && onProgress(0.2);

    this._createGround();
    onProgress && onProgress(0.35);

    await this._loadGrassGround();
    onProgress && onProgress(0.5);

    this._createCredits(8);
    onProgress && onProgress(0.6);

    await this._loadTreeModel();
    this._createTrees(35);
    onProgress && onProgress(0.75);

    this._createBossMarker();
    await this._loadPortalModel();
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
    this.sunLight = new THREE.DirectionalLight(0xffe4b5, 2.5);
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
    this.ambientLight = new THREE.AmbientLight(0x8899aa, 0.7);
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

  async _loadGrassGround() {
    const loader = new GLTFLoader();

    return new Promise((resolve) => {
      loader.load(
        './assets/models/grass_ground/grass_ground.gltf',
        (gltf) => {
          try {
            this.grassGround = gltf.scene;
            this.grassGround.name = 'GrassGround';

            // Scale the model so it covers the 120x120 ground.
            const box = new THREE.Box3().setFromObject(this.grassGround);
            const size = new THREE.Vector3();
            box.getSize(size);
            const targetSize = 120;
            const scale = targetSize / Math.max(size.x, size.z);
            this.grassGround.scale.setScalar(scale);

            // Recompute bounds after scaling and sit it just above the base ground.
            const scaledBox = new THREE.Box3().setFromObject(this.grassGround);
            this.grassGround.position.y = -scaledBox.min.y + 0.01;

            // Tile the grass texture so it keeps its original density.
            this.grassGround.traverse((child) => {
              if (child.isMesh && child.material && child.material.map) {
                child.material.map.wrapS = THREE.RepeatWrapping;
                child.material.map.wrapT = THREE.RepeatWrapping;
                child.material.map.repeat.set(scale, scale);
                child.material.map.needsUpdate = true;
                child.receiveShadow = true;
              }
            });

            this.scene.add(this.grassGround);
          } catch (err) {
            console.error('[GrassGround] failed to place grass ground:', err);
          }
          resolve();
        },
        undefined,
        (err) => {
          console.error('[GrassGround] failed to load grass ground model:', err);
          resolve();
        }
      );
    });
  }

  async _loadTreeModel() {
    const loader = new GLTFLoader();

    return new Promise((resolve) => {
      loader.load(
        './assets/models/trees/trees.gltf',
        (gltf) => {
          try {
            this.treeModel = gltf.scene;

            // The model contains several tree sub-groups (e.g. tree4, tree6).
            // Wrap each tree variant in an upright container group where:
            // - Local +Y points straight up (90 degrees to the ground).
            // - The bottom of the trunk is grounded at local y = 0.
            // - The trunk base is centered at local x = 0, z = 0.
            // This ensures subsequent yaw rotations around Y only rotate the tree
            // around its vertical axis without any slanting or horizontal tilting.
            this.treeModel.traverse((child) => {
              if (child.isObject3D && child.children.length > 0 && child.name && child.name.toLowerCase().startsWith('tree')) {
                child.updateWorldMatrix(true, false);
                const worldMatrix = child.matrixWorld.clone();
                const pos = new THREE.Vector3();
                const quat = new THREE.Quaternion();
                const scale = new THREE.Vector3();
                worldMatrix.decompose(pos, quat, scale);

                const inner = child.clone();
                inner.position.set(0, 0, 0);
                inner.quaternion.copy(quat);
                inner.scale.copy(scale);
                inner.updateMatrixWorld(true);

                const box = new THREE.Box3().setFromObject(inner);
                const height = box.max.y - box.min.y;
                const centerX = (box.min.x + box.max.x) / 2;
                const centerZ = (box.min.z + box.max.z) / 2;
                inner.position.set(-centerX, -box.min.y, -centerZ);

                const template = new THREE.Group();
                template.add(inner);
                template.userData.height = height;

                this.treeVariants.push(template);
              }
            });

            if (this.treeVariants.length === 0) {
              console.warn('[Trees] no tree variants found in model');
            }
          } catch (err) {
            console.error('[Trees] failed to process tree model:', err);
          }
          resolve();
        },
        undefined,
        (err) => {
          console.error('[Trees] failed to load tree model:', err);
          resolve();
        }
      );
    });
  }

  _createTree(x, z) {
    if (this.treeVariants.length === 0) return;

    const template = this.treeVariants[Math.floor(Math.random() * this.treeVariants.length)];
    const baseHeight = template.userData.height || 25;
    const tree = template.clone();
    tree.name = 'Tree';

    // Scale to a visible game height (20-35 units)
    const targetHeight = 20 + Math.random() * 15;
    const scale = targetHeight / Math.max(baseHeight, 0.01);
    tree.scale.setScalar(scale);

    // Sit the base directly on the ground at y = 0
    tree.position.set(x, 0, z);
    // Random yaw rotation around the vertical Y axis (trunk stays strictly 90 degrees to ground)
    tree.rotation.y = Math.random() * Math.PI * 2;

    // Calculate physical collision radius from the model trunk dimensions & scale
    const trunkRadius = Math.max(0.9, 3.416 * 9 * scale * 1.1);
    this.obstacles.push({ x, z, radius: trunkRadius });

    tree.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        this.treeMeshes.push(child);
      }
    });

    this.scene.add(tree);
    this.placedTrees.push(tree);
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
        // Keep clear of spawn area (player spawns at 0, 0, 0)
        valid = Math.hypot(x, z) > 5;
        // Keep clear of boss path
        if (z < -35 && Math.abs(x) < 4) valid = false;
        // Keep clear of collectible credits
        for (const c of this.credits) {
          if (Math.hypot(c.mesh.position.x - x, c.mesh.position.z - z) < 3) {
            valid = false;
            break;
          }
        }
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
    // The Dean — hidden until all orbs are collected
    const bossGeo = new THREE.CylinderGeometry(0.5, 0.5, 3, 8);
    const bossMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      emissive: 0x4a0e4e,
      emissiveIntensity: 0.3,
      roughness: 0.5
    });
    this.bossMarker = new THREE.Mesh(bossGeo, bossMat);
    this.bossMarker.position.set(0, 1.5, 5);
    this.bossMarker.castShadow = true;
    this.bossMarker.name = 'Dean';
    this.bossMarker.visible = false;
    this.scene.add(this.bossMarker);
    this.disposables.push(bossGeo, bossMat);

    // Indicator ring around The Dean's feet
    const ringGeo = new THREE.TorusGeometry(1.5, 0.05, 8, 24);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 1.0
    });
    this.bossRing = new THREE.Mesh(ringGeo, ringMat);
    this.bossRing.position.set(0, 0.1, 5);
    this.bossRing.rotation.x = -Math.PI / 2;
    this.bossRing.visible = false;
    this.scene.add(this.bossRing);
    this.disposables.push(ringGeo, ringMat);
  }

  _spawnBoss() {
    this.bossSpawned = true;
    this.bossState = 'running';
    this.bossMarker.visible = true;
    this.bossRing.visible = true;
    // Boss appears near the player spawn and runs toward the portal
    this.bossMarker.position.set(0, 1.5, 5);
    this.bossRing.position.set(0, 0.1, 5);
    this.bossMarker.lookAt(0, 1.5, -45);
  }

  async _loadPortalModel() {
    const loader = new GLTFLoader();

    return new Promise((resolve) => {
      loader.load(
        './assets/models/portal/portal.gltf',
        (gltf) => {
          try {
            this.portalModel = gltf.scene;
            this.portalModel.name = 'Portal';

            // Fix distorted/unapplied-transform meshes from the glTF export:
            // Object_35 (outer glowing blocks around ring), Object_17 (mid spiral), and Object_19 (outer spiral)
            // were exported with mismatched bone inverse transforms vs baked node scales.
            // We normalize their geometry so they fit properly within and around the portal frame.
            const fixMeshGeo = (meshName, targetDiameter) => {
              let mesh;
              this.portalModel.traverse((c) => {
                if (c.name === meshName) mesh = c;
              });
              if (!mesh || !mesh.geometry) return;
              mesh.geometry.computeBoundingBox();
              const rawBox = mesh.geometry.boundingBox;
              const rawCenter = new THREE.Vector3();
              rawBox.getCenter(rawCenter);
              const rawSize = new THREE.Vector3();
              rawBox.getSize(rawSize);

              if (rawSize.x === 0) return;
              const scale = targetDiameter / rawSize.x;
              const mCenter = new THREE.Matrix4().makeTranslation(-rawCenter.x, -rawCenter.y, -rawCenter.z);
              const mScale = new THREE.Matrix4().makeScale(scale, scale, scale);
              const mTarget = new THREE.Matrix4().makeTranslation(0, 4.0, 0);
              mesh.geometry.applyMatrix4(mTarget.multiply(mScale).multiply(mCenter));
              mesh.geometry.computeBoundingBox();
              mesh.geometry.computeBoundingSphere();
            };

            fixMeshGeo('Object_35', 10.3135);
            fixMeshGeo('Object_17', 7.4);
            fixMeshGeo('Object_19', 8.2);

            // Enable shadows and enhance emissive glowing materials
            this.portalModel.traverse((child) => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                  if (child.material.emissive && child.material.emissive.getHex() > 0) {
                    child.material.emissiveIntensity = 2.0;
                  }
                }
              }
            });

            // Root group placed at the boss location at ground level (Y = 0)
            this.portalRoot = new THREE.Group();
            this.portalRoot.name = 'PortalRoot';
            this.portalRoot.position.set(0, 0, -45);
            this.portalRoot.rotation.y = 0;
            this.portalRoot.visible = true;

            // The portal model base contact point is at local Y = -1.68.
            // Raising the model by Y = 1.68 places the base and bottom step flush on the ground at Y = 0.
            this.portalModel.position.set(0, 1.68, 0);
            this.portalModel.scale.setScalar(1.0);
            this.portalRoot.add(this.portalModel);
            this.scene.add(this.portalRoot);

            // Animation mixer
            if (gltf.animations && gltf.animations.length > 0) {
              this.portalMixer = new THREE.AnimationMixer(this.portalModel);
              for (const clip of gltf.animations) {
                const action = this.portalMixer.clipAction(clip);
                action.play();
              }
            }

            // Atmospheric point light radiating from the portal center (emerald green)
            this.portalLight = new THREE.PointLight(0x00ff88, 2.0, 25);
            this.portalLight.position.set(0, 3.2, -44.5);
            this.scene.add(this.portalLight);
            this.disposables.push(this.portalLight);
          } catch (err) {
            console.error('Failed to process portal model:', err);
            this._createFallbackPortal();
          }
          resolve();
        },
        undefined,
        (err) => {
          console.error('Failed to load portal model:', err);
          this._createFallbackPortal();
          resolve();
        }
      );
    });
  }

  _createFallbackPortal() {
    // Fallback ring sitting on the ground if the glTF fails to load
    const root = new THREE.Group();
    root.name = 'PortalRoot';
    root.position.set(0, 1.5, -45);
    root.visible = true;

    const geo = new THREE.TorusGeometry(2.0, 0.15, 16, 48);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      emissive: 0x00ff88,
      emissiveIntensity: 1.5
    });
    const ring = new THREE.Mesh(geo, mat);
    root.add(ring);

    this.portalRoot = root;
    this.portalModel = ring;
    this.scene.add(root);
    this.disposables.push(geo, mat);

    this.portalLight = new THREE.PointLight(0x00ff88, 2, 20);
    this.portalLight.position.set(0, 2, -45);
    this.scene.add(this.portalLight);
    this.disposables.push(this.portalLight);
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

    // Update portal animation mixer
    if (this.portalMixer) {
      this.portalMixer.update(dt);
    }

    // Idle portal pulse before the boss appears
    if (this.bossState === 'waiting' && this.portalRoot) {
      this.portalRoot.scale.setScalar(1 + Math.sin(time * 2) * 0.02);
      if (this.portalLight) this.portalLight.intensity = 2.0 + Math.sin(time * 3) * 0.5;
    }

    // Spawn the boss once all credits are collected
    if (this.bossState === 'waiting' && this.creditsCollected >= this.credits.length) {
      this._spawnBoss();
    }

    // Boss runs from the edge of the player side toward the portal
    if (this.bossState === 'running') {
      const runSpeed = 4.0;
      const target = new THREE.Vector3(0, 1.5, -45);
      const pos = this.bossMarker.position;
      const offset = new THREE.Vector3().subVectors(target, pos);
      const dist = offset.length();
      const step = runSpeed * dt;

      if (this.bossRing) {
        this.bossRing.rotation.z += dt * 1.5;
      }

      if (dist > step) {
        offset.normalize().multiplyScalar(step);
        this.bossMarker.position.add(offset);
        this.bossRing.position.x = this.bossMarker.position.x;
        this.bossRing.position.z = this.bossMarker.position.z;
        // Face the portal while running
        this.bossMarker.lookAt(target);
        // Running bob
        this.bossMarker.position.y = 1.5 + Math.abs(Math.sin(time * 12)) * 0.15;
        this.bossRing.position.y = 0.1 + Math.abs(Math.sin(time * 12)) * 0.15;
      } else {
        this.bossState = 'absorbing';
        this.bossReached = true;
        events.bossReached = true;
        this.portalTimer = 0;
      }
    }

    // Boss disappears into the portal
    if (this.bossState === 'absorbing') {
      this.portalTimer += dt;
      const absorbDuration = 1.5;
      const t = Math.min(this.portalTimer / absorbDuration, 1);
      const ease = t * t * (3 - 2 * t);

      this.bossMarker.position.y = 1.5 * (1 - ease);
      this.bossMarker.position.z = -45 - ease * 0.5;
      this.bossMarker.scale.setScalar(1 - ease * 0.9);
      this.bossMarker.rotation.y += dt * 3;

      // Fade out the red indicator ring
      if (this.bossRing) {
        this.bossRing.scale.setScalar((1 + Math.sin(time * 2) * 0.1) * (1 - ease));
        this.bossRing.material.opacity = 1 - ease;
        this.bossRing.material.transparent = true;
      }

      // Keep portal lit and intensely pulsing
      if (this.portalRoot) this.portalRoot.scale.setScalar(1 + Math.sin(time * 4) * 0.04);
      if (this.portalLight) this.portalLight.intensity = 4.0 + Math.sin(time * 6) * 1.0;

      if (t >= 1) {
        this.bossState = 'done';
        this.scene.remove(this.bossMarker);
        if (this.bossRing) this.scene.remove(this.bossRing);
      }
    } else if (this.bossState === 'done') {
      // Portal continues to pulse while level-complete UI handles the rest
      if (this.portalRoot) this.portalRoot.scale.setScalar(1 + Math.sin(time * 4) * 0.04);
      if (this.portalLight) this.portalLight.intensity = 4.0 + Math.sin(time * 6) * 1.0;

      if (!this.levelComplete) {
        this.levelComplete = true;
        events.levelComplete = true;
      }
    }

    // Update zombies
    for (const zombie of this.zombies) {
      if (!zombie.alive) continue;
      const result = zombie.update(dt, player.group.position);
      if (result.hit) {
        player.takeDamage(result.damage);
      }
      this._resolveObstacles(zombie.group.position, 0.4);
    }

    return events;
  }

  /** Returns array of obstacle colliders { x, z, radius } */
  getObstacles() {
    return this.obstacles;
  }

  /** Resolves collision against obstacles for an entity position */
  _resolveObstacles(pos, radius = 0.4) {
    if (!this.obstacles || this.obstacles.length === 0) return;
    for (let pass = 0; pass < 2; pass++) {
      for (const obs of this.obstacles) {
        const dx = pos.x - obs.x;
        const dz = pos.z - obs.z;
        const minDist = obs.radius + radius;
        const distSq = dx * dx + dz * dz;

        if (distSq < minDist * minDist) {
          const dist = Math.sqrt(distSq);
          const nx = dist > 1e-5 ? dx / dist : 1;
          const nz = dist > 1e-5 ? dz / dist : 0;
          const overlap = minDist - dist;

          pos.x += nx * overlap;
          pos.z += nz * overlap;
        }
      }
    }
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
    // Dispose grass ground
    if (this.grassGround) {
      this.scene.remove(this.grassGround);
      this.grassGround.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => {
                if (m.map) m.map.dispose();
                m.dispose();
              });
            } else {
              if (child.material.map) child.material.map.dispose();
              child.material.dispose();
            }
          }
        }
      });
      this.grassGround = null;
    }

    // Dispose placed trees
    for (const tree of this.placedTrees) {
      this.scene.remove(tree);
    }
    this.placedTrees = [];
    this.treeVariants = [];
    this.obstacles = [];
    this.treeMeshes = [];

    // Dispose the loaded tree model (and its shared materials/textures)
    if (this.treeModel) {
      this.treeModel.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => {
                if (m.map) m.map.dispose();
                m.dispose();
              });
            } else {
              if (child.material.map) child.material.map.dispose();
              child.material.dispose();
            }
          }
        }
      });
      this.treeModel = null;
    }

    // Dispose portal model and mixer
    if (this.portalMixer) {
      this.portalMixer.stopAllAction();
      this.portalMixer = null;
    }
    if (this.portalRoot) {
      this.scene.remove(this.portalRoot);
      this.portalRoot.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => {
                if (m.map) m.map.dispose();
                m.dispose();
              });
            } else {
              if (child.material.map) child.material.map.dispose();
              child.material.dispose();
            }
          }
        }
      });
      this.portalRoot = null;
      this.portalModel = null;
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
