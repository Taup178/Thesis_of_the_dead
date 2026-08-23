import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { Player } from '../player/Player.js';
import { LevelManager } from '../levels/LevelManager.js';

/**
 * Game - Top-level orchestrator.
 * Manages the render loop, scene, state machine, shooting, HUD, and menus.
 */
export class Game {
  constructor(container) {
    this.container = container;

    // ---- State machine ----
    this.STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover', LEVELCOMPLETE: 'levelcomplete', WIN: 'win', LOADING: 'loading' };
    this.state = this.STATE.MENU;

    // ---- Three.js basics ----
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

    // ---- Input ----
    this.input = new InputManager();

    // ---- Player (created on game start) ----
    this.player = null;

    // ---- Level Manager ----
    this.levelManager = new LevelManager(this.scene);
    this.currentLevel = null;

    // ---- Shooting ----
    this.raycaster = new THREE.Raycaster();
    this.shootCooldown = 0;
    this.shootRate = 0.25; // seconds between shots
    this.muzzleFlashLight = null;

    // ---- Timing ----
    this.clock = new THREE.Clock();
    this.elapsedTime = 0;

    // ---- HUD references ----
    this.hudEl = document.getElementById('hud');
    this.healthBarFill = document.getElementById('health-bar-fill');
    this.scoreDisplay = document.getElementById('score-display');
    this.levelTitleDisplay = document.getElementById('level-title-display');
    this.minimapCanvas = document.getElementById('minimap');
    this.minimapCtx = this.minimapCanvas.getContext('2d');

    // ---- Resize ----
    window.addEventListener('resize', () => this._onResize());

    // ---- Bind UI buttons ----
    this._bindUI();

    // ---- Start render loop ----
    this._animate();
  }

  // =====================================================================
  // UI Binding
  // =====================================================================
  _bindUI() {
    // Main menu
    document.getElementById('btn-start').addEventListener('click', () => this.startGame());
    document.getElementById('btn-credits').addEventListener('click', () => this._showOverlay('credits-overlay'));
    document.getElementById('btn-options').addEventListener('click', () => this._showOverlay('options-overlay'));
    document.getElementById('btn-credits-back').addEventListener('click', () => this._showOverlay('menu-overlay'));
    document.getElementById('btn-options-back').addEventListener('click', () => this._showOverlay('menu-overlay'));

    // Options
    document.getElementById('sensitivity-slider').addEventListener('input', (e) => {
      if (this.player) this.player.mouseSensitivity = e.target.value * 0.001;
    });

    // Pause (click canvas to resume)
    document.getElementById('pause-overlay').addEventListener('click', () => this.resume());

    // Game over
    document.getElementById('btn-retry').addEventListener('click', () => this.restartLevel());
    document.getElementById('btn-menu').addEventListener('click', () => this.returnToMenu());

    // Level complete
    document.getElementById('btn-nextlevel').addEventListener('click', () => this.loadNextLevel());

    // Win
    document.getElementById('btn-win-menu').addEventListener('click', () => this.returnToMenu());
  }

  _showOverlay(id) {
    const overlays = ['menu-overlay', 'credits-overlay', 'options-overlay', 'loading-overlay', 'pause-overlay', 'gameover-overlay', 'levelcomplete-overlay', 'win-overlay'];
    overlays.forEach(o => document.getElementById(o).classList.add('hidden'));
    if (id) document.getElementById(id).classList.remove('hidden');
  }

  // =====================================================================
  // State Transitions
  // =====================================================================
  async startGame() {
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.loadLevel(0, (p) => {
      progressBar.style.width = `${p * 100}%`;
    });
    this.currentLevel = level;

    // Create player
    if (this.player) this.player.dispose();
    this.player = new Player(this.scene, this.input, this.camera);
    this.player.group.position.copy(level.spawnPoint);

    // Muzzle flash light
    this.muzzleFlashLight = new THREE.PointLight(0xffaa00, 0, 5);
    this.player.gunGroup.add(this.muzzleFlashLight);

    // Enter playing state
    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');

    // Show level title briefly
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);

    // Request pointer lock
    this.input.requestPointerLock(this.renderer.domElement);
  }

  async restartLevel() {
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.restartLevel((p) => {
      progressBar.style.width = `${p * 100}%`;
    });
    this.currentLevel = level;

    if (this.player) {
      this.player.reset(level.spawnPoint);
    }

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this.input.requestPointerLock(this.renderer.domElement);
  }

  async loadNextLevel() {
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.nextLevel((p) => {
      progressBar.style.width = `${p * 100}%`;
    });

    if (!level) {
      // Game complete!
      this.state = this.STATE.WIN;
      this._showOverlay('win-overlay');
      this.hudEl.classList.add('hidden');
      return;
    }

    this.currentLevel = level;
    this.player.reset(level.spawnPoint);

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this.input.requestPointerLock(this.renderer.domElement);
  }

  resume() {
    if (this.state !== this.STATE.PAUSED) return;
    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.input.requestPointerLock(this.renderer.domElement);
  }

  returnToMenu() {
    this.state = this.STATE.MENU;
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    if (this.currentLevel) {
      this.currentLevel.dispose();
      this.currentLevel = null;
    }
    this.hudEl.classList.add('hidden');
    this._showOverlay('menu-overlay');
  }

  gameOver() {
    this.state = this.STATE.GAMEOVER;
    this._showOverlay('gameover-overlay');
    this.hudEl.classList.add('hidden');
    document.exitPointerLock();
  }

  levelComplete() {
    this.state = this.STATE.LEVELCOMPLETE;
    const overlay = document.getElementById('levelcomplete-overlay');
    document.getElementById('levelcomplete-title').textContent = 'Level Complete!';
    document.getElementById('levelcomplete-text').textContent =
      `You collected ${this.currentLevel.creditsCollected} credits and survived ${this.currentLevel.title}.`;
    this._showOverlay('levelcomplete-overlay');
    this.hudEl.classList.add('hidden');
    document.exitPointerLock();
  }

  // =====================================================================
  // Shooting
  // =====================================================================
  _handleShooting(dt) {
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);

    if (this.input.isMouseButtonDown(0) && this.shootCooldown <= 0 && this.input.pointerLocked) {
      this.shootCooldown = this.shootRate;

      // Raycast from camera center (forward)
      const direction = new THREE.Vector3(0, 0, -1);
      direction.applyQuaternion(this.camera.quaternion);
      this.raycaster.set(this.camera.position, direction);

      // Collect all zombie meshes
      const zombieMeshes = [];
      for (const zombie of this.currentLevel.zombies) {
        if (zombie.alive) {
          zombie.group.traverse((child) => {
            if (child.isMesh) zombieMeshes.push(child);
          });
        }
      }

      const hits = this.raycaster.intersectObjects(zombieMeshes, false);
      if (hits.length > 0) {
        // Find which zombie was hit
        const hitObject = hits[0].object;
        for (const zombie of this.currentLevel.zombies) {
          let isThisZombie = false;
          zombie.group.traverse((child) => {
            if (child === hitObject) isThisZombie = true;
          });
          if (isThisZombie) {
            const killed = zombie.takeDamage(15);
            if (killed) {
              this.player.addScore(200);
            }
            break;
          }
        }
      }

      // Muzzle flash
      if (this.muzzleFlashLight) {
        this.muzzleFlashLight.intensity = 5;
        setTimeout(() => {
          if (this.muzzleFlashLight) this.muzzleFlashLight.intensity = 0;
        }, 50);
      }
    }
  }

  // =====================================================================
  // HUD Updates
  // =====================================================================
  _updateHUD() {
    if (!this.player) return;

    // Health bar
    const healthPct = (this.player.health / this.player.maxHealth) * 100;
    this.healthBarFill.style.width = `${healthPct}%`;
    this.healthBarFill.classList.remove('low', 'medium');
    if (healthPct < 30) this.healthBarFill.classList.add('low');
    else if (healthPct < 60) this.healthBarFill.classList.add('medium');

    // Score
    this.scoreDisplay.textContent = `Credits: ${this.player.score}`;

    // Minimap
    this._drawMinimap();
  }

  _drawMinimap() {
    const ctx = this.minimapCtx;
    const w = this.minimapCanvas.width;
    const h = this.minimapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, w, h);

    if (!this.player || !this.currentLevel) return;

    const scale = 1.2;
    const px = this.player.group.position.x;
    const pz = this.player.group.position.z;

    // Draw zombies as red dots
    ctx.fillStyle = '#c62828';
    for (const zombie of this.currentLevel.zombies) {
      if (!zombie.alive) continue;
      const zx = (zombie.group.position.x - px) * scale + w / 2;
      const zy = (zombie.group.position.z - pz) * scale + h / 2;
      if (zx > 0 && zx < w && zy > 0 && zy < h) {
        ctx.beginPath();
        ctx.arc(zx, zy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw credits as gold dots
    ctx.fillStyle = '#ffd700';
    for (const credit of this.currentLevel.credits) {
      if (credit.collected) continue;
      const cx = (credit.mesh.position.x - px) * scale + w / 2;
      const cy = (credit.mesh.position.z - pz) * scale + h / 2;
      if (cx > 0 && cx < w && cy > 0 && cy < h) {
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw boss marker
    if (this.currentLevel.bossMarker) {
      ctx.fillStyle = '#9c27b0';
      const bx = (this.currentLevel.bossMarker.position.x - px) * scale + w / 2;
      const by = (this.currentLevel.bossMarker.position.z - pz) * scale + h / 2;
      if (bx > 0 && bx < w && by > 0 && by < h) {
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw player (centre, green triangle pointing forward)
    ctx.fillStyle = '#4caf50';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // =====================================================================
  // Main Loop
  // =====================================================================
  _animate() {
    requestAnimationFrame(() => this._animate());

    const dt = Math.min(this.clock.getDelta(), 0.05); // cap dt to avoid spiral of death
    this.elapsedTime += dt;

    // ---- Handle one-shot key presses ----
    if (this.input.isDown('KeyC') && this.state === this.STATE.PLAYING) {
      this.input.keys['KeyC'] = false; // consume
      this.player.toggleCamera();
    }

    if (this.input.isDown('KeyR') && this.state === this.STATE.PLAYING) {
      this.input.keys['KeyR'] = false;
      this.restartLevel();
    }

    // ---- Pointer lock lost = pause ----
    if (this.state === this.STATE.PLAYING && !this.input.pointerLocked) {
      // Only pause if they pressed Escape (not during loading etc.)
      // We check if Escape was pressed to avoid false pauses
      if (this.input.isDown('Escape')) {
        this.state = this.STATE.PAUSED;
        this._showOverlay('pause-overlay');
        this.hudEl.classList.add('hidden');
      }
    }

    // ---- Update logic ----
    if (this.state === this.STATE.PLAYING && this.player && this.currentLevel) {
      this.player.update(dt);
      this._handleShooting(dt);

      const events = this.currentLevel.update(dt, this.player, this.elapsedTime);

      if (events.creditCollected) {
        // Brief flash or sound could go here
      }

      if (events.bossReached) {
        this.currentLevel.levelComplete = true;
        this.levelComplete();
      }

      if (!this.player.alive) {
        this.gameOver();
      }

      this._updateHUD();
    }

    // ---- Render ----
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
