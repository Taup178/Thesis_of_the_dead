import * as THREE from 'three';
import { Zombie } from '../enemies/Zombie.js';
import { createDegreeScroll, createLeftHandDegreeGrip } from '../props/DegreeScroll.js';
import { createSophomorePatterns } from './sophomorePatterns.js';
import { createSophomoreRoom, createTileGeometry, createTileFracture } from '../environment/SophomoreRoom.js';
import { RoomExitPortal, PortalPassage, PortalEmergence } from '../props/RoomExitPortal.js';

const DIFFICULTY = [
  { jumpDuration: 0.72, pause: 0.24, tileTime: 3.2 },
  { jumpDuration: 0.62, pause: 0.20, tileTime: 2.9 },
  { jumpDuration: 0.54, pause: 0.16, tileTime: 2.6 },
  { jumpDuration: 0.47, pause: 0.13, tileTime: 2.3 },
];
const GREY = 0x626b79, AMBER = 0xf6bb55, GREEN = 0x46dd9b, RED = 0xe55463;

/** The Sophomore Room: watch, remember, then jump before the tiles fall. */
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
    this.creditsCollected = this.stageIndex;
    this.zombies = []; // The Dean is a guide, never a combat target.
    this.credits = [];
    this.treeMeshes = [];
    this.allowsShooting = false;
    this.phase = 'arrival';
    this.introTimer = 0;
    this.expectedIndex = 0;
    this.currentTile = null;
    this.demonstrationIndex = 0;
    this.hopTimer = 0;
    this.hopStarted = false;
    this.levelComplete = false;
    this.failureReason = '';
    this.disposed = false;
    this.extraGeometries = new Set();
  }

  get title() { return 'Chapter 2: The Sophomore Room'; }
  get controlsHint() {
    return 'WASD: Move | Space: Jump | Mouse: Look | C: 1st/3rd Person | R: Retry Checkpoint | Esc: Pause';
  }
  get pattern() { return this.patterns[this.stageIndex]; }
  get difficulty() { return DIFFICULTY[this.stageIndex]; }
  get spawnPoint() {
    if (this.stageIndex === 0) return new THREE.Vector3((this.pattern[0][0] - 0.5) * this.tileSpacing, 0, 0);
    return this.tilePosition(...this.pattern[0]);
  }

  async load(onProgress) {
    this._createRoom();
    onProgress?.(0.3);
    this._createTiles();
    onProgress?.(0.6);
    const [i, j] = this.pattern[0];
    this.dean = new Zombie(this.scene, this.deanCheckpointPosition(i, j), './assets/models/zombies/Zombie_Arm.gltf');
    this.dean.isBoss = true;
    this.bossMarker = this.dean.group;
    this.bossMarker.name = 'Dean';
    this.bossMarker.scale.setScalar(1.25);
    this.root.add(this.bossMarker);
    await Promise.all([this.dean.ready, this.exitPortal.load(), this.entrancePortal.load()]);
    this._attachDegree();
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
    player.platformSupport = this.stageIndex === 0 ? this.startSurface : this.tiles[this.pattern[0][0]][this.pattern[0][1]].surface;
    player.cameraObstacles = [];
    player.cameraGroundY = 0;
    player.pitch = -0.25;
    player.yaw = 0;
    player.group.rotation.y = 0;
    player._updateCamera();
    if (this.stageIndex === 0) this._beginArrival(player);
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
    this.bossMarker.lookAt(this._deanStepPosition(0));
    this.dean._playAction('Walk');
    this.dean.mixer?.update(0);
    this.deanArrival = new PortalEmergence(this.bossMarker, this.entrancePortal.center);
    player.camera.position.set(7.5, 4.5, -6.5);
    player.camera.lookAt(0, 1.5, -0.8);
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
      const jump = this.dean.actions.Jump;
      if (jump) {
        jump.setLoop(THREE.LoopOnce, 1);
        jump.clampWhenFinished = true;
        jump.setEffectiveTimeScale(jump.getClip().duration);
      }
      this.dean._playAction('Jump', 0.08, true);
    } else if (this.phase === 'dean_to_start') {
      this.introTimer += dt;
      const t = Math.min(1, this.introTimer);
      this.bossMarker.position.lerpVectors(this.spawnPoint, this._deanStepPosition(0), t);
      this.bossMarker.position.y += Math.sin(t * Math.PI) * 1.4;
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
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  _createRoom() {
    createSophomoreRoom(this);
    this.exitPortal = new RoomExitPortal(this.root, this.exitPosition);
    this.entrancePortal = new RoomExitPortal(this.root, this.entrancePosition, { red: true, rotationY: Math.PI });
  }

  _label(text, width, height, x, y, z) {
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext('2d');
    context.font = '600 38px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#c8d2de';
    context.fillText(text, 256, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = this._mesh(new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), x, y, z);
    label.rotation.x = -Math.PI / 2;
    label.castShadow = false;
    label.receiveShadow = false;
    return label;
  }

  _createTiles() {
    const geometry = createTileGeometry(this.tileSize);
    this.tileFracture = createTileFracture(this.tileSize);
    for (const piece of this.tileFracture.pieces) this.extraGeometries.add(piece.geometry);
    const crackMaterial = new THREE.LineBasicMaterial({ color: 0x090b0e });
    const rimGeometry = new THREE.BoxGeometry(this.tileSize - 0.06, 0.13, this.tileSize - 0.06);
    const half = this.tileSize / 2;
    for (let i = 0; i < 2; i++) for (let j = 0; j < this.rows; j++) {
      const position = this.tilePosition(i, j);
      const material = this.tileMaterial.clone();
      const mesh = this._mesh(geometry, material, position.x, -0.225, position.z);
      mesh.name = `Tile_${i}_${j}`;
      const cracks = new THREE.LineSegments(this.tileFracture.cracks, crackMaterial);
      cracks.visible = false; mesh.add(cracks);
      const rim = new THREE.Mesh(rimGeometry, this.tileTrimMaterial);
      rim.position.y = -0.22; rim.castShadow = rim.receiveShadow = true; mesh.add(rim);
      const label = this._label(`[${i}, ${j}]`, 1.8, 0.35, position.x, 0.012, position.z + this.tileSize * 0.32);
      if (label) mesh.attach(label);
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
    for (const column of this.tiles) for (const tile of column) if (!tile.falling) surfaces.push(tile.surface);
    return { surfaces, canMove: this.phase === 'follow' || this.phase === 'exit', moveSpeed: 4.5, jumpVelocity: 7.2, allowSprint: false };
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
      if (this.deanPassage.time >= 2.45) this.phase = 'exit';
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
      player.mixer?.update(dt * 0.6);
      player.camera.position.lerpVectors(this.cameraStart, this.cameraEnd, THREE.MathUtils.smoothstep(this.playerPassage.time, 0, 0.65));
      player.camera.lookAt(center); player.camera.updateMatrixWorld(true);
      if (this.playerPassage.time >= 2.45) { this.phase = 'complete'; this.levelComplete = true; }
    }
  }

  update(dt, player) {
    const events = { creditCollected: false, levelComplete: false };
    this.exitPortal?.update(dt, this.phase === 'entering' || this.phase === 'dean_exit');
    this.entrancePortal?.update(dt, !!this.arrivalPlayer);
    if (this.arrivalPlayer) {
      this._updateArrival(dt, player);
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
    if (player.group.position.y < -0.6 && this.phase !== 'failed') {
      this._fail(player, 'You fell between the tiles. Use Space to jump across each gap.');
    }
    if (this.phase === 'failed' && player.alive) {
      // Let the fall reveal the hazard below, in either camera mode.
      player.pitch = THREE.MathUtils.lerp(player.pitch, -0.85, 1 - Math.exp(-4 * dt));
      if (player.group.position.y <= this.spikeTipY) {
        player.group.position.y = this.spikeTipY;
        player.verticalVelocity = 0;
        player.takeDamage(player.maxHealth);
      }
      player._updateCamera();
    }
    if (this.dean?.mixer) this.dean.mixer.update(dt);
    this.degreeGrip?.();
    events.levelComplete = this.levelComplete;
    events.autoAdvance = this.levelComplete;
    return events;
  }

  getChallengeStatus() {
    const checkpoint = `Checkpoint ${this.stageIndex + 1} / ${this.patterns.length}`;
    if (this.phase === 'dean_arrival' || this.phase === 'dean_to_start') return { title: 'The Dean arrives first', detail: 'Watch him emerge from the red portal and take his place on the first tile.', progress: 1, timer: 'Entering the Sophomore Room', tone: 'watch' };
    if (this.phase === 'player_arrival' || this.phase === 'arrival_camera') return { title: 'Your turn to enter', detail: 'The red portal brings you onto the starting platform. Get ready to watch the Dean.', progress: 1, timer: 'Watch / Remember / Jump', tone: 'watch' };
    if (this.phase === 'dean_exit') return { title: 'The Dean is escaping', detail: 'Watch him enter the portal. Your checkpoint is safe.', progress: 1, timer: 'All four routes remembered', tone: 'watch' };
    if (this.phase === 'exit') return { title: 'Follow the Dean', detail: 'Walk onto the landing and into the green portal.', progress: 1, timer: 'The Final Encounter awaits', tone: 'follow' };
    if (this.phase === 'entering') return { title: 'Entering the Final Encounter', detail: 'The portal pulls you through to final year.', progress: 1, timer: 'Second year complete', tone: 'follow' };
    if (this.phase === 'arrival') return { title: 'The Sophomore Room', detail: 'Watch the Dean. His route disappears when your turn starts.', progress: 1, timer: 'Watch → Memorize → Jump', tone: 'watch' };
    if (this.phase === 'watch') return { title: `Watch the Dean · ${checkpoint}`, detail: `${this.pattern.length - 1} jumps. Remember every landing, including sideways jumps.`, progress: 1, timer: 'You are safe while watching', tone: 'watch' };
    if (this.phase === 'failed') return { title: 'You fell', detail: this.failureReason, progress: 0, timer: 'Retry from your last checkpoint', tone: 'danger' };
    if (this.phase === 'complete') return { title: 'Second year complete', detail: 'Every pattern remembered.', progress: 1, timer: 'All checkpoints reached', tone: 'follow' };
    const remaining = this.currentTile?.timer;
    return { title: `Your turn · ${checkpoint}`, detail: `Walk up, then Space to jump. ${Math.max(0, this.expectedIndex - 1)} / ${this.pattern.length - 1} jumps completed.`,
      progress: remaining == null ? 1 : Math.max(0, remaining / this.difficulty.tileTime),
      timer: remaining == null ? 'Jump onto the Dean’s first tile to begin' : `${Math.max(0, remaining).toFixed(1)}s before this tile falls`,
      tone: remaining != null && remaining < 0.7 ? 'danger' : 'follow' };
  }

  getRestartState() { return { stageIndex: this.stageIndex, seed: this.seed }; }
  getCompletionText() { return 'You remembered all four routes and cleared The Sophomore Room. Second year complete!'; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this._restoreArrivalPlayer();
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
    this.tiles = [[], []];
  }
}
