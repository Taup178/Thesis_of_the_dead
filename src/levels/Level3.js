import * as THREE from 'three';
import { Zombie } from '../enemies/Zombie.js';
import { createDegreeScroll, createLeftHandDegreeGrip } from '../props/DegreeScroll.js';
import { MudHouse, createHouseFragments, createHouseEffectTextures } from '../props/MudHouse.js';
import { DESERT_ASSET_ROOT, loadDesertAssets, extractDesertProps, createSandTexture } from '../environment/DesertAssets.js';
import { ArenaNavigation } from '../environment/ArenaNavigation.js';
import { RoomExitPortal, PortalEmergence } from '../props/RoomExitPortal.js';

export const FINAL_ENCOUNTER_SECONDS = 150;
export const MUD_HOUSE_POSITIONS = [[-15, 7], [15, 1], [-17, -20], [16, -24]];

/** Final Year combat foundation. Story victory and timer failure are intentionally deferred. */
export class Level3 {
  constructor(scene) {
    this.scene = scene; this.previousBackground = scene.background; this.previousFog = scene.fog;
    this.root = new THREE.Group(); this.root.name = 'FinalEncounter'; scene.add(this.root);
    this.zombies = []; this.credits = []; this.houses = []; this.spawnRecords = [];
    this.creditsCollected = 0; this.levelComplete = false; this.allowsShooting = true;
    this.timeRemaining = FINAL_ENCOUNTER_SECONDS; this.timerExpired = false; this.elapsed = 0;
    this.props = []; this.staticObstacles = []; this.bulletObstacles = [];
    this.resources = new Set(); this.targetHouse = null; this.lastHitHouse = null; this.targetHold = 0;
    this.failureReason = 'The desert overwhelmed you. Regroup and try the encounter again.';
  }

  get title() { return 'Chapter 3: The Final Encounter'; }
  get spawnPoint() { return new THREE.Vector3(0, 0, 31); }
  get controlsHint() { return 'WASD: Move | Mouse: Aim | Click: Shoot | F: Gun Bash | Shift: Sprint | Space: Dodge | C: Camera | R: Restart | Esc: Pause'; }

  async load(onProgress) {
    const assets = await loadDesertAssets(p => onProgress?.(p * 0.4));
    for (const source of Object.values(assets)) this._collectResources(source);
    this._createLighting();
    await this._createTerrain(); onProgress?.(0.5);
    this._createScenery(assets);
    const template = extractDesertProps(assets.building)[0]; this._collectResources(template);
    this.fragments = createHouseFragments(template);
    for (const fragment of this.fragments) this.resources.add(fragment.geometry);
    this.effectTextures = createHouseEffectTextures();
    Object.values(this.effectTextures).forEach(texture => this.resources.add(texture));
    this.houses = MUD_HOUSE_POSITIONS.map(([x, z], i) => new MudHouse(this.root, this.fragments, template.material,
      new THREE.Vector3(x, 0, z), i, this.effectTextures));
    this._createDeanStage();
    this._createEntrancePortal();
    this._createSpawns();
    this.dean = new Zombie(this.scene, new THREE.Vector3(0, 1.2, -37), './assets/models/zombies/Zombie_Arm.gltf');
    this.dean.isBoss = true; this.bossMarker = this.dean.group;
    this.bossMarker.name = 'Dean'; this.bossMarker.scale.setScalar(1.25); this.root.add(this.bossMarker);
    await Promise.all([...this.zombies.map(zombie => zombie.ready), this.dean.ready, this.entrancePortal.load()]);
    this.dean._playAction('Idle'); this._attachDegree();
    this.bossMarker.traverse(node => { if (node.isMesh) this.bulletObstacles.push(node); });
    this.navigation = new ArenaNavigation(this.getObstacles());
    this._collectResources(this.environment);
    this.root.updateMatrixWorld(true); onProgress?.(1);
  }

  preparePlayer(player) {
    player.group.position.copy(this.spawnPoint); player.lastSafePosition.copy(player.group.position);
    player.pitch = -0.04; player.yaw = 0; player.group.rotation.y = 0;
    player.velocity.set(0, 0, 0); player.verticalVelocity = 0; player.grounded = true; player.platformSupport = null;
    player.cameraGroundY = 0; player.cameraObstacles = this.getObstacles(); player._updateCamera();
    this.arrivalPlayer = player; this.arrivalBodyVisible = player.bodyMesh.visible;
    player.scriptedMovement = true; player.bodyMesh.visible = true;
    if (player.mixer) { player._playAnimation('Idle_Gun', 'Idle'); player.mixer.update(0); }
    this.arrivalPassage = new PortalEmergence(player.group, this.entrancePortal.center, player.bodyMesh);
    this.arrivalCameraTime = 0;
    player.camera.position.copy(this.spawnPoint).add(new THREE.Vector3(7.5, 4.5, -6.5));
    player.camera.lookAt(this.spawnPoint.clone().add(new THREE.Vector3(0, 1.5, 3)));
    player.camera.updateMatrixWorld(true);
    this.arrivalCameraPosition = player.camera.position.clone();
    this.arrivalCameraRotation = player.camera.quaternion.clone();
    player.weaponPresentation?.update(0);
  }

  _createEntrancePortal() {
    // The camera rests 4.8 units behind the player, with the portal farther back.
    const position = this.spawnPoint.clone().add(new THREE.Vector3(0, 0, 7.5));
    this.entrancePortal = new RoomExitPortal(this.root, position, { red: true, rotationY: Math.PI });
    this.entrancePortal.root.name = 'FinalEncounterEntrancePortal';
  }

  _updateArrival(dt) {
    const player = this.arrivalPlayer;
    player.mixer?.update(dt);
    if (this.arrivalPassage.time < this.arrivalPassage.duration) {
      this.arrivalPassage.update(dt);
      return;
    }
    this.arrivalCameraTime += dt;
    const t = THREE.MathUtils.smoothstep(this.arrivalCameraTime, 0, 0.8);
    player._updateCamera();
    player.camera.position.lerpVectors(this.arrivalCameraPosition, player.camera.position, t);
    player.camera.quaternion.slerpQuaternions(this.arrivalCameraRotation, player.camera.quaternion, t);
    player.camera.updateMatrixWorld(true);
    if (t === 1) this._restoreArrivalPlayer();
  }

  _restoreArrivalPlayer() {
    if (!this.arrivalPlayer) return;
    const player = this.arrivalPlayer;
    this.arrivalPassage.restore();
    player.group.position.copy(this.spawnPoint); player.lastSafePosition.copy(player.group.position);
    player.bodyMesh.visible = this.arrivalBodyVisible; player.scriptedMovement = false;
    player._updateCamera(); player.weaponPresentation?.update(0);
    this.arrivalPlayer = null;
  }

  _collectResources(root) {
    root.traverse(node => {
      if (node.geometry) this.resources.add(node.geometry);
      for (const material of node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []) {
        this.resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) this.resources.add(value);
      }
    });
  }

  _createLighting() {
    this.environment = new THREE.Group(); this.root.add(this.environment);
    this.scene.background = new THREE.Color(0xd7bea0);
    this.scene.fog = new THREE.Fog(0xd7bea0, 60, 155);
    this.environment.add(new THREE.HemisphereLight(0xc5d9e5, 0x9d714a, 1.35));
    const sun = new THREE.DirectionalLight(0xffe0af, 2.8); sun.position.set(45, 65, 30);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 180 });
    sun.shadow.normalBias = 0.09; sun.shadow.bias = -0.0002; sun.shadow.intensity = 0.52; sun.shadow.radius = 3;
    this.environment.add(sun, sun.target);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(230, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 worldPosition; void main(){worldPosition=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(worldPosition,1.0);}',
      fragmentShader: `varying vec3 worldPosition;
        void main(){vec3 d=normalize(worldPosition-cameraPosition);float h=max(d.y,0.0);
        vec3 color=mix(vec3(0.76,0.58,0.36),vec3(0.21,0.43,0.62),pow(h,0.45));
        float sun=max(dot(d,normalize(vec3(45.0,65.0,30.0))),0.0);
        color+=vec3(1.0,0.69,0.31)*pow(sun,70.0)*0.3+vec3(2.5,2.1,1.4)*smoothstep(0.9994,0.9998,sun);
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`
    }));
    sky.renderOrder = -2; this.environment.add(sky);
  }

  async _createTerrain() {
    const sand = createSandTexture();
    const geometry = new THREE.PlaneGeometry(340, 340, 120, 120); geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i), edge = THREE.MathUtils.smoothstep(Math.hypot(x, z), 48, 80);
      const height = (Math.sin(x * 0.065 + Math.sin(z * 0.034)) * 3.6 + Math.cos(z * 0.078 + x * 0.02) * 2.2 + 5) * edge;
      position.setY(i, height - 0.045);
    }
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: sand, roughness: 1, bumpMap: sand, bumpScale: 0.045 }));
    ground.receiveShadow = true; this.environment.add(ground); this.bulletObstacles.push(ground);
    const loader = new THREE.TextureLoader();
    const base = `${DESERT_ASSET_ROOT}desert_stone_ground/textures/Scene_-_Root_`;
    const [map, normalMap] = await Promise.all([loader.loadAsync(`${base}baseColor.jpeg`), loader.loadAsync(`${base}normal.png`)]);
    map.colorSpace = THREE.SRGBColorSpace;
    for (const texture of [map, normalMap]) { texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(5, 5); texture.anisotropy = 4; }
    // Windblown sand grades into the kit's stony ground, without a rectangular texture edge.
    const stone = new THREE.MeshStandardMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    stone.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 patchUV;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\npatchUV = uv;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 patchUV;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\nfloat edge=length((patchUV-0.5)*2.0);diffuseColor.a*=0.68*(1.0-smoothstep(0.45,1.0,edge));');
    };
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(78, 78), stone); patch.rotation.x = -Math.PI / 2;
    patch.position.set(0, -0.025, -5); patch.receiveShadow = true; this.environment.add(patch);
  }

  _createScenery(assets) {
    const rocks = extractDesertProps(assets.rocks), shrubs = extractDesertProps(assets.shrubs), scenery = extractDesertProps(assets.scenery);
    [...rocks, ...shrubs, ...scenery].forEach(prop => this._collectResources(prop));
    let seed = 24681357;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const place = (template, x, z, height, rotation = 0, y = 0) => {
      const prop = template.clone(); prop.geometry.computeBoundingBox();
      const size = prop.geometry.boundingBox.getSize(new THREE.Vector3());
      prop.scale.setScalar(height / Math.max(0.05, size.y));
      prop.position.set(x, y, z); prop.rotation.y = rotation;
      this.environment.add(prop); this.props.push(prop); return prop;
    };
    // Large silhouettes frame the settlement and continue beyond the walkable arena.
    for (let i = 0; i < 34; i++) {
      const angle = i / 34 * Math.PI * 2, radius = 49 + random() * 29;
      const height = 3 + random() * 10;
      place(rocks[(i % 3) + 12], Math.sin(angle) * radius, Math.cos(angle) * radius, height, random() * 6.28, -0.2);
    }
    for (const [x, z, height] of [[-33, 13, 2.3], [31, 18, 1.6], [-31, -7, 1.4], [34, -9, 2.2], [-32, -34, 2.6], [32, -37, 2.5]]) {
      const prop = place(rocks[8], x, z, height, random() * 6.28);
      const size = new THREE.Box3().setFromObject(prop).getSize(new THREE.Vector3());
      this.staticObstacles.push({ x, z, radius: Math.max(size.x, size.z) * 0.45 });
      this.bulletObstacles.push(prop);
    }
    for (let i = 0; i < 100; i++) {
      const x = (random() - 0.5) * 90, z = (random() - 0.5) * 90;
      if (MUD_HOUSE_POSITIONS.some(([hx, hz]) => Math.hypot(x - hx, z - hz) < 7) || Math.abs(x) < 5) continue;
      if (i % 3 === 0) place(rocks[i % 12], x, z, 0.12 + random() * 0.4, random() * 6.28);
      else place(shrubs[i % shrubs.length], x, z, 0.25 + random() * 0.65, random() * 6.28);
    }
    // The supplied desert scene contributes its tall cacti and weathered dead wood.
    for (let i = 0; i < 15; i++) {
      const angle = i / 15 * Math.PI * 2, radius = 38 + random() * 6;
      const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
      const height = 1.4 + random() * 2.1, rotation = random() * 6.28;
      if (Math.abs(x) < 5 && z > this.spawnPoint.z - 3) continue;
      place(scenery[i % scenery.length], x, z, height, rotation);
    }
  }

  _createDeanStage() {
    const stone = new THREE.MeshStandardMaterial({ color: 0x987956, roughness: 1 });
    for (let i = 0; i < 3; i++) {
      const step = new THREE.Mesh(new THREE.CylinderGeometry(3.8 - i * 0.5, 3.9 - i * 0.5, 0.4, 8), stone);
      step.position.set(0, 0.2 + i * 0.4, -37); step.castShadow = step.receiveShadow = true;
      this.environment.add(step); this.bulletObstacles.push(step);
    }
    this.staticObstacles.push({ x: 0, z: -37, radius: 3.9 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x443325, roughness: 1 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x8c3c29, side: THREE.DoubleSide, roughness: 1 });
    for (const x of [-4.8, 4.8]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5.6, 8), wood); pole.position.set(x, 2.8, -38.8);
      const bannerGeometry = new THREE.PlaneGeometry(1.3, 2.4, 6, 10), points = bannerGeometry.getAttribute('position');
      for (let i = 0; i < points.count; i++) points.setZ(i, Math.sin(points.getY(i) * 4 + points.getX(i) * 3) * 0.08);
      bannerGeometry.computeVertexNormals();
      const banner = new THREE.Mesh(bannerGeometry, cloth); banner.position.set(x + 0.68, 4, -38.8);
      pole.castShadow = banner.castShadow = true; this.environment.add(pole, banner);
    }
  }

  _attachDegree() {
    const original = new Set(); this.bossMarker.traverse(node => { if (node.geometry) original.add(node.geometry); });
    this.degreeScroll = createDegreeScroll();
    const hand = this.bossMarker.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('LowerArm.L'));
    if (hand) {
      this.degreeScroll.scale.set(0.82, 0.78, 0.78); this.degreeScroll.position.set(0, 0.35, -0.06); hand.add(this.degreeScroll);
      this.degreeGrip = createLeftHandDegreeGrip(hand, this.degreeScroll); this.degreeGrip();
    } else { this.degreeScroll.position.set(-0.4, 1.2, -0.2); this.bossMarker.add(this.degreeScroll); }
    this.bossMarker.traverse(node => { if (node.geometry && !original.has(node.geometry)) this.resources.add(node.geometry); });
  }

  _createSpawns() {
    const variants = ['Basic', 'Chubby', 'Ribcage'];
    for (const house of this.houses) for (const door of house.doors) {
      const zombie = new Zombie(this.scene, door.start, `./assets/models/zombies/Zombie_${variants[(house.index + door.index) % 3]}.gltf`);
      zombie.group.visible = false; zombie.group.name = `House_${house.index + 1}_Door_${door.index + 1}`;
      zombie.speed = 1.9 + door.index * 0.13; this.root.add(zombie.group); this.zombies.push(zombie);
      this.spawnRecords.push({ house, door, zombie, phase: 'waiting', progress: 0, route: [], routeTime: door.index * 0.2 });
    }
  }

  getWorldBounds() { return { minX: -46, maxX: 46, minZ: -46, maxZ: 46 }; }
  getObstacles() { return [...this.staticObstacles, ...this.houses.filter(house => house.alive).map(house => house.obstacle)]; }
  getBulletObstacles() { return [...this.bulletObstacles, ...this.houses.flatMap(house => house.shootableMeshes)]; }

  handleBulletHit(hit, damage, player) {
    const house = hit.object.userData.mudHouse;
    if (!house?.alive) return false;
    this.lastHitHouse = house; this.targetHold = 2.5;
    if (house.takeDamage(damage, hit)) {
      player.addScore(400);
      this.navigation.obstacles = this.getObstacles();
      for (const record of this.spawnRecords) record.routeTime = 0;
    }
    return true;
  }

  updateTarget(hit) { this.targetHouse = hit?.object.userData.mudHouse || null; }
  getTargetStatus() {
    const destructionFeedback = this.lastHitHouse && !this.lastHitHouse.alive && this.targetHold > 1.3;
    const house = destructionFeedback ? this.lastHitHouse : this.targetHouse?.alive ? this.targetHouse : this.targetHold > 0 ? this.lastHitHouse : null;
    return house ? { title: `MUD HOUSE ${house.index + 1}`, health: house.health, maxHealth: house.maxHealth, destroyed: !house.alive } : null;
  }

  update(dt, player) {
    this.entrancePortal?.update(dt, !!this.arrivalPlayer);
    this.dean?.mixer?.update(dt); this.degreeGrip?.();
    if (this.arrivalPlayer) {
      this._updateArrival(dt);
      return { levelComplete: false, creditCollected: false };
    }
    this.elapsed += dt; this.timeRemaining = Math.max(0, this.timeRemaining - dt);
    this.timerExpired = this.timeRemaining === 0; this.targetHold = Math.max(0, this.targetHold - dt);
    for (const house of this.houses) house.update(dt);
    for (const record of this.spawnRecords) this._updateZombie(record, dt, player);
    return { levelComplete: false, creditCollected: false };
  }

  _updateZombie(record, dt, player) {
    const { zombie, house, door } = record;
    if (!zombie.alive) { zombie.mixer?.update(dt); return; }
    if (record.phase === 'waiting') {
      if (this.elapsed < 1 + door.delay && house.alive) return;
      record.phase = 'exiting'; zombie.group.visible = true; zombie._playAction('Walk');
    }
    if (record.phase === 'exiting') {
      record.progress = Math.min(1, record.progress + dt / 2.1);
      zombie.group.position.lerpVectors(door.start, door.end, record.progress);
      zombie.group.lookAt(door.end.x + door.direction.x, 0, door.end.z + door.direction.z);
      zombie.mixer?.update(dt);
      if (record.progress >= 1) { record.phase = 'hunting'; record.routeTime = 0; }
      return;
    }
    record.routeTime -= dt;
    if (record.routeTime <= 0) {
      record.route = this.navigation.route(zombie.group.position, player.group.position); record.routeTime = 0.85;
    }
    while (record.route.length > 1 && Math.hypot(record.route[0].x - zombie.group.position.x, record.route[0].z - zombie.group.position.z) < 1) record.route.shift();
    const direct = this.navigation.clear(zombie.group.position, player.group.position);
    const waypoint = !direct && record.route[0];
    if (waypoint) {
      // Extend the steering target so the normal attack range cannot stop a zombie at a path corner.
      const direction = new THREE.Vector3(waypoint.x - zombie.group.position.x, 0, waypoint.z - zombie.group.position.z).normalize();
      zombie.update(dt, zombie.group.position.clone().addScaledVector(direction, 5));
    } else {
      const result = zombie.update(dt, player.group.position);
      if (result.hit && direct && !player.isDodging) player.takeDamage(result.damage);
    }
    for (const obstacle of this.navigation.obstacles) {
      const dx = zombie.group.position.x - obstacle.x, dz = zombie.group.position.z - obstacle.z;
      const distance = Math.hypot(dx, dz), minimum = obstacle.radius + 0.48;
      if (distance < minimum) {
        zombie.group.position.x = obstacle.x + (distance ? dx / distance : 1) * minimum;
        zombie.group.position.z = obstacle.z + (distance ? dz / distance : 0) * minimum;
      }
    }
  }

  getChallengeStatus() {
    const seconds = Math.ceil(this.timeRemaining);
    if (this.arrivalPlayer) return { title: 'ENTERING THE FINAL ENCOUNTER', detail: 'Step through the red portal. The Dean awaits across the arena.',
      timer: '02:30', label: 'GET READY', progress: 1, tone: 'desert', mode: 'encounter' };
    const destroyed = this.houses.filter(house => !house.alive).length;
    const killed = this.zombies.filter(zombie => !zombie.alive).length;
    return { title: 'FINAL ENCOUNTER', detail: `Final Year · Mud houses ${destroyed} / ${this.houses.length} · Zombies ${killed} / ${this.zombies.length}`,
      timer: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
      label: this.timerExpired ? 'TIME ELAPSED' : 'TIME REMAINING', progress: this.timeRemaining / FINAL_ENCOUNTER_SECONDS,
      tone: this.timeRemaining <= 30 ? 'danger' : 'desert', mode: 'encounter' };
  }

  dispose() {
    if (this.disposed) return; this.disposed = true;
    this._restoreArrivalPlayer();
    this.entrancePortal?.mixer?.stopAllAction();
    if (this.entrancePortal) this._collectResources(this.entrancePortal.root);
    for (const house of this.houses) house.dispose();
    for (const zombie of this.zombies) { zombie.group.removeFromParent(); zombie.dispose(); }
    this._collectResources(this.degreeScroll || new THREE.Group());
    this.degreeScroll?.removeFromParent(); this.dean?.group.removeFromParent(); this.dean?.dispose();
    this.environment?.traverse(node => { if (node.isLight) node.shadow?.dispose(); });
    for (const resource of this.resources) resource.dispose();
    this.root.removeFromParent(); this.scene.background = this.previousBackground; this.scene.fog = this.previousFog;
    this.degreeGrip = null; this.zombies = []; this.spawnRecords = []; this.houses = [];
  }
}
