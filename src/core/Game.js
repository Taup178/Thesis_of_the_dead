import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { Player } from '../player/Player.js';
import { WeaponCombat } from '../player/WeaponCombat.js';
import { LevelManager } from '../levels/LevelManager.js';
import { DreamMotionBlur } from '../shaders/DreamMotionBlur.js';

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
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    this.motionBlur = new DreamMotionBlur(this.renderer, this.scene, this.camera);
    this.motionBlurEnabled = true;
    try { this.motionBlurEnabled = localStorage.getItem('thesis-motion-blur') !== 'off'; } catch {}

    // ---- Input ----
    this.input = new InputManager();

    // ---- Player (created on game start) ----
    this.player = null;

    // ---- Level Manager ----
    this.levelManager = new LevelManager(this.scene);
    this.currentLevel = null;

    // ---- Shooting ----
    this.raycaster = new THREE.Raycaster();
    this.aimCenter = new THREE.Vector2(0, 0);
    this.combat = new WeaponCombat(this.scene);

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
    this.challengeHud = document.getElementById('challenge-hud');
    this.challengeTitle = document.getElementById('challenge-title');
    this.challengeDetail = document.getElementById('challenge-detail');
    this.challengeTimer = document.getElementById('challenge-timer');
    this.challengeProgress = document.getElementById('challenge-progress');
    this.challengeTimerLabel = document.getElementById('challenge-timer-label');
    this.targetHud = document.getElementById('target-hud');
    this.targetTitle = document.getElementById('target-title');
    this.targetHealth = document.getElementById('target-health');
    this.targetHealthFill = document.getElementById('target-health-fill');
    this.controlsHint = document.getElementById('controls-hint');
    this.worldMessage = document.getElementById('world-message');
    this.ammoHud = document.getElementById('ammo-hud');
    this.ammoCount = document.getElementById('ammo-count');
    this.ammoHint = document.getElementById('ammo-hint');
    this.defaultControlsHint = this.controlsHint.textContent;

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
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.pointerLocked) this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      if (!this.input.pointerLockPending && document.pointerLockElement !== this.renderer.domElement) this.pause();
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === this.STATE.PLAYING && !this.input.pointerLocked) this._captureMouse();
    });

    // Main menu
    document.getElementById('btn-start').addEventListener('click', () => this.startGame());
    document.getElementById('btn-credits').addEventListener('click', () => this._showOverlay('credits-overlay'));
    document.getElementById('btn-options').addEventListener('click', () => this._showOverlay('options-overlay'));
    document.getElementById('btn-credits-back').addEventListener('click', () => this._showOverlay('menu-overlay'));
    document.getElementById('btn-options-back').addEventListener('click', () =>
      this._showOverlay(this.state === this.STATE.PAUSED ? 'pause-overlay' : 'menu-overlay'));

    // Options
    document.getElementById('sensitivity-slider').addEventListener('input', () => this._applyMouseSensitivity());
    const blurToggle = document.getElementById('motion-blur-toggle');
    blurToggle.checked = this.motionBlurEnabled;
    blurToggle.addEventListener('change', () => {
      this.motionBlurEnabled = blurToggle.checked;
      this.motionBlur.reset();
      try { localStorage.setItem('thesis-motion-blur', this.motionBlurEnabled ? 'on' : 'off'); } catch {}
    });

    // Pause (click canvas to resume)
    document.getElementById('pause-overlay').addEventListener('click', () => this.resume());
    document.getElementById('btn-pause-options').addEventListener('click', event => {
      event.stopPropagation(); this._showOverlay('options-overlay');
    });

    // Game over
    document.getElementById('btn-retry').addEventListener('click', () => this.restartLevel());
    document.getElementById('btn-menu').addEventListener('click', () => this.returnToMenu());

    // Level complete
    document.getElementById('btn-nextlevel').addEventListener('click', () => this.loadNextLevel());

    // Win
    document.getElementById('btn-win-menu').addEventListener('click', () => this.returnToMenu());
  }

  _showOverlay(id) {
    this.motionBlur.reset();
    const overlays = ['menu-overlay', 'credits-overlay', 'options-overlay', 'loading-overlay', 'pause-overlay', 'gameover-overlay', 'levelcomplete-overlay', 'win-overlay'];
    overlays.forEach(o => document.getElementById(o).classList.add('hidden'));
    if (id) document.getElementById(id).classList.remove('hidden');
    this.container.classList.toggle('playing', !id && this.state === this.STATE.PLAYING);
  }

  async _captureMouse() {
    this.input.flushMouseDelta();
    if (this.input.pointerLocked) return;
    const captured = await this.input.requestPointerLock(this.renderer.domElement);
    if (!captured) this.pause();
  }

  _applyMouseSensitivity() {
    const setting = Number(document.getElementById('sensitivity-slider').value);
    if (this.player) this.player.mouseSensitivity = setting * 0.0004;
  }

  // =====================================================================
  // State Transitions
  // =====================================================================
  async startGame() {
    this.combat.reset();
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');

    // Capture during the Start click, before loading can expire the browser's user gesture.
    this._captureMouse();

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.loadLevel(0, (p) => {
      progressBar.style.width = `${p * 100}%`;
    });
    this.currentLevel = level;

    // Create player
    if (this.player) this.player.dispose();
    this.player = new Player(this.scene, this.input, this.camera);
    this._applyMouseSensitivity();
    await this.player.loadCharacter();
    this.player.group.position.copy(level.spawnPoint);
    level.preparePlayer?.(this.player);

    // Enter playing state
    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');

    // Show level title briefly
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);

    // Request pointer lock
    this._captureMouse();
  }

  async restartLevel() {
    this.combat.reset();
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');
    this._captureMouse();

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.restartLevel((p) => {
      progressBar.style.width = `${p * 100}%`;
    });
    this.currentLevel = level;

    if (this.player) {
      this.player.reset(level.spawnPoint);
      level.preparePlayer?.(this.player);
    }

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this._captureMouse();
  }

  async loadNextLevel() {
    this.combat.reset();
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');
    this._captureMouse();

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
      document.exitPointerLock();
      return;
    }

    this.currentLevel = level;
    this.player.reset(level.spawnPoint);
    level.preparePlayer?.(this.player);

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this._captureMouse();
  }

  pause() {
    if (this.state !== this.STATE.PLAYING) return;
    this.state = this.STATE.PAUSED;
    this._showOverlay('pause-overlay');
    this.hudEl.classList.add('hidden');
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }

  resume() {
    if (this.state !== this.STATE.PAUSED) return;
    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this._captureMouse();
  }

  returnToMenu() {
    this.combat.reset();
    this.state = this.STATE.MENU;
    document.exitPointerLock();
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    if (this.currentLevel) {
      this.currentLevel.dispose();
      this.currentLevel = null;
      this.levelManager.currentLevel = null;
    }
    this.hudEl.classList.add('hidden');
    this._showOverlay('menu-overlay');
  }

  gameOver() {
    this.state = this.STATE.GAMEOVER;
    this._showOverlay('gameover-overlay');
    document.getElementById('gameover-text').textContent = this.currentLevel?.failureReason || 'Your stamina ran out. The zombies got your degree.';
    document.getElementById('btn-retry').textContent = this.currentLevel?.getRestartState ? 'Retry Checkpoint' : 'Try Again';
    this.hudEl.classList.add('hidden');
    document.exitPointerLock();
  }

  levelComplete() {
    this.state = this.STATE.LEVELCOMPLETE;
    const overlay = document.getElementById('levelcomplete-overlay');
    document.getElementById('levelcomplete-title').textContent = 'Level Complete!';
    document.getElementById('levelcomplete-text').textContent = this.currentLevel.getCompletionText?.() ||
      `You collected ${this.currentLevel.creditsCollected} credits and survived ${this.currentLevel.title}.`;
    this._showOverlay('levelcomplete-overlay');
    this.hudEl.classList.add('hidden');
    document.exitPointerLock();
  }

  // =====================================================================
  // Shooting
  // =====================================================================
  _handleShooting(dt) {
    this.combat.update(dt, this.player, this.currentLevel, this.input, () => this._getShotTargets());
  }

  _getShotTargets() {
    const meshes = [];
    for (const zombie of this.currentLevel.zombies) {
      if (!zombie.alive || !zombie.group.visible) continue;
      zombie.group.traverse(child => { if (child.isMesh && child.visible) meshes.push(child); });
    }
    meshes.push(...(this.currentLevel.getBulletObstacles?.() || this.currentLevel.treeMeshes || []));
    // Shooting precedes the renderer; moving enemies and collapsing walls need current matrices.
    this.scene.updateMatrixWorld(true);
    return meshes;
  }

  // =====================================================================
  // HUD Updates
  // =====================================================================
  _updateHUD() {
    if (!this.player) return;
    const boundaryMessage = this.player.boundaryNoticeTime > 0 ? 'World boundary reached. You have been returned inside, facing back into the world.' : '';
    this.worldMessage.classList.toggle('hidden', !boundaryMessage);
    if (this.worldMessage.textContent !== boundaryMessage) this.worldMessage.textContent = boundaryMessage;

    // Health bar
    const healthPct = (this.player.health / this.player.maxHealth) * 100;
    this.healthBarFill.style.width = `${healthPct}%`;
    this.healthBarFill.classList.remove('low', 'medium');
    if (healthPct < 30) this.healthBarFill.classList.add('low');
    else if (healthPct < 60) this.healthBarFill.classList.add('medium');

    // Score
    this.scoreDisplay.textContent = `Credits: ${this.player.score}`;
    this.controlsHint.textContent = this.currentLevel.controlsHint || this.defaultControlsHint;
    this.ammoHud.classList.toggle('hidden', this.currentLevel.allowsShooting === false);
    this.ammoCount.textContent = String(this.player.ammo);
    this.ammoHud.dataset.empty = String(this.player.ammo === 0);
    this.ammoHint.textContent = this.combat.noticeTime > 0 ? this.combat.notice : this.player.ammo === 0 ? 'EMPTY · Click or F to bash' : 'F: Gun bash · Collect green ammo boxes';
    const challenge = this.currentLevel.getChallengeStatus?.();
    this.challengeHud.classList.toggle('hidden', !challenge);
    if (challenge) {
      this.challengeTitle.textContent = challenge.title;
      this.challengeDetail.textContent = challenge.detail;
      this.challengeTimer.textContent = challenge.timer;
      this.challengeProgress.style.width = `${challenge.progress * 100}%`;
      this.challengeHud.dataset.tone = challenge.tone;
      this.challengeHud.dataset.mode = challenge.mode || '';
      this.challengeTimerLabel.textContent = challenge.label || '';
    }

    if (this.currentLevel.updateTarget) {
      this.raycaster.setFromCamera(this.aimCenter, this.camera);
      this.currentLevel.updateTarget(this.raycaster.intersectObjects(this._getShotTargets(), false)[0]);
    }
    const target = this.currentLevel.getTargetStatus?.();
    this.targetHud.classList.toggle('hidden', !target);
    if (target) {
      const percentage = Math.round(target.health / target.maxHealth * 100);
      this.targetTitle.textContent = target.title;
      this.targetHealth.textContent = target.destroyed ? 'DESTROYED' : `${percentage}% · ${target.health} / ${target.maxHealth}`;
      this.targetHealthFill.style.width = `${percentage}%`;
      this.targetHud.dataset.destroyed = String(target.destroyed);
    }

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

    for (const house of this.currentLevel.houses || []) {
      ctx.fillStyle = house.alive ? '#e6ae65' : '#71685d';
      const x = (house.root.position.x - px) * scale + w / 2;
      const y = (house.root.position.z - pz) * scale + h / 2;
      ctx.fillRect(x - 5, y - 5, 10, 10);
    }

    // Draw zombies as red dots
    ctx.fillStyle = '#c62828';
    for (const zombie of this.currentLevel.zombies) {
      if (!zombie.alive || !zombie.group.visible) continue;
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
    if (this.currentLevel.bossMarker?.visible) {
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
    if (this.state === this.STATE.PLAYING && !this.player.scriptedMovement && this.input.consumeKeyPress('KeyC')) {
      this.player.toggleCamera();
      this.motionBlur.reset();
    }

    if (this.input.isDown('KeyR') && this.state === this.STATE.PLAYING) {
      this.input.keys['KeyR'] = false;
      this.restartLevel();
    }

    // ---- Update logic ----
    if (this.state === this.STATE.PLAYING && this.input.pointerLocked && this.player && this.currentLevel) {
      this.player.update(
        dt, this.currentLevel.getObstacles?.() || [], this.currentLevel.getWorldBounds?.(), this.currentLevel.getPlatforming?.()
      );
      this._handleShooting(dt);

      const events = this.currentLevel.update(dt, this.player, this.elapsedTime);

      if (events.creditCollected) {
        // Brief flash or sound could go here
      }

      if (events.levelComplete) {
        if (events.autoAdvance) { this.loadNextLevel(); return; }
        this.levelComplete();
      }

      if (!this.player.alive) {
        this.gameOver();
      }

      this._updateHUD();
    }

    // ---- Render ----
    this.motionBlur.render(dt, this.motionBlurEnabled && this.state === this.STATE.PLAYING && this.input.pointerLocked);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.motionBlur.setSize(window.innerWidth, window.innerHeight);
  }
}
