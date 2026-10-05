import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { Zombie } from '../enemies/Zombie.js';
import { createDegreeScroll, createLeftHandDegreeGrip } from '../props/DegreeScroll.js';
import { NightSky } from '../environment/NightSky.js';
import { WakeUpIntro } from '../player/WakeUpIntro.js';

/**
 * Level 1 - "The Freshman Woods"
 * Moonlit forest. Collect credits, shoot zombies, chase the Dean.
 *
 * Mechanic: Navigation & Collection
 * Visual Identity: Starry sky, cool moonlight, soft tree shadows.
 */
export class Level1 {
  constructor(scene) {
    this.scene = scene;
    this.previousBackground = scene.background;
    this.worldBounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
    this.nightSky = null;
    this.zombies = [];
    this.zombieReserve = [];
    this.spawnDelay = 0;
    this.redPortalRoot = null;
    this.redPortalMaterials = new Set();
    this.playerAbsorption = null;
    this.allowsShooting = true;
    this.credits = [];       // collectible orbs
    this.disposables = [];   // track for cleanup
    this.creditsCollected = 0;
    this.bossSpawned = false;
    this.bossReached = false;
    this.levelComplete = false;

    // References
    this.boss = null;
    this.bossScale = 1.25;
    this.degreeScroll = null;
    this.degreeGrip = null;
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
    this.bossAbsorption = null;
    this.portalApproachPoint = new THREE.Vector3(0, 0, -43.2);
  }

  /** Async load (procedural, so mostly sync). Returns loading progress callbacks. */
  async load(onProgress) {
    this._createLighting();
    await this.nightSky.ready;
    onProgress && onProgress(0.2);

    this._createGround();
    onProgress && onProgress(0.35);

    await this._loadGrassGround();
    onProgress && onProgress(0.5);

    this._createCredits(8);
    onProgress && onProgress(0.6);

    await this._loadTreeModel();
    this._createTrees(35);
    this._createForestBackdrop();
    onProgress && onProgress(0.75);

    await this._createBossMarker();
    await this._loadPortalModel();
    this._createRedPortal();
    await this._createZombies(this.credits.length * 2);
    onProgress && onProgress(1.0);
  }

  get spawnPoint() {
    return new THREE.Vector3(0, 0, 0);
  }

  get title() {
    return 'Chapter 1: The Freshman Woods';
  }

  preparePlayer(player) {
    player.group.position.copy(this.spawnPoint); player.lastSafePosition.copy(player.group.position);
    player.velocity.set(0, 0, 0); player.verticalVelocity = 0; player.grounded = true;
    player.yaw = 0; player.pitch = -0.12; player.group.rotation.y = 0;
    player.cameraGroundY = 0; player.cameraObstacles = this.getObstacles();
    this.wakeUpIntro = new WakeUpIntro(player);
  }

  _createLighting() {
    this.scene.background = new THREE.Color(0x020409);
    this.nightSky = new NightSky(this.scene);

    // Moonlight gives the trees shape; reduced shadow intensity keeps them readable.
    this.moonLight = new THREE.DirectionalLight(0xe0e5e9, 0.85);
    this.moonLight.position.copy(this.nightSky.moonDirection).multiplyScalar(110);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.intensity = 0.4;
    this.moonLight.shadow.radius = 3;
    this.moonLight.shadow.blurSamples = 8;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    this.moonLight.shadow.camera.left = -85;
    this.moonLight.shadow.camera.right = 85;
    this.moonLight.shadow.camera.top = 85;
    this.moonLight.shadow.camera.bottom = -85;
    this.moonLight.shadow.camera.near = 0.5;
    this.moonLight.shadow.camera.far = 190;
    this.moonLight.shadow.bias = -0.0003;
    this.moonLight.shadow.normalBias = 0.04;
    this.scene.add(this.moonLight);
    this.disposables.push(this.moonLight);

    // Ambient fill
    this.ambientLight = new THREE.AmbientLight(0x88939d, 0.75);
    this.scene.add(this.ambientLight);
    this.disposables.push(this.ambientLight);

    // Hemisphere for sky/ground colour bleed
    this.hemiLight = new THREE.HemisphereLight(0xa4afba, 0x505846, 0.75);
    this.scene.add(this.hemiLight);
    this.disposables.push(this.hemiLight);

    // Fog for depth
    this.fog = new THREE.FogExp2(this.nightSky.horizonColor, 0.0075);
    this.scene.fog = this.fog;
  }

  _createGround() {
    // Continue the visible landscape beyond the playable bounds into the distant haze.
    const groundGeo = new THREE.PlaneGeometry(600, 600);
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
            let grassMaterial = null;
            this.grassGround.traverse((child) => {
              if (!child.isMesh) return;
              child.receiveShadow = true;
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              for (const material of materials) {
                grassMaterial ||= material;
                // Grass is a matte surface; the imported metallic default loses ambient fill.
                material.metalness = 0;
                material.roughness = 0.95;
                material.normalScale.set(0.3, 0.3);
                material.aoMapIntensity = 0.45;
                // All channels must describe the same grass patch, including its normals and AO.
                const maps = new Set([material.map, material.normalMap, material.roughnessMap,
                  material.metalnessMap, material.aoMap]);
                for (const map of maps) {
                  if (!map) continue;
                  map.wrapS = THREE.RepeatWrapping;
                  map.wrapT = THREE.RepeatWrapping;
                  map.repeat.set(scale, scale);
                  map.anisotropy = 8;
                  map.needsUpdate = true;
                }
              }
            });

            if (grassMaterial) {
              this.ground.material.dispose();
              this.ground.material = grassMaterial.clone();
              // Share the source textures and preserve their world scale on the wider terrain.
              const uv = this.ground.geometry.attributes.uv;
              for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 5);
              uv.needsUpdate = true;
              this.ground.position.y = -0.02;
            }

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

            this.treeModel.traverse(child => {
              if (!child.isMesh) return;
              const materials = Array.isArray(child.material) ? child.material : [child.material];
              for (const material of materials) {
                if (material.map) material.map.anisotropy = 8;
                if (!material.transparent || !material.map) continue;
                // Leaves need cutouts in both colour and shadow passes, with stable depth ordering.
                material.transparent = false;
                material.alphaTest = 0.45;
                material.alphaToCoverage = true;
                material.depthWrite = true;
                material.roughness = 0.9;
                material.needsUpdate = true;
              }
            });

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
        if (Math.hypot(x, z - 45) < 10) valid = false;
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

  _createForestBackdrop() {
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const distance = 90 + Math.random() * 65;
      this._createTree(Math.cos(angle) * distance, Math.sin(angle) * distance);
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

  async _createBossMarker() {
    // The large yellow fourth zombie replaces the Dean's placeholder cylinder.
    this.boss = new Zombie(this.scene, new THREE.Vector3(0, 0, 5),
      './assets/models/zombies/Zombie_Arm.gltf');
    this.boss.isBoss = true;
    this.bossMarker = this.boss.group;
    this.bossMarker.scale.setScalar(this.bossScale);
    this.bossMarker.name = 'Dean';
    this.bossMarker.visible = false;

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
    await this.boss.ready;
    this._attachDegreeScroll();
  }

  _attachDegreeScroll() {
    this.degreeScroll = createDegreeScroll();
    const hand = this.bossMarker.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('LowerArm.L'));
    if (hand) {
      // Fit the roll between the left palm, curled fingers, and opposing thumb.
      this.degreeScroll.scale.set(0.82, 0.78, 0.78);
      this.degreeScroll.position.set(0, 0.35, -0.06);
      hand.add(this.degreeScroll);
      this.degreeGrip = createLeftHandDegreeGrip(hand, this.degreeScroll);
      this.degreeGrip();
    } else {
      this.degreeScroll.position.set(-0.4, 1.2, -0.2);
      this.bossMarker.add(this.degreeScroll);
    }
    const resources = new Set();
    this.degreeScroll.traverse(child => {
      if (child.isMesh) {
        resources.add(child.geometry);
        resources.add(child.material);
        if (child.material.map) resources.add(child.material.map);
        if (child.material.bumpMap) resources.add(child.material.bumpMap);
      }
    });
    this.disposables.push(...resources);
  }

  _updateBossAnimation(dt) {
    if (this.boss.mixer) this.boss.mixer.update(dt);
    // The run clip must not reopen the fingers or let the degree slip through them.
    if (this.degreeGrip) this.degreeGrip();
  }

  _spawnBoss() {
    this.bossSpawned = true;
    this.bossState = 'running';
    this.bossMarker.visible = true;
    this.bossRing.visible = true;
    // Boss appears near the player spawn and runs toward the portal
    this.bossMarker.position.set(0, 0, 5);
    this.bossMarker.scale.setScalar(this.bossScale);
    this.bossRing.position.set(0, 0.1, 5);
    this.bossMarker.lookAt(0, 0, -45);
    this.boss._playAction('Run');
    this._updateBossAnimation(0);
    if (this.portalRoot) {
      this.portalRoot.updateMatrixWorld(true);
      const portalBounds = new THREE.Box3().setFromObject(this.portalRoot, true);
      this.portalApproachPoint.set(this.portalRoot.position.x, 0, portalBounds.max.z + 0.7);
    }
  }

  _beginBossAbsorption() {
    this.bossState = 'absorbing';
    this.bossReached = true;
    this.portalTimer = 0;

    // Shrink around the torso instead of the ground-level model origin.
    // SkinnedMesh.updateMatrixWorld also refreshes its bind inverse for accurate bounds.
    this.bossMarker.updateMatrixWorld(true);
    const startCenter = new THREE.Box3().setFromObject(this.bossMarker, true)
      .getCenter(new THREE.Vector3());
    const localCenter = this.bossMarker.worldToLocal(startCenter.clone());

    // Use the actual opening, including the fallback portal's different height.
    this.portalRoot?.updateMatrixWorld(true);
    const portalRing = this.portalModel?.getObjectByName('Object_35') || this.portalModel;
    const portalCenter = portalRing
      ? new THREE.Box3().setFromObject(portalRing, true).getCenter(new THREE.Vector3())
      : new THREE.Vector3(0, 3.2, -45);
    const control = new THREE.Vector3(
      startCenter.x * 0.35, portalCenter.y + 0.35, THREE.MathUtils.lerp(startCenter.z, portalCenter.z, 0.35)
    );
    const destination = portalCenter.clone();
    destination.z -= 0.35;

    const materials = new Set();
    this.bossMarker.traverse(child => {
      if (child.isMesh) {
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          materials.add(material);
        }
      }
    });
    this.bossAbsorption = {
      path: new THREE.QuadraticBezierCurve3(startCenter, control, destination),
      localCenter,
      startScale: this.bossMarker.scale.x,
      startYaw: this.bossMarker.rotation.y,
      startPortalScale: this.portalRoot?.scale.x || 1,
      startPortalLight: this.portalLight?.intensity || 2,
      materials: [...materials].map(material => ({
        material,
        opacity: material.opacity,
        emissive: material.emissive?.clone(),
        emissiveIntensity: material.emissiveIntensity,
      })),
    };
    for (const { material } of this.bossAbsorption.materials) {
      material.transparent = true;
      material.needsUpdate = true;
    }
    this.boss._playAction('Idle', 0.35);
    if (this.bossRing) this.bossRing.material.transparent = true;
  }

  _updateBossAbsorption(dt, time) {
    this.portalTimer += dt;
    const t = Math.min(this.portalTimer / 2.2, 1);
    const ease = THREE.MathUtils.smoothstep(t, 0, 1);
    const travelEase = 1 - Math.pow(1 - ease, 2);
    const absorption = this.bossAbsorption;
    const scale = absorption.startScale * Math.max(0.001, Math.pow(1 - ease, 1.25));

    this.bossMarker.scale.setScalar(scale);
    this.bossMarker.rotation.y = absorption.startYaw + ease * Math.PI / 6;
    const centerOffset = absorption.localCenter.clone().multiplyScalar(scale)
      .applyQuaternion(this.bossMarker.quaternion);
    this.bossMarker.position.copy(absorption.path.getPoint(travelEase)).sub(centerOffset);

    // Keep the degree gripped as his stride settles into a floating pose.
    if (this.boss.mixer) this.boss.mixer.timeScale = 1 - ease * 0.65;
    this._updateBossAnimation(dt);

    const opacity = 1 - THREE.MathUtils.smoothstep(t, 0.55, 1);
    const portalGlow = new THREE.Color(0x35ffb1);
    for (const entry of absorption.materials) {
      entry.material.opacity = entry.opacity * opacity;
      entry.material.depthWrite = opacity > 0.95;
      if (entry.emissive) {
        entry.material.emissive.copy(entry.emissive).lerp(portalGlow, ease * 0.7);
        entry.material.emissiveIntensity = entry.emissiveIntensity + Math.sin(t * Math.PI) * 0.8;
      }
    }

    if (this.bossRing) {
      const ringFade = 1 - THREE.MathUtils.smoothstep(t, 0, 0.45);
      this.bossRing.scale.setScalar(Math.max(0.001, ringFade));
      this.bossRing.material.opacity = ringFade;
    }
    const pulse = Math.sin(t * Math.PI);
    if (this.portalRoot) {
      const settledScale = 1 + Math.sin(time * 4) * 0.04;
      this.portalRoot.scale.setScalar(
        THREE.MathUtils.lerp(absorption.startPortalScale, settledScale, ease) + pulse * 0.05
      );
    }
    if (this.portalLight) {
      const settledLight = 4 + Math.sin(time * 6);
      this.portalLight.intensity = THREE.MathUtils.lerp(absorption.startPortalLight, settledLight, ease) + pulse * 4;
    }

    if (t >= 1) {
      this.bossState = 'done';
      this.bossMarker.visible = false;
      this.scene.remove(this.bossMarker);
      if (this.bossRing) {
        this.bossRing.visible = false;
        this.scene.remove(this.bossRing);
      }
      this.bossAbsorption = null;
    }
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
              this.portalAnimations = gltf.animations;
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

  _createRedPortal() {
    this.redPortalRoot = skeletonClone(this.portalRoot);
    this.redPortalRoot.name = 'ZombieSpawnPortal';
    this.redPortalRoot.position.z = 45;
    this.redPortalRoot.rotation.y = Math.PI;
    this.redPortalRoot.traverse(node => {
      if (!node.isMesh) return;
      const tint = material => {
        const copy = material.clone();
        if (copy.emissive?.getHex() > 0) { copy.emissive.setHex(0xff1810); copy.emissiveIntensity = 2; }
        if (copy.color?.g > copy.color.r * 1.3) copy.color.setHex(0xff3025);
        this.redPortalMaterials.add(copy); return copy;
      };
      node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
    });
    this.scene.add(this.redPortalRoot);
    this.redPortalMixer = new THREE.AnimationMixer(this.redPortalRoot.getObjectByName('Portal') || this.redPortalRoot);
    for (const clip of this.portalAnimations || []) this.redPortalMixer.clipAction(clip).play();
    this.redPortalLight = new THREE.PointLight(0xff2518, 3.5, 28);
    this.redPortalLight.position.set(0, 3.2, 44.5);
    this.scene.add(this.redPortalLight); this.disposables.push(this.redPortalLight);
    this.redPortalRoot.updateMatrixWorld(true);
    const opening = this.redPortalRoot.getObjectByName('Object_35') || this.redPortalRoot;
    this.redPortalCenter = new THREE.Box3().setFromObject(opening, true).getCenter(new THREE.Vector3());
  }

  async _createZombies(count) {
    const variants = ['Basic', 'Chubby', 'Ribcage'];
    for (let i = 0; i < count; i++) {
      const zombie = new Zombie(this.scene, new THREE.Vector3(0, 0, 45),
        `./assets/models/zombies/Zombie_${variants[i % variants.length]}.gltf`);
      zombie.group.visible = false;
      this.zombieReserve.push(zombie);
    }
    await Promise.all(this.zombieReserve.map(zombie => zombie.ready));
  }

  _spawnOrbZombies() {
    for (let i = 0; i < 2; i++) {
      const zombie = this.zombieReserve.shift();
      if (!zombie) break;
      const start = this.redPortalCenter.clone().add(new THREE.Vector3(0, -0.8, 0));
      const end = new THREE.Vector3(i === 0 ? -0.75 : 0.75, 0, 39);
      const control = start.clone().lerp(end, 0.5); control.y *= 0.5;
      zombie.portalExit = { delay: this.spawnDelay, time: 0, path: new THREE.QuadraticBezierCurve3(start, control, end) };
      this.spawnDelay += 0.55;
      this.zombies.push(zombie);
    }
  }

  _updatePortalExit(zombie, dt) {
    const exit = zombie.portalExit;
    if (exit.delay > 0) { exit.delay -= dt; return; }
    zombie.group.visible = true;
    if (!zombie.alive) { zombie.portalExit = null; return; }
    exit.time = Math.min(1, exit.time + dt / 1.7);
    zombie.group.position.copy(exit.path.getPoint(exit.time));
    zombie.group.scale.setScalar(THREE.MathUtils.lerp(0.12, 1, THREE.MathUtils.smoothstep(exit.time, 0, 0.6)));
    zombie.group.rotation.y = Math.PI;
    zombie.mixer?.update(dt);
    if (exit.time >= 1) zombie.portalExit = null;
  }

  _beginPlayerAbsorption(player) {
    player.scriptedMovement = true;
    player.velocity.set(0, 0, 0); player.verticalVelocity = 0; player.isDodging = false;
    this.allowsShooting = false;
    const bodyVisible = player.bodyMesh.visible;
    player.bodyMesh.visible = true; // Show the disappearance when entering in first person too.
    player._playAnimation?.('Idle_Gun', 'Idle');
    player.group.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(player.bodyMesh, true).getCenter(new THREE.Vector3());
    const localCenter = player.group.worldToLocal(center.clone());
    this.portalRoot.updateMatrixWorld(true);
    const opening = this.portalModel.getObjectByName('Object_35') || this.portalModel;
    const destination = new THREE.Box3().setFromObject(opening, true).getCenter(new THREE.Vector3());
    destination.z -= 0.35;
    const control = center.clone().lerp(destination, 0.4); control.y = destination.y + 0.3;
    const materials = new Set();
    player.bodyMesh.traverse(node => {
      if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    });
    this.playerAbsorption = { player, time: 0, bodyVisible, scale: player.group.scale.clone(),
      localCenter, path: new THREE.QuadraticBezierCurve3(center, control, destination),
      cameraStart: player.camera.position.clone(), cameraEnd: destination.clone().add(new THREE.Vector3(5, 1.8, 9)),
      materials: [...materials].map(material => ({ material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite })) };
    for (const entry of this.playerAbsorption.materials) { entry.material.transparent = true; entry.material.needsUpdate = true; }
  }

  _updatePlayerAbsorption(dt) {
    const travel = this.playerAbsorption, player = travel.player;
    travel.time += dt;
    const t = Math.min(1, travel.time / 2.2), ease = THREE.MathUtils.smoothstep(t, 0, 1);
    const scale = Math.max(0.001, Math.pow(1 - ease, 1.25));
    const center = travel.path.getPoint(1 - (1 - ease) ** 2);
    player.group.scale.copy(travel.scale).multiplyScalar(scale);
    player.group.position.copy(center).sub(travel.localCenter.clone().multiply(player.group.scale).applyQuaternion(player.group.quaternion));
    player.mixer?.update(dt * 0.6);
    const opacity = 1 - THREE.MathUtils.smoothstep(t, 0.55, 1);
    for (const { material, opacity: original } of travel.materials) { material.opacity = original * opacity; material.depthWrite = opacity > 0.95; }
    player.camera.position.lerpVectors(travel.cameraStart, travel.cameraEnd, THREE.MathUtils.smoothstep(t, 0, 0.3));
    player.camera.lookAt(center); player.camera.updateMatrixWorld(true);
    if (this.portalLight) this.portalLight.intensity = 4 + Math.sin(t * Math.PI) * 4;
    if (t >= 1) player.group.visible = false;
    if (travel.time >= 2.45) this.levelComplete = true;
  }

  _restorePlayerAppearance() {
    const travel = this.playerAbsorption; if (!travel) return;
    travel.player.group.scale.copy(travel.scale); travel.player.group.visible = true;
    travel.player.bodyMesh.visible = travel.bodyVisible; travel.player.scriptedMovement = false;
    for (const entry of travel.materials) {
      Object.assign(entry.material, { opacity: entry.opacity, transparent: entry.transparent, depthWrite: entry.depthWrite, needsUpdate: true });
    }
    this.playerAbsorption = null;
  }

  getChallengeStatus() {
    if (this.wakeUpIntro && !this.wakeUpIntro.done) return { title: 'Waking in the woods',
      detail: 'Find your feet. Your thesis is still out there.', timer: 'A strange dream begins',
      progress: this.wakeUpIntro.time / this.wakeUpIntro.duration, tone: 'watch' };
    const entering = !!this.playerAbsorption;
    const done = this.bossState === 'done';
    return { title: entering ? 'Entering The Sophomore Room' : done ? 'Follow the Dean into the green portal' : 'The Freshman Woods',
      detail: entering ? 'The portal pulls you through.' : done ? 'Walk up to the green portal to continue to second year.' : 'Collect the yellow orbs. Each orb releases two zombies from the red portal.',
      timer: `${this.creditsCollected} / ${this.credits.length} orbs collected`, progress: this.creditsCollected / Math.max(1, this.credits.length), tone: done ? 'follow' : 'watch' };
  }

  /**
   * Per-frame update.
   * Returns { creditCollected, bossReached, levelComplete }
   */
  update(dt, player, time) {
    const events = { creditCollected: false, bossReached: false, levelComplete: false };
    if (this.nightSky) this.nightSky.update(player.group.position);
    if (this.wakeUpIntro && !this.wakeUpIntro.done) {
      this.wakeUpIntro.update(dt);
      return events;
    }
    this.spawnDelay = Math.max(0, this.spawnDelay - dt);
    this.redPortalMixer?.update(dt);
    if (this.redPortalLight) this.redPortalLight.intensity = 3.5 + Math.sin(time * 4) * 0.8;
    if (this.playerAbsorption) {
      this.portalMixer?.update(dt);
      this._updatePlayerAbsorption(dt);
      return { ...events, levelComplete: this.levelComplete, autoAdvance: this.levelComplete };
    }

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
        this._spawnOrbZombies();
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
      this._updateBossAnimation(dt);
      const runSpeed = 4.0;
      // Begin the lift before the entrance steps so his feet never sink into them.
      const target = this.portalApproachPoint;
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
        // The model's run animation supplies the stride; keep its feet grounded.
        this.bossMarker.position.y = 0;
      } else {
        this._beginBossAbsorption();
        events.bossReached = true;
      }
    }

    // Boss disappears into the portal
    if (this.bossState === 'absorbing') {
      this._updateBossAbsorption(dt, time);
    } else if (this.bossState === 'done') {
      // The player must enter the same portal after the Dean has disappeared.
      if (this.portalRoot) this.portalRoot.scale.setScalar(1 + Math.sin(time * 4) * 0.04);
      if (this.portalLight) this.portalLight.intensity = 4.0 + Math.sin(time * 6) * 1.0;

      if (Math.hypot(player.group.position.x - this.portalApproachPoint.x, player.group.position.z - this.portalApproachPoint.z) < 2.2) {
        this._beginPlayerAbsorption(player);
        return events;
      }
    }

    // Update zombies
    for (const zombie of this.zombies) {
      if (zombie.portalExit) { this._updatePortalExit(zombie, dt); continue; }
      const result = zombie.update(dt, player.group.position);
      if (result.hit) {
        player.takeDamage(result.damage);
      }
      if (zombie.alive) this._resolveObstacles(zombie.group.position, 0.4);
    }

    return events;
  }

  /** Returns array of obstacle colliders { x, z, radius } */
  getObstacles() {
    return this.obstacles;
  }

  getWorldBounds() {
    return this.worldBounds;
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
    this.wakeUpIntro?.restore();
    this._restorePlayerAppearance();
    this.redPortalMixer?.stopAllAction();
    this.redPortalRoot?.removeFromParent();
    for (const material of this.redPortalMaterials) material.dispose();
    this.redPortalMaterials.clear();
    if (this.nightSky) {
      this.nightSky.dispose();
      this.nightSky = null;
    }
    // Dispose zombies
    for (const zombie of [...this.zombies, ...this.zombieReserve]) {
      zombie.dispose();
    }
    this.zombies = [];
    this.zombieReserve = [];

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
    this.bossAbsorption = null;
    this.degreeGrip = null;
    if (this.degreeScroll) {
      this.degreeScroll.removeFromParent();
      this.degreeScroll = null;
    }
    if (this.boss) {
      this.boss.dispose();
      this.boss = null;
      this.bossMarker = null;
    }
    if (this.bossRing) {
      this.scene.remove(this.bossRing);
      this.bossRing.geometry.dispose();
      this.bossRing.material.dispose();
    }
    // Dispose grass ground
    if (this.grassGround) {
      this.scene.remove(this.grassGround);
      const resources = new Set();
      this.grassGround.traverse((child) => {
        if (!child.isMesh) return;
        if (child.geometry) resources.add(child.geometry);
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          resources.add(material);
          for (const value of Object.values(material)) {
            if (value?.isTexture) resources.add(value);
          }
        }
      });
      for (const resource of resources) resource.dispose();
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
        if (d.shadow) d.shadow.dispose();
      } else if (d.dispose) {
        d.dispose();
      }
    }
    this.disposables = [];

    // Clear fog
    this.scene.fog = null;
    this.scene.background = this.previousBackground;
  }
}
