import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { Zombie } from '../enemies/Zombie.js';
import { createDegreeScroll, createLeftHandDegreeGrip } from '../props/DegreeScroll.js';
import { CreditEnergyEffects } from '../props/CreditEnergyEffects.js';
import { compileHiddenObjects } from '../core/ShaderWarmup.js';
import { NightSky } from '../environment/NightSky.js';
import { WakeUpIntro } from '../player/WakeUpIntro.js';
import { StylizedWoods } from '../environment/StylizedWoods.js';
import { ForestAtmosphere } from '../environment/ForestAtmosphere.js';
import { getPortalTravelDuration } from '../props/RoomExitPortal.js';
import { WoodsBossCutscene } from './WoodsBossCutscene.js';
import { OrbPortalCutscene } from './OrbPortalCutscene.js';

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
    this.creditEffects = null; // Academic Credit Energy System visuals
    this.atmosphere = null;  // Dynamic Forest Atmosphere visuals
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
    this.portalRoot = null;
    this.portalModel = null;
    this.portalMixer = null;
    this.portalLight = null;
    this.woods = null;
    this.obstacles = [];
    this.treeMeshes = [];

    // Boss sequence: waiting -> emerging -> running -> absorbing -> done
    this.bossState = 'waiting';
    this.bossCutscene = null;
    this.orbPortalCutscene = null;
    this.portalActive = false;
    this.portalTimer = 0;
    this.bossAbsorption = null;
    this.portalApproachPoint = new THREE.Vector3(0, 0, -43.2);
  }

  /** Load the nature pack, night sky, and encounter assets with progress callbacks. */
  async load(onProgress) {
    this._createLighting();
    await this.nightSky.ready;
    onProgress && onProgress(0.2);

    this._createCredits(8);
    this.woods = new StylizedWoods(this.scene, this.credits);
    await this.woods.load(progress => onProgress?.(0.2 + progress * 0.5));
    this.obstacles = this.woods.obstacles;
    this.treeMeshes = this.woods.bulletMeshes;
    this._createAtmosphere();
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

  get portalCinematicActive() { return !!this.playerAbsorption; }

  get remainingZombies() {
    // Count delayed portal exits and the reserve too, even while their models are hidden.
    return this.zombies.reduce((count, zombie) => count + Number(zombie.alive), 0)
      + this.zombieReserve.reduce((count, zombie) => count + Number(zombie.alive), 0);
  }

  get bluePortalUnlocked() {
    return this.bossState === 'done' && !this.bossCutscene && this.remainingZombies === 0;
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

  /** Glowing collectible orbs ("Credits"). */
  _createCredits(count) {
    this.creditEffects = new CreditEnergyEffects(this.scene);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = 10 + Math.random() * 25;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      const orb = this.creditEffects.createCoreMesh();
      orb.position.set(x, 1.5, z);
      orb.name = 'Credit';

      this.scene.add(orb);
      this.credits.push({ mesh: orb, collected: false });
    }
    this.creditEffects.attach(this.credits);
  }

  /** Fireflies, ground mist and wind sway; owns its resources end to end. */
  _createAtmosphere() {
    this.atmosphere = new ForestAtmosphere(this.scene, this.woods?.root ?? null, this.credits);
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

    await this.boss.ready;
    // Portal scaling and changing poses invalidate the skinned mesh's cached
    // culling bounds. The hero of the shot must remain visible throughout it.
    this.bossMarker.traverse(node => { if (node.isSkinnedMesh) node.frustumCulled = false; });
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

  _spawnBoss(player) {
    this.bossSpawned = true;
    this.bossState = 'emerging';
    this.bossMarker.visible = true;
    // Emerge beyond the red portal's steps, then run down the clear central path.
    this.redPortalRoot.updateMatrixWorld(true);
    const redBounds = new THREE.Box3().setFromObject(this.redPortalRoot, true);
    this.bossMarker.position.set(this.redPortalRoot.position.x, 0,
      Math.min(this.redPortalRoot.position.z - 6, redBounds.min.z - 1));
    this.bossMarker.scale.setScalar(this.bossScale);
    if (this.portalRoot) {
      this.portalRoot.updateMatrixWorld(true);
      const portalBounds = new THREE.Box3().setFromObject(this.portalRoot, true);
      this.portalApproachPoint.set(this.portalRoot.position.x, 0, portalBounds.max.z + 0.7);
    }
    this.bossMarker.lookAt(this.portalApproachPoint);
    this.boss._playAction('Idle');
    this._updateBossAnimation(0);
    this.bossCutscene = new WoodsBossCutscene(this, player);
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
    this.bossAbsorption.duration = getPortalTravelDuration(this.bossAbsorption.path);
    for (const { material } of this.bossAbsorption.materials) {
      material.transparent = true;
      material.needsUpdate = true;
    }
    this.boss._playAction('Idle', 0.12);
  }

  _updateBossAbsorption(dt, time) {
    this.portalTimer += dt;
    const t = Math.min(this.portalTimer / this.bossAbsorption.duration, 1);
    const ease = THREE.MathUtils.smoothstep(t, 0, 1);
    const absorption = this.bossAbsorption;
    const scale = absorption.startScale * Math.max(0.001, Math.pow(1 - ease, 1.25));

    this.bossMarker.scale.setScalar(scale);
    this.bossMarker.rotation.y = absorption.startYaw + ease * Math.PI / 6;
    const centerOffset = absorption.localCenter.clone().multiplyScalar(scale)
      .applyQuaternion(this.bossMarker.quaternion);
    this.bossMarker.position.copy(absorption.path.getPointAt(t)).sub(centerOffset);

    // Keep the degree gripped as his stride settles into a floating pose.
    if (this.boss.mixer) this.boss.mixer.timeScale = 1;
    this._updateBossAnimation(dt);

    const opacity = 1 - THREE.MathUtils.smoothstep(t, 0.55, 1);
    const portalGlow = new THREE.Color(0x359dff);
    for (const entry of absorption.materials) {
      entry.material.opacity = entry.opacity * opacity;
      entry.material.depthWrite = opacity > 0.95;
      if (entry.emissive) {
        entry.material.emissive.copy(entry.emissive).lerp(portalGlow, ease * 0.7);
        entry.material.emissiveIntensity = entry.emissiveIntensity + Math.sin(t * Math.PI) * 0.8;
      }
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
                for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
                  if (material.emissive?.getHex() > 0) {
                    material.emissive.setHex(0x258bff);
                    material.emissiveIntensity = 2.0;
                  }
                  if (material.color?.g > material.color.r * 1.3) material.color.setHex(0x307dff);
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

            // Blue light identifies the exit across from the red spawn portal.
            this.portalLight = new THREE.PointLight(0x258bff, 2.0, 25);
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
      color: 0x307dff,
      emissive: 0x258bff,
      emissiveIntensity: 1.5
    });
    const ring = new THREE.Mesh(geo, mat);
    root.add(ring);

    this.portalRoot = root;
    this.portalModel = ring;
    this.scene.add(root);
    this.disposables.push(geo, mat);

    this.portalLight = new THREE.PointLight(0x258bff, 2, 20);
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
        if (copy.color?.b > copy.color.r * 1.3) copy.color.setHex(0xff3025);
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

  // Precompiles the reserve zombies' GPU programs behind the loading screen;
  // without this their first portal reveal compiles shaders mid-game and stalls a frame.
  async prepareShaders(renderer, camera) {
    this.cinematicRenderer = renderer;
    const objects = [this.bossMarker, ...this.creditEffects.getWarmupObjects(),
      ...this.zombieReserve.map(zombie => zombie.group)];
    const warmFrame = () => {
      if (!renderer.render || !renderer.setRenderTarget || !renderer.getViewport) return;
      const previousTarget = renderer.getRenderTarget();
      const viewport = renderer.getViewport(new THREE.Vector4());
      const hidden = objects.filter(object => object && !object.visible);
      const culled = [];
      for (const object of objects) object?.traverse(node => {
        if (!node.isMesh && !node.isPoints) return;
        culled.push({ node, value: node.frustumCulled }); node.frustumCulled = false;
      });
      try {
        for (const object of hidden) object.visible = true;
        // Use the screen's actual color/shadow pipeline, with a tiny viewport
        // covered by the loading overlay, to avoid compiling offscreen variants.
        renderer.setRenderTarget(null); renderer.setViewport(0, 0, 4, 4);
        // Upload meshes, skinning textures and shadow programs under the loading
        // screen too; compiling materials alone leaves that work for the first shot.
        renderer.render(this.scene, camera);
      } finally {
        renderer.setRenderTarget(previousTarget); renderer.setViewport(viewport);
        for (const object of hidden) object.visible = false;
        for (const { node, value } of culled) node.frustumCulled = value;
      }
    };
    await compileHiddenObjects(renderer, this.scene, camera, objects);
    warmFrame();
    // Portal travel fades both the Dean and his degree. Prepare that material
    // variant now so the first reveal and disappearance cannot compile mid-shot.
    const materials = new Set();
    this.bossMarker?.traverse(node => {
      if (node.isMesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
    });
    const saved = [...materials].map(material => ({ material, transparent: material.transparent, depthWrite: material.depthWrite }));
    try {
      for (const { material } of saved) {
        material.transparent = true; material.depthWrite = false; material.needsUpdate = true;
      }
      await compileHiddenObjects(renderer, this.scene, camera, objects);
      warmFrame();
    } finally {
      for (const entry of saved) Object.assign(entry.material, {
        transparent: entry.transparent, depthWrite: entry.depthWrite, needsUpdate: true,
      });
    }
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
    this.playerAbsorption.duration = getPortalTravelDuration(this.playerAbsorption.path);
    for (const entry of this.playerAbsorption.materials) { entry.material.transparent = true; entry.material.needsUpdate = true; }
  }

  _updatePlayerAbsorption(dt) {
    const travel = this.playerAbsorption, player = travel.player;
    travel.time += dt;
    const t = Math.min(1, travel.time / travel.duration), ease = THREE.MathUtils.smoothstep(t, 0, 1);
    const scale = Math.max(0.001, Math.pow(1 - ease, 1.25));
    const center = travel.path.getPointAt(t);
    player.group.scale.copy(travel.scale).multiplyScalar(scale);
    player.group.position.copy(center).sub(travel.localCenter.clone().multiply(player.group.scale).applyQuaternion(player.group.quaternion));
    player.mixer?.update(dt);
    const opacity = 1 - THREE.MathUtils.smoothstep(t, 0.55, 1);
    for (const { material, opacity: original } of travel.materials) { material.opacity = original * opacity; material.depthWrite = opacity > 0.95; }
    player.camera.position.lerpVectors(travel.cameraStart, travel.cameraEnd,
      THREE.MathUtils.smoothstep(travel.time, 0, Math.min(0.4, travel.duration + 0.12)));
    player.camera.lookAt(center); player.camera.updateMatrixWorld(true);
    if (this.portalLight) this.portalLight.intensity = 4 + Math.sin(t * Math.PI) * 4;
    if (t >= 1) player.group.visible = false;
    if (travel.time >= travel.duration + 0.12) this.levelComplete = true;
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
    if (this.playerAbsorption) return { title: 'Entering The Sophomore Room',
      detail: 'The portal pulls you through.', timer: 'All zombies defeated', progress: 1, tone: 'follow' };
    const total = this.credits?.length || 8;
    const allCredits = this.creditsCollected >= total;
    const portalReady = this.bossState === 'done';
    return { title: portalReady ? 'Follow the Dean into the green portal' : allCredits ? 'THE DEAN HAS APPEARED' : `Collect Academic Credits (${this.creditsCollected}/${total})`,
      detail: portalReady ? 'The green portal is ready. Walk into it to continue to second year.' : allCredits ? 'All Academic Credits collected! The Dean has appeared.' : 'Search the woods for Academic Credits. Each one releases two zombies from the red portal.',
      timer: `Academic Credits: ${this.creditsCollected}/${total}`, progress: this.creditsCollected / Math.max(1, total), tone: portalReady ? 'follow' : allCredits ? 'danger' : 'watch' };
  }

  /** Per-frame update, including audio-relevant story events. */
  update(dt, player, time) {
    const events = { creditCollected: false, firstCreditCollected: false, finalCreditCollected: false, deanReveal: false,
      bossReached: false, portalActivated: false, portalEntry: false, levelComplete: false };
    if (this.nightSky) this.nightSky.update(player.group.position);
    if (this.atmosphere) this.atmosphere.update(dt);
    if (this.wakeUpIntro && !this.wakeUpIntro.done) {
      this.wakeUpIntro.update(dt);
      return events;
    }
    this.redPortalMixer?.update(dt);
    this.portalMixer?.update(dt);
    if (this.redPortalLight) this.redPortalLight.intensity = 3.5 + Math.sin(time * 4) * 0.8;
    this.creditEffects?.update(dt, player);
    if (this.playerAbsorption) {
      this._updatePlayerAbsorption(dt);
      return { ...events, levelComplete: this.levelComplete, autoAdvance: this.levelComplete };
    }
    if (this.bossCutscene) {
      events.bossReached = this.bossCutscene.update(dt, time);
      if (this.bossState === 'done' && !this.portalActive) {
        this.portalActive = true;
        events.portalActivated = true;
      }
      return events; // Hold enemies and queued spawns while the camera owns control.
    }
    if (this.orbPortalCutscene) {
      this.orbPortalCutscene.update(dt);
      return events; // The first pair gets a clear entrance before the player takes over.
    }
    this.spawnDelay = Math.max(0, this.spawnDelay - dt);

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
        this.creditsCollected++;
        this._spawnOrbZombies();
        player.addScore(100);
        const finalCredit = this.creditsCollected === this.credits.length;
        this.creditEffects.onCollected(credit, player, finalCredit);
        events.creditCollected = true;
        events.firstCreditCollected = this.creditsCollected === 1;
        events.finalCreditCollected = finalCredit;
        if (events.firstCreditCollected && player.camera) this.orbPortalCutscene = new OrbPortalCutscene(this, player);
      }
    }

    if (this.orbPortalCutscene) return events;

    // Idle portal pulse before the boss appears
    if (this.bossState === 'waiting' && this.portalRoot) {
      this.portalRoot.scale.setScalar(1 + Math.sin(time * 2) * 0.02);
      if (this.portalLight) this.portalLight.intensity = 2.0 + Math.sin(time * 3) * 0.5;
    }

    // Spawn the boss once all credits are collected
    if (this.bossState === 'waiting' && this.creditsCollected >= this.credits.length) {
      this._spawnBoss(player);
      events.deanReveal = true;
      if (this.bossCutscene) return events;
    }

    if (this.bossState === 'done') {
      // After the escape, clear every zombie before following through the blue portal.
      const unlocked = this.bluePortalUnlocked;
      if (this.portalRoot) this.portalRoot.scale.setScalar(1 + Math.sin(time * 4) * (unlocked ? 0.04 : 0.01));
      if (this.portalLight) this.portalLight.intensity = unlocked ? 4 + Math.sin(time * 6) : 1.5 + Math.sin(time * 3) * 0.25;

      if (unlocked && Math.hypot(player.group.position.x - this.portalApproachPoint.x, player.group.position.z - this.portalApproachPoint.z) < 2.2) {
        this._beginPlayerAbsorption(player);
        events.portalEntry = true;
        return events;
      }
    }

    // Update zombies
    for (const zombie of this.zombies) {
      if (zombie.portalExit) { this._updatePortalExit(zombie, dt); continue; }
      const result = zombie.update(dt, player.group.position);
      if (result.hit) {
        player.takeDamage(result.damage, { type: 'blunt', source: zombie.group.position });
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
    // Restore cloned vegetation materials before the woods release their originals.
    this.atmosphere?.dispose();
    this.atmosphere = null;
    this.woods?.dispose();
    this.woods = null;
    this.wakeUpIntro?.restore();
    this.orbPortalCutscene?.restore();
    this.bossCutscene?.restore();
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

    // Dispose credit orbs and their energy effects
    this.creditEffects?.dispose();
    this.creditEffects = null;
    for (const credit of this.credits) {
      if (!credit.collected) {
        this.scene.remove(credit.mesh);
      }
    }
    this.credits = [];

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
    this.obstacles = [];
    this.treeMeshes = [];

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
