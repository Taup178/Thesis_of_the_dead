import * as THREE from 'three';
import { Zombie } from '../enemies/Zombie.js';
import { createDegreeScroll, createLeftHandDegreeGrip } from '../props/DegreeScroll.js';
import { createSophomorePatterns } from './sophomorePatterns.js';
import { SOPHOMORE_LAYOUT as layout, SPIKE_CORRIDOR_PUZZLE } from './SophomoreLayout.js';
import { RetractingSpikes } from '../environment/RetractingSpikes.js';
import { SophomoreAmbush, AMBUSH_WAVES } from './SophomoreAmbush.js';
import { createSophomoreRoom, createTileGeometry, createTileFracture } from '../environment/SophomoreRoom.js';
import { createSophomoreGauntlet, updateSophomoreGauntlet, getSophomoreBladeX } from './SophomoreGauntlet.js';
import { RoomExitPortal, PortalPassage, PortalEmergence, PORTAL_TRAVEL_SPEED } from '../props/RoomExitPortal.js';

const DIFFICULTY = [
  { jumpDuration: 0.72, pause: 0.24, tileTime: 3.2 },
  { jumpDuration: 0.62, pause: 0.20, tileTime: 2.9 },
  { jumpDuration: 0.54, pause: 0.16, tileTime: 2.6 },
  { jumpDuration: 0.47, pause: 0.13, tileTime: 2.3 },
];
const GREY = 0xffffff, AMBER = 0xf6bb55, GREEN = 0x46dd9b, RED = 0xe55463;
const UP = new THREE.Vector3(0, 1, 0);
const CHASE_SPEED = 5.8, JUMP_VELOCITY = 7.2;
const DEAN_CHASE_SPEED = PORTAL_TRAVEL_SPEED;
const SPIKE_DAMAGE = 20, SPIKE_HIT_INTERVAL = 0.8;

/** The Sophomore Room: chase the Dean through three hazards, then remember his route. */
export class Level2 {
  constructor(scene, restartState = null) {
    this.scene = scene;
    this.previousBackground = scene.background;
    this.previousFog = scene.fog;
    this.root = new THREE.Group();
    this.root.name = 'SophomoreRoom';
    this.scene.add(this.root);
    this.tiles = [[], []]; // tiles[i][j]
    this.seed = restartState?.seed ?? Math.floor(Math.random() * 4294967296);
    this.patterns = createSophomorePatterns(this.seed);
    this.rows = this.patterns.at(-1).at(-1)[1] + 1;
    this.tileSize = 4.2;
    this.tileSpacing = 4.8;
    this.stageIndex = THREE.MathUtils.clamp(restartState?.stageIndex || 0, 0, this.patterns.length - 1);
    // Memory keeps its saved index of 2; the new spike corridor uses index 3.
    this.puzzleIndex = THREE.MathUtils.clamp(restartState?.puzzleIndex ?? 0, 0, 3);
    this.spikeHitCooldown = 0;
    this.spikeProgress = 0;
    this.ambushWasCleared = !!restartState?.ambushCleared;
    this.memoryApproachArmed = true;
    this.isCheckpointRestart = restartState !== null;
    this.creditsCollected = this.stageIndex;
    this.zombies = []; // The Dean is a guide, never a combat target.
    this.credits = [];
    this.treeMeshes = [];
    this.allowsShooting = true;
    this.phase = 'arrival';
    this.deanBladeIntro = false;
    this.introTimer = 0;
    this.expectedIndex = 0;
    this.currentTile = null;
    this.demonstrationIndex = 0;
    this.hopTimer = 0;
    this.hopStarted = false;
    this.levelComplete = false;
    this.failureReason = '';
    this.deanFacing = new THREE.Quaternion();
    this.deanFacingTarget = new THREE.Quaternion();
    this.localLights = [];
    this.disposed = false;
    this.extraGeometries = new Set();
  }

  get title() { return 'Chapter 2: The Sophomore Room'; }
  get portalCinematicActive() {
    return !!this.arrivalPlayer || this.deanBladeIntro || this.phase === 'dean_exit' || this.phase === 'entering';
  }
  get controlsHint() {
    return 'WASD: Move | Shift: Sprint | Space: Jump | Q: Roll | Mouse: Look | Click: Shoot | F: Gun Bash | C: Camera | R: Retry Checkpoint | Esc: Pause';
  }
  get pattern() { return this.patterns[this.stageIndex]; }
  get difficulty() { return DIFFICULTY[this.stageIndex]; }
  get spawnPoint() {
    if (this.puzzleIndex === 0) return new THREE.Vector3(0, 0, layout.spawnZ);
    if (this.puzzleIndex === 1) return new THREE.Vector3(0, 0, layout.bridgeCheckpointZ);
    if (this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE) return new THREE.Vector3(0, 0, layout.spikeCheckpointZ);
    if (this.stageIndex === 0) return new THREE.Vector3((this.pattern[0][0] - 0.5) * this.tileSpacing, 0, 0);
    return this.tilePosition(...this.pattern[0]);
  }

  async load(onProgress) {
    this._createRoom();
    onProgress?.(0.3);
    this._createTiles();
    if (this.puzzleIndex !== 2 && !this.ambushWasCleared) {
      this.ambush = new SophomoreAmbush(this);
      this.ambush.load();
    }
    onProgress?.(0.6);
    const [i, j] = this.pattern[0];
    this.dean = new Zombie(this.scene, this.deanCheckpointPosition(i, j), './assets/models/zombies/Zombie_Arm.gltf');
    this.dean.isBoss = true;
    this.bossMarker = this.dean.group;
    this.bossMarker.name = 'Dean';
    this.bossMarker.scale.setScalar(1.25);
    this.root.add(this.bossMarker);
    await Promise.all([this.dean.ready, this.ambush?.ready, this.exitPortal.load(), this.entrancePortal?.load(), this.walls.load(), this.torches.load(), this.floors.load(), this.spikePit.load()]);
    this.spikeTipY = this.spikePit.tipY;
    this._attachDegree();
    this.torches.decorateMaterial(this.tileMaterial);
    this.torches.installLighting();
    this.dean._playAction('Idle');
    this._setTileColor(this.tiles[i][j], RED);
    onProgress?.(1);
  }

  preparePlayer(player) {
    player.group.position.copy(this.spawnPoint);
    player.lastSafePosition.copy(player.group.position);
    player.verticalVelocity = 0;
    player.velocity.set(0, 0, 0);
    player.grounded = true;
    player.scriptedMovement = false;
    player.platformSupport = this.puzzleIndex < 2 ? this.bladeSurface :
      this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE ? this.bridgeExitSurface :
      this.stageIndex === 0 ? this.startSurface : this.tiles[this.pattern[0][0]][this.pattern[0][1]].surface;
    player.cameraObstacles = [];
    player.cameraGroundY = 0;
    player.pitch = -0.25;
    player.yaw = 0;
    player.group.rotation.y = 0;
    player._updateCamera();
    if (this.puzzleIndex === 0 && !this.isCheckpointRestart) this._beginArrival(player);
    else if (this.puzzleIndex !== 2) {
      this.phase = 'chase';
      this.bossMarker.position.copy(this._deanStepPosition(0));
      this.dean._playAction('Idle');
    }
    this._updateLocalLighting(player);
  }

  _updateLocalLighting(player, dt = 0) {
    this.torches?.update(dt, player.camera.position);
  }

  _beginArrival(player) {
    this.phase = 'dean_arrival';
    this.arrivalPlayer = player;
    this.arrivalPlayerVisible = player.group.visible;
    this.arrivalBodyVisible = player.bodyMesh.visible;
    player.scriptedMovement = true;
    player.group.visible = false;
    player.bodyMesh.visible = true;
    if (player.mixer) player._playAnimation('Idle_Gun', 'Idle');
    player.weaponPresentation?.update(0);
    this.bossMarker.position.copy(this.spawnPoint);
    this.bossMarker.lookAt(new THREE.Vector3(0, 0, layout.deanStartZ));
    this.dean._playAction('Walk');
    this.dean.mixer?.update(0);
    this.deanArrival = new PortalEmergence(this.bossMarker, this.entrancePortal.center);
    player.camera.position.set(7.5, 4.5, this.spawnPoint.z - 6.5);
    player.camera.lookAt(0, 1.5, this.spawnPoint.z - 0.8);
    player.camera.updateMatrixWorld(true);
    this.arrivalCameraPosition = player.camera.position.clone();
    this.arrivalCameraRotation = player.camera.quaternion.clone();
  }

  _restoreArrivalPlayer() {
    if (!this.arrivalPlayer) return;
    const player = this.arrivalPlayer;
    this.playerArrival?.restore();
    player.group.visible = this.arrivalPlayerVisible;
    player.bodyMesh.visible = this.arrivalBodyVisible;
    player.scriptedMovement = false;
    player._updateCamera();
    player.weaponPresentation?.update(0);
    this.arrivalPlayer = null;
  }

  _updateArrival(dt, player) {
    if (this.phase === 'dean_arrival') {
      this.deanArrival.update(dt);
      if (this.deanArrival.time < this.deanArrival.duration) return;
      this.phase = 'dean_to_start';
      this.introTimer = 0;
      this.dean._playAction('Walk');
    } else if (this.phase === 'dean_to_start') {
      this.introTimer += dt;
      const t = Math.min(1, this.introTimer / (3 / DEAN_CHASE_SPEED));
      this.bossMarker.position.lerpVectors(this.spawnPoint, new THREE.Vector3(0, 0, layout.deanStartZ), t);
      if (t < 1) return;
      this.dean._playAction('Idle', 0.08);
      this.bossMarker.lookAt(this.spawnPoint);
      this.phase = 'player_arrival';
      player.group.visible = true;
      player.mixer?.update(0);
      this.playerArrival = new PortalEmergence(player.group, this.entrancePortal.center, player.bodyMesh);
    } else if (this.phase === 'player_arrival') {
      this.playerArrival.update(dt);
      player.mixer?.update(dt);
      if (this.playerArrival.time < this.playerArrival.duration) return;
      player.lastSafePosition.copy(player.group.position);
      this.phase = 'arrival_camera';
      this.introTimer = 0;
    } else if (this.phase === 'arrival_camera') {
      this.introTimer += dt;
      const t = THREE.MathUtils.smoothstep(this.introTimer, 0, 0.8);
      player._updateCamera();
      player.camera.position.lerpVectors(this.arrivalCameraPosition, player.camera.position, t);
      player.camera.quaternion.slerpQuaternions(this.arrivalCameraRotation, player.camera.quaternion, t);
      player.camera.updateMatrixWorld(true);
      if (t < 1) return;
      this._restoreArrivalPlayer();
      this.phase = 'arrival';
      this.introTimer = 0;
      this._beginDeanChallenge(player);
    }
  }

  tilePosition(i, j) {
    return new THREE.Vector3((i - 0.5) * this.tileSpacing, 0, -(j + 1) * this.tileSpacing);
  }

  deanCheckpointPosition(i, j) {
    // Give the player the middle of the tile; the Dean waits at its far outer corner.
    const clearance = this.tileSize * 0.38;
    return this.tilePosition(i, j).add(new THREE.Vector3(i === 0 ? -clearance : clearance, 0, -clearance));
  }

  _deanStepPosition(index) {
    const coordinate = this.pattern[index];
    return index === 0 || index === this.pattern.length - 1
      ? this.deanCheckpointPosition(...coordinate) : this.tilePosition(...coordinate);
  }

  _mesh(geometry, material, x, y, z) {
    this.torches?.decorateMaterial(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  _createRoom() {
    createSophomoreRoom(this);
    this.retractingSpikes = new RetractingSpikes(this);
    createSophomoreGauntlet(this);
    this.torches.removeAtBladeAnchors(this.blades.map(blade => blade.z - 0.38));
    this.exitPortal = new RoomExitPortal(this.root, this.exitPosition);
    this.entrancePortal = new RoomExitPortal(this.root, this.entrancePosition, { red: true, rotationY: Math.PI });
  }

  _createTiles() {
    const geometry = this.floors.mapGeometry(createTileGeometry(this.tileSize));
    this.tileFracture = createTileFracture(this.tileSize);
    for (const piece of this.tileFracture.pieces) {
      this.floors.mapGeometry(piece.geometry, piece.x, piece.z); this.extraGeometries.add(piece.geometry);
    }
    const crackMaterial = new THREE.LineBasicMaterial({ color: 0x090b0e });
    const rimGeometry = new THREE.BoxGeometry(this.tileSize - 0.06, 0.13, this.tileSize - 0.06);
    const half = this.tileSize / 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < this.rows; j++) {
      const position = this.tilePosition(i, j);
      const material = this.floors.register(this.tileMaterial.clone());
      const mesh = this._mesh(geometry, material, position.x, -0.225, position.z);
      mesh.name = `Tile_${i}_${j}`;
      const cracks = new THREE.LineSegments(this.tileFracture.cracks, crackMaterial);
      cracks.visible = false; mesh.add(cracks);
      const rim = new THREE.Mesh(rimGeometry, this.tileTrimMaterial);
      rim.position.y = -0.22; rim.castShadow = rim.receiveShadow = true; mesh.add(rim);
      const tile = { i, j, mesh, cracks, preview: false, timer: null, falling: false, fallSpeed: 0, checkpoint: false };
      tile.surface = { minX: position.x - half, maxX: position.x + half,
        minZ: position.z - half, maxZ: position.z + half, y: 0, tile };
      this.tiles[i][j] = tile;
    }
  }

  _attachDegree() {
    const originalGeometry = new Set();
    this.bossMarker.traverse(node => { if (node.isMesh) originalGeometry.add(node.geometry); });
    this.degreeScroll = createDegreeScroll();
    const hand = this.bossMarker.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('LowerArm.L'));
    if (hand) {
      this.degreeScroll.scale.set(0.82, 0.78, 0.78);
      this.degreeScroll.position.set(0, 0.35, -0.06);
      hand.add(this.degreeScroll);
      this.degreeGrip = createLeftHandDegreeGrip(hand, this.degreeScroll);
      this.degreeGrip();
    } else {
      this.degreeScroll.position.set(-0.4, 1.2, -0.2);
      this.bossMarker.add(this.degreeScroll);
    }
    this.bossMarker.traverse(node => {
      if (node.isMesh && !originalGeometry.has(node.geometry)) this.extraGeometries.add(node.geometry);
    });
  }

  getPlatforming() {
    const surfaces = [this.startSurface, this.exitSurface];
    if (this.retractingSpikes) surfaces.push(this.bridgeExitSurface, this.retractingSpikes.surface);
    surfaces.push(this.bladeSurface);
    for (const bridge of this.bridgePlatforms) surfaces.push(bridge.surface);
    for (const column of this.tiles) for (const tile of column) if (!tile.falling) surfaces.push(tile.surface);
    const canMove = !this.deanBladeIntro && ['dean_challenge', 'chase', 'follow', 'exit'].includes(this.phase);
    return { surfaces, canMove,
      moveSpeed: this.puzzleIndex !== 2 ? CHASE_SPEED : 4.5, jumpVelocity: JUMP_VELOCITY, allowSprint: true,
      allowDodge: canMove };
  }

  _setTileColor(tile, color) {
    tile.mesh.material.color.setHex(color);
    tile.mesh.material.emissive.setHex(color === GREY ? 0x000000 : color);
    tile.mesh.material.emissiveIntensity = color === GREY ? 0 : 0.45;
  }

  _beginDemonstration() {
    this.phase = 'watch';
    this.demonstrationIndex = 0;
    this.hopTimer = 0;
    this.hopStarted = false;
    const [i, j] = this.pattern[0];
    const start = this.tiles[i][j];
    start.timer = null; // Standing at a completed checkpoint is safe while watching.
    start.preview = true;
    this._setTileColor(start, AMBER);
    this.bossMarker.position.copy(this._deanStepPosition(0));
    this.dean._playAction('Idle');
  }

  _updateDemonstration(dt) {
    const from = this._deanStepPosition(this.demonstrationIndex);
    const to = this._deanStepPosition(this.demonstrationIndex + 1);
    this.hopTimer += dt;
    if (this.hopTimer < this.difficulty.pause) return;
    if (!this.hopStarted) {
      this.hopStarted = true;
      const jump = this.dean.actions.Jump;
      if (jump) {
        jump.setLoop(THREE.LoopOnce, 1);
        jump.clampWhenFinished = true;
        jump.setEffectiveTimeScale(jump.getClip().duration / this.difficulty.jumpDuration);
      }
      this.dean._playAction('Jump', 0.08, true);
      this.bossMarker.lookAt(to.x, this.bossMarker.position.y, to.z);
    }
    const t = THREE.MathUtils.clamp((this.hopTimer - this.difficulty.pause) / this.difficulty.jumpDuration, 0, 1);
    this.bossMarker.position.lerpVectors(from, to, t);
    this.bossMarker.position.y += Math.sin(t * Math.PI) * 1.4;
    if (t < 1) return;
    this.demonstrationIndex++;
    const [i, j] = this.pattern[this.demonstrationIndex];
    this.tiles[i][j].preview = true;
    this._setTileColor(this.tiles[i][j], AMBER);
    this.hopTimer = 0;
    this.hopStarted = false;
    this.dean._playAction('Idle', 0.08);
    if (this.demonstrationIndex === this.pattern.length - 1) this._finishDemonstration();
  }

  _finishDemonstration() {
    // Erase the route. Only the final destination is green during the player's turn.
    for (const column of this.tiles) for (const tile of column) {
      if (tile.falling) continue;
      tile.preview = false;
      this._setTileColor(tile, GREY);
    }
    const [i, j] = this.pattern.at(-1);
    this.targetTile = this.tiles[i][j];
    this.targetTile.checkpoint = true;
    this._setTileColor(this.targetTile, GREEN);
    this.bossMarker.lookAt(this.tilePosition(...this.pattern[0]));
    this.phase = 'follow';
    this.expectedIndex = this.stageIndex === 0 ? 0 : 1;
    if (this.currentTile) this.currentTile.timer = this.difficulty.tileTime;
  }

  _collapseTile(tile) {
    if (tile.falling) return;
    tile.falling = true;
    tile.timer = null;
    this._setTileColor(tile, RED);
    tile.mesh.visible = false;
    tile.fragments = this.tileFracture.pieces.map((piece, index) => {
      const mesh = new THREE.Mesh(piece.geometry, this.tileMaterial);
      mesh.position.copy(tile.mesh.position).add(new THREE.Vector3(piece.x, 0, piece.z));
      mesh.castShadow = mesh.receiveShadow = true; this.root.add(mesh);
      return { mesh, velocity: new THREE.Vector3(piece.x * 0.65, -0.4 - index * 0.08, piece.z * 0.65),
        spin: new THREE.Vector3(Math.sin(index * 2) * 1.8, Math.cos(index) * 0.8, Math.cos(index * 3) * 1.5) };
    });
  }

  _fail(player, message, tile = null) {
    if (this.phase === 'failed' || this.levelComplete) return;
    this.phase = 'failed';
    this.failureReason = message;
    if (tile) this._collapseTile(tile);
    player.grounded = false;
    player.platformSupport = null;
    player.verticalVelocity = Math.min(player.verticalVelocity, -1);
  }

  _onTileLanding(tile, player) {
    if (tile === this.currentTile) return; // Hopping in place never restarts the countdown.
    const expected = this.pattern[this.expectedIndex];
    if (!expected || tile.i !== expected[0] || tile.j !== expected[1]) {
      this._fail(player, 'That was not the next tile. Watch the Dean and remember the order.', tile);
      return;
    }
    this.currentTile = tile;
    this.expectedIndex++;
    if (this.expectedIndex < this.pattern.length) {
      tile.timer = this.difficulty.tileTime;
      return;
    }
    tile.timer = null;
    this.creditsCollected++;
    player.addScore(300);
    if (this.stageIndex === this.patterns.length - 1) {
      this.phase = 'dean_exit';
      for (const column of this.tiles) for (const other of column) other.timer = null;
      this.dean._playAction('Walk');
      return;
    }
    this.stageIndex++;
    this._beginDemonstration();
  }

  _onEarlyMemoryLanding(tile, player) {
    const first = this.tiles[this.pattern[0][0]][this.pattern[0][1]];
    const position = this.bossMarker.position;
    const surface = first.surface;
    if (tile === first && position.y < 0.2 && position.x >= surface.minX && position.x <= surface.maxX &&
        position.z >= surface.minZ && position.z <= surface.maxZ) {
      this.earlyMemoryHop = { from: position.clone(), to: this._deanStepPosition(1), time: 0,
        duration: this.difficulty.jumpDuration };
      const jump = this.dean.actions.Jump;
      if (jump) {
        jump.setLoop(THREE.LoopOnce, 1); jump.clampWhenFinished = true;
        jump.setEffectiveTimeScale(jump.getClip().duration / this.earlyMemoryHop.duration);
      }
      this.dean._playAction('Jump', 0.08, true);
    }
    this._fail(player, this.ambush && !this.ambush.cleared
      ? 'Clear all zombie waves before stepping onto the memory tiles.'
      : 'Approach the memory entrance before jumping onto its tiles.', tile);
  }

  _updateEarlyMemoryHop(dt) {
    const hop = this.earlyMemoryHop;
    hop.time += dt;
    const t = Math.min(1, hop.time / hop.duration);
    this.bossMarker.position.lerpVectors(hop.from, hop.to, t);
    this.bossMarker.position.y += Math.sin(t * Math.PI) * 1.4;
    this._turnDean(hop.to, dt);
    if (t < 1) return;
    this.bossMarker.position.copy(hop.to);
    this.earlyMemoryHop = null;
    this.dean._playAction('Idle', 0.08);
  }

  _updateExit(dt, player) {
    if (this.phase === 'dean_exit') {
      if (!this.deanPassage) {
        const direction = this.portalApproachPoint.clone().sub(this.bossMarker.position);
        const distance = direction.length();
        if (distance > 0.12) {
          this.bossMarker.lookAt(this.portalApproachPoint);
          this.bossMarker.position.addScaledVector(direction.normalize(), Math.min(3 * dt, distance));
          return;
        }
        this.dean._playAction('Idle');
        this.deanPassage = new PortalPassage(this.bossMarker, this.exitPortal.center);
      }
      this.deanPassage.update(dt);
      if (this.deanPassage.complete) this.phase = 'exit';
    } else if (this.phase === 'exit') {
      if (player.grounded && player.alive && player.group.position.distanceTo(this.portalApproachPoint) < 1.15) {
        this.phase = 'entering';
        player.scriptedMovement = true; player.velocity.set(0, 0, 0); player.verticalVelocity = 0;
        this.portalPlayer = player; this.playerBodyVisible = player.bodyMesh.visible; player.bodyMesh.visible = true;
        if (player.mixer) player._playAnimation('Idle_Gun', 'Idle');
        this.playerPassage = new PortalPassage(player.group, this.exitPortal.center, player.bodyMesh);
        this.cameraStart = player.camera.position.clone();
        this.cameraEnd = this.exitPortal.center.clone().add(new THREE.Vector3(-3, 1.8, 7));
        player.weaponPresentation?.update(0);
      }
    } else if (this.phase === 'entering') {
      const center = this.playerPassage.update(dt);
      player.mixer?.update(dt);
      player.camera.position.lerpVectors(this.cameraStart, this.cameraEnd, THREE.MathUtils.smoothstep(this.playerPassage.time, 0,
        Math.min(0.65, this.playerPassage.duration + 0.12)));
      player.camera.lookAt(center); player.camera.updateMatrixWorld(true);
      if (this.playerPassage.complete) { this.phase = 'complete'; this.levelComplete = true; }
    }
  }

  _beginDeanChallenge(player = null) {
    this.deanBladeIntro = this.puzzleIndex === 0;
    if (this.deanBladeIntro && player) {
      this.deanIntroPlayer = player;
      this.deanIntroWasScripted = player.scriptedMovement;
      player.scriptedMovement = true;
      player.velocity.set(0, 0, 0);
      player.isDodging = false; player.dodgeTimer = 0; player.dodgeProgress = 0;
    }
    const step = (x, z, duration, jump = false, dodge = 0) =>
      ({ position: new THREE.Vector3(x, 0, z), duration, jump, dodge });
    const start = { position: this.bossMarker.position.clone(), duration: 0, jump: false };
    this.deanPath = [start];
    if (this.puzzleIndex === 0) {
      let elapsed = 0;
      for (const blade of this.blades) {
        // Recenter in the safe space between blades, then dodge away from the
        // blade's predicted sweep during the crossing, leaving body clearance.
        const approach = step(0, blade.z + 2, 0);
        approach.duration = this.deanPath.at(-1).position.distanceTo(approach.position) / DEAN_CHASE_SPEED;
        this.deanPath.push(approach);
        elapsed += approach.duration;
        const sideDuration = 3.8 / DEAN_CHASE_SPEED, crossDuration = 4 / DEAN_CHASE_SPEED;
        const crossingTime = (this.gauntletTime || 0) + elapsed + sideDuration + crossDuration / 2;
        const side = getSophomoreBladeX(blade, crossingTime) >= 0 ? -1 : 1;
        this.deanPath.push(step(side * 3.8, blade.z + 2, sideDuration, false, side),
          step(side * 3.8, blade.z - 2, crossDuration, false, side));
        elapsed += sideDuration + crossDuration;
      }
    }
    // Run through the early puzzles continuously, then wait at the memory tile.
    const first = this._deanStepPosition(0);
    this.deanJumpGravity = player?.gravity ?? -20;
    this.deanJumpFlightTime = -2 * JUMP_VELOCITY / this.deanJumpGravity;
    const jumpDistance = CHASE_SPEED * this.deanJumpFlightTime;
    const jumpDuration = jumpDistance / DEAN_CHASE_SPEED;
    const walkTo = (x, z) => {
      const next = step(x, z, 0);
      next.duration = this.deanPath.at(-1).position.distanceTo(next.position) / DEAN_CHASE_SPEED;
      this.deanPath.push(next);
    };
    const jumpForward = () => {
      const from = this.deanPath.at(-1).position;
      this.deanPath.push(step(from.x, from.z - jumpDistance, jumpDuration, true));
    };
    // Preserve the landing positions and arc height at the guide's chase pace.
    walkTo(0, this.bladeSurface.minZ + 0.2);
    jumpForward();
    for (const bridge of this.bridgePlatforms) {
      walkTo(0, bridge.surface.minZ + 0.2);
      jumpForward();
    }
    walkTo(this.tilePosition(...this.pattern[0]).x, this.startSurface.minZ + 0.25);
    jumpForward();
    walkTo(first.x, first.z);
    this.deanSegment = 0;
    this.deanSegmentTime = 0;
    this.phase = 'dean_challenge';
    this.deanFacing.copy(this.bossMarker.quaternion);
    this._playDeanChallengeStep();
  }

  _finishDeanBladeIntro() {
    this.deanBladeIntro = false;
    if (!this.deanIntroPlayer) return;
    const player = this.deanIntroPlayer;
    player.scriptedMovement = this.deanIntroWasScripted;
    player._updateCamera();
    player.weaponPresentation?.update(0);
    this.deanIntroPlayer = null;
  }

  _playDeanChallengeStep() {
    const next = this.deanPath[this.deanSegment + 1];
    if (!next) return;
    if (next.jump) {
      const jump = this.dean.actions.Jump;
      if (jump) {
        jump.setLoop(THREE.LoopOnce, 1);
        jump.clampWhenFinished = true;
        jump.setEffectiveTimeScale(jump.getClip().duration / next.duration);
      }
    }
    const action = next.jump ? 'Jump' : this.dean.actions.Run ? 'Run' : 'Walk';
    if (!next.jump) this.dean.actions[action]?.setEffectiveTimeScale?.(DEAN_CHASE_SPEED / CHASE_SPEED);
    this.dean._playAction(action, 0.08, next.jump);
  }

  _updateDeanChallenge(dt) {
    this.bossMarker.quaternion.copy(this.deanFacing);
    this.deanSegmentTime += dt;
    while (this.deanSegment < this.deanPath.length - 1) {
      const next = this.deanPath[this.deanSegment + 1];
      if (this.deanSegmentTime < next.duration) break;
      this.deanSegmentTime -= next.duration;
      this.deanSegment++;
      this.bossMarker.position.copy(next.position);
      if (this.deanSegment === this.deanPath.length - 1) {
        this.phase = 'chase';
        this.dean._playAction('Idle', 0.08);
        this._turnDean(this.spawnPoint, dt);
        return;
      }
      this._playDeanChallengeStep();
    }
    const from = this.deanPath[this.deanSegment].position;
    const next = this.deanPath[this.deanSegment + 1];
    const t = THREE.MathUtils.clamp(this.deanSegmentTime / next.duration, 0, 1);
    this.bossMarker.position.lerpVectors(from, next.position, t);
    if (next.jump) {
      const time = t * this.deanJumpFlightTime;
      this.bossMarker.position.y = JUMP_VELOCITY * time + 0.5 * this.deanJumpGravity * time * time;
    }
    this._turnDean(next.position, dt);
    if (next.dodge) this.bossMarker.rotateZ(-next.dodge * Math.sin(t * Math.PI) * 0.18);
  }

  _turnDean(target, dt) {
    const position = this.bossMarker.position;
    const yaw = Math.atan2(target.x - position.x, target.z - position.z);
    this.deanFacingTarget.setFromAxisAngle(UP, yaw);
    this.deanFacing.rotateTowards(this.deanFacingTarget, 8 * dt);
    this.bossMarker.quaternion.copy(this.deanFacing);
  }

  _keepDeanApart(player) {
    const away = player.group.position.clone().sub(this.bossMarker.position);
    away.y = 0;
    const distance = away.length();
    if (distance >= 2.7) return;
    if (distance < 0.001) away.set(0, 0, 1);
    else away.divideScalar(distance);
    player.group.position.addScaledVector(away, 2.7 - distance);
    player.velocity.x = player.velocity.z = 0;
    player._updateCamera();
  }

  _updateChase(dt, player) {
    if (!player.alive) return;
    if (this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE && player.grounded && player.platformSupport?.tile) {
      this._onEarlyMemoryLanding(player.platformSupport.tile, player);
      return;
    }
    const position = player.group.position;
    if (this.puzzleIndex === 0 && position.z < layout.bladeCompleteZ && player.grounded) {
      this.puzzleIndex = 1;
      return;
    }
    if (this.puzzleIndex === 1 && position.z < layout.spikeCheckpointTriggerZ && player.grounded) {
      this.puzzleIndex = SPIKE_CORRIDOR_PUZZLE;
      return;
    }
    if (this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE) {
      if (player.grounded && position.z <= layout.spikeCorridorMaxZ) this.ambush?.start();
      this.spikeProgress = THREE.MathUtils.clamp((layout.spikeEntryMaxZ - position.z) /
        (layout.spikeEntryMaxZ - layout.memoryTriggerZ), 0, 1);
      if (this.ambush && !this.ambush.cleared) { this.memoryApproachArmed = false; return; }
      if (player.grounded && position.z >= layout.memoryTriggerZ + 0.3) this.memoryApproachArmed = true;
    }
    if (this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE && position.z < layout.memoryTriggerZ && player.grounded &&
        this.phase === 'chase' && this.memoryApproachArmed) {
      this.puzzleIndex = 2;
      this._beginDemonstration();
    }
  }

  update(dt, player) {
    const events = { creditCollected: false, levelComplete: false };
    this.spikeHitCooldown = Math.max(0, this.spikeHitCooldown - dt);
    this.retractingSpikes?.update(dt);
    this.exitPortal?.update(dt, this.phase === 'entering' || this.phase === 'dean_exit');
    this.entrancePortal?.update(dt, !!this.arrivalPlayer);
    if (this.blades) updateSophomoreGauntlet(this, dt, player);
    if (this.earlyMemoryHop) this._updateEarlyMemoryHop(dt);
    if (this.arrivalPlayer) {
      this._updateArrival(dt, player);
    } else if (this.phase === 'dean_challenge') {
      this._updateDeanChallenge(dt);
      if (this.deanBladeIntro && this.bossMarker.position.z <= layout.bladeCompleteZ) this._finishDeanBladeIntro();
      if (!this.deanBladeIntro) this._updateChase(dt, player);
    } else if (this.phase === 'chase') {
      this._updateChase(dt, player);
    } else if (this.phase === 'arrival' && player.grounded) {
      this.introTimer += dt;
      if (this.introTimer >= 0.9) {
        if (this.stageIndex > 0) this.currentTile = this.tiles[this.pattern[0][0]][this.pattern[0][1]];
        this._beginDemonstration();
      }
    } else if (this.phase === 'watch') {
      this._updateDemonstration(dt);
    } else if (this.phase === 'follow') {
      const tile = player.platformSupport?.tile;
      if (player.grounded && tile) this._onTileLanding(tile, player);
    }
    if (this.puzzleIndex < 2 && this.phase === 'chase') {
      this._keepDeanApart(player);
    }
    this.ambush?.update(dt, player);
    this._updateLocalLighting(player, dt);
    if (['dean_exit', 'exit', 'entering'].includes(this.phase)) this._updateExit(dt, player);
    for (const column of this.tiles) for (const tile of column) {
      if (tile.timer !== null && !tile.falling) {
        tile.timer -= dt;
        const urgency = THREE.MathUtils.clamp(1 - Math.max(0, tile.timer) / this.difficulty.tileTime, 0, 1);
        tile.mesh.material.emissive.setHex(0xe17b43);
        tile.mesh.material.emissiveIntensity = urgency * 0.4;
        tile.cracks.visible = urgency > 0.55;
        if (tile.timer <= 0) {
          this._collapseTile(tile);
          if (tile === player.platformSupport?.tile && player.grounded) {
            this._fail(player, 'The tile collapsed. Jump to the next tile before its timer runs out.', tile);
          }
        }
      }
      if (tile.falling) {
        for (const piece of tile.fragments) {
          if (!piece.mesh.visible) continue;
          piece.velocity.y -= 18 * dt;
          piece.mesh.position.addScaledVector(piece.velocity, dt);
          piece.mesh.rotation.x += piece.spin.x * dt;
          piece.mesh.rotation.y += piece.spin.y * dt;
          piece.mesh.rotation.z += piece.spin.z * dt;
          if (piece.mesh.position.y < -12) piece.mesh.visible = false;
        }
      }
    }
    if (player.group.position.y < -0.6 && this.phase !== 'failed' && player.alive) {
      this._fail(player, this.puzzleIndex === 1
        ? 'You missed the bridge. Landing on the spikes below is fatal. Retry from the checkpoint after the blades.'
        : 'You fell between the tiles. Use Space to jump across each gap.');
    }
    if (this.phase === 'failed' && player.alive) {
      // Let the fall reveal the hazard below, in either camera mode.
      player.pitch = THREE.MathUtils.lerp(player.pitch, -0.85, 1 - Math.exp(-4 * dt));
      player._updateCamera();
    }
    const pitContact = player.alive && player.group.position.y <= this.spikeTipY;
    if (pitContact) {
      this._fail(player, 'You landed on the pit spikes. Retry from your last checkpoint.');
      player.group.position.y = this.spikeTipY; player.verticalVelocity = 0;
      player.velocity.set(0, 0, 0);
      // A fall into the pit is immediately fatal, including during a roll or hit cooldown.
      player.isDodging = false; player.dodgeTimer = 0; player.dodgeProgress = 0;
      player.health = 0; player.alive = false;
      player.hitReactionTime = 0; player.damageFlashTime = 0;
      player._updateCamera();
    } else if (player.alive && this.spikeHitCooldown === 0 && this.retractingSpikes?.hitsPlayer(player)) {
      // Retracting floor spikes use combat damage, with time between injuries.
      player.isDodging = false; player.dodgeTimer = 0; player.dodgeProgress = 0;
      player.takeDamage(SPIKE_DAMAGE);
      this.spikeHitCooldown = SPIKE_HIT_INTERVAL;
      if (!player.alive) this._fail(player, 'The spikes drained your health. Retry from your last checkpoint.');
    }
    if (this.dean?.mixer) this.dean.mixer.update(dt);
    this.degreeGrip?.();
    events.levelComplete = this.levelComplete;
    events.autoAdvance = this.levelComplete;
    return events;
  }

  getChallengeStatus() {
    const checkpoint = `Checkpoint ${this.stageIndex + 1} / ${this.patterns.length}`;
    if (this.phase === 'dean_arrival' || this.phase === 'dean_to_start') return { title: 'The Dean arrives first', detail: 'Watch him emerge, then chase him through the room.', progress: 1, timer: 'Entering the Sophomore Room', tone: 'watch' };
    if (this.phase === 'player_arrival' || this.phase === 'arrival_camera') return { title: 'Your turn to enter', detail: 'Follow the Dean through four challenges.', progress: 1, timer: 'The chase begins', tone: 'watch' };
    if (this.deanBladeIntro) return { title: 'The Dean clears the blades', detail: 'Your chase begins after he passes the final blade.',
      progress: THREE.MathUtils.clamp((layout.deanStartZ - this.bossMarker.position.z) / (layout.deanStartZ - layout.bladeCompleteZ), 0, 1),
      timer: 'Watch the Dean', tone: 'watch' };
    if (this.phase === 'chase' || this.phase === 'dean_challenge') {
      if (this.puzzleIndex === 0) return { title: '1 / 4 · Slicing disks', detail: 'Watch each sweeping blade. Q rolls through a blade; Space jumps and Shift sprints.', progress: 1 / 4, timer: 'Follow the Dean through the saws', tone: 'danger' };
      if (this.puzzleIndex === 1) return { title: '2 / 4 · Moving bridge', detail: 'Cross all six shifting platforms. Landing on the pit spikes kills instantly.', progress: 2 / 4, timer: 'Space: Jump', tone: 'follow' };
    }
    if ((this.phase === 'chase' || this.phase === 'dean_challenge') && this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE && this.ambush?.started && !this.ambush.cleared) {
      return { title: `3 / 4 · Spike ambush · Wave ${this.ambush.currentWave + 1} / ${AMBUSH_WAVES}`,
        detail: 'Clear every wave before approaching the memory entrance. Jumping onto the memory tiles early breaks them.',
        progress: this.spikeProgress, timer: `${this.ambush.remaining} zombies remaining`, tone: 'danger' };
    }
    if ((this.phase === 'chase' || this.phase === 'dean_challenge') && this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE && this.ambush?.cleared) {
      return { title: '3 / 4 · All waves cleared', detail: this.memoryApproachArmed
        ? 'Approach the Dean at the memory entrance to begin.' : 'Step back to the memory entrance, then approach the Dean to begin.',
        progress: 1, timer: 'Memory puzzle unlocked', tone: 'follow' };
    }
    if ((this.phase === 'chase' || this.phase === 'dean_challenge') && this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE) return { title: '3 / 4 · Retracting spikes',
      detail: 'Rows 1/4/7 → 2/5/8 → 3/6/9. Cross when lowered; amber rims warn before rising.',
      progress: this.spikeProgress, timer: 'Watch the spike pattern', tone: 'danger' };
    if (this.phase === 'dean_exit') return { title: 'The Dean is escaping', detail: 'Watch him enter the portal. Your checkpoint is safe.', progress: 1, timer: 'All four routes remembered', tone: 'watch' };
    if (this.phase === 'exit') return { title: 'Follow the Dean', detail: 'Walk onto the landing and into the green portal.', progress: 1, timer: 'The Final Encounter awaits', tone: 'follow' };
    if (this.phase === 'entering') return { title: 'Entering the Final Encounter', detail: 'The portal pulls you through to final year.', progress: 1, timer: 'Second year complete', tone: 'follow' };
    if (this.phase === 'arrival') return { title: '4 / 4 · Memory tiles', detail: 'Watch the Dean. His route disappears when your turn starts.', progress: 1, timer: 'Watch → Memorize → Jump', tone: 'watch' };
    if (this.phase === 'watch') return { title: `4 / 4 · Watch the Dean · ${checkpoint}`, detail: `${this.pattern.length - 1} jumps. Remember every landing, including sideways jumps.`, progress: 1, timer: 'You are safe while watching', tone: 'watch' };
    if (this.phase === 'failed') return { title: 'Challenge failed', detail: this.failureReason, progress: 0, timer: 'Retry from your last checkpoint', tone: 'danger' };
    if (this.phase === 'complete') return { title: 'Second year complete', detail: 'Every pattern remembered.', progress: 1, timer: 'All checkpoints reached', tone: 'follow' };
    const remaining = this.currentTile?.timer;
    return { title: `4 / 4 · Your turn · ${checkpoint}`, detail: `Walk up, then Space to jump. ${Math.max(0, this.expectedIndex - 1)} / ${this.pattern.length - 1} jumps completed.`,
      progress: remaining == null ? 1 : Math.max(0, remaining / this.difficulty.tileTime),
      timer: remaining == null ? 'Jump onto the Dean’s first tile to begin' : `${Math.max(0, remaining).toFixed(1)}s before this tile falls`,
      tone: remaining != null && remaining < 0.7 ? 'danger' : 'follow' };
  }

  getRestartState() {
    const state = { puzzleIndex: this.puzzleIndex, stageIndex: this.stageIndex, seed: this.seed };
    if (this.puzzleIndex === SPIKE_CORRIDOR_PUZZLE && (this.ambushWasCleared || this.ambush?.cleared)) state.ambushCleared = true;
    return state;
  }
  getCompletionText() { return 'You chased the Dean through four challenges and cleared The Sophomore Room. Second year complete!'; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.walls?.dispose();
    this.torches?.dispose();
    this.floors?.dispose();
    this.spikePit?.dispose();
    this.retractingSpikes?.dispose();
    this.ambush?.dispose();
    this._restoreArrivalPlayer();
    this._finishDeanBladeIntro();
    this.playerPassage?.restore();
    if (this.portalPlayer) {
      this.portalPlayer.bodyMesh.visible = this.playerBodyVisible;
      this.portalPlayer.scriptedMovement = false;
    }
    this.exitPortal?.mixer?.stopAllAction();
    this.entrancePortal?.mixer?.stopAllAction();
    const resources = new Set(this.extraGeometries);
    if (this.tileMaterial) resources.add(this.tileMaterial);
    const collect = node => {
      if (node.isLight) node.shadow?.dispose();
      if (node.isInstancedMesh) node.dispose();
      if (node.isSkinnedMesh) node.skeleton.dispose();
      if (!node.isMesh && !node.isLine) return;
      resources.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
      }
    };
    this.degreeScroll?.traverse(collect);
    this.degreeScroll?.removeFromParent();
    this.bossMarker?.removeFromParent();
    this.dean?.dispose();
    this.degreeGrip = null;
    this.root.traverse(collect);
    for (const resource of resources) resource.dispose();
    this.root.removeFromParent();
    this.scene.background = this.previousBackground;
    this.scene.fog = this.previousFog;
    this.localLights = [];
    this.tiles = [[], []];
  }
}
