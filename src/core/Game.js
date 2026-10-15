import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { Player } from '../player/Player.js';
import { WeaponCombat } from '../player/WeaponCombat.js';
import { LevelManager } from '../levels/LevelManager.js';
import { SPIKE_CORRIDOR_PUZZLE } from '../levels/SophomoreLayout.js';
import { DreamMotionBlur } from '../shaders/DreamMotionBlur.js';
import { applyQuality, loadQuality, saveQuality } from './Quality.js';
import { compileHiddenObjects } from './ShaderWarmup.js';
import { PAD, stepFocusIndex } from './Gamepad.js';
import { Heartbeat, getDistressEffects } from './Heartbeat.js';
import { getGlobalAudioManager } from './AudioManager.js';
import { WEAPONS, weaponById, weaponImage } from '../player/WeaponInventory.js';

const NO_OBSTACLES = [];
const LEVEL_AUDIO_ASSETS = Object.freeze([
  './assets/audio/sfx/collect/credit-chime.ogg', './assets/audio/sfx/collect/ammo-pickup-event-a.wav',
  './assets/audio/sfx/collect/ammo-pickup-event-b.wav', './assets/audio/sfx/ui/confirm.ogg',
  ...[1, 2, 3, 4, 5].map(index => `./assets/audio/sfx/player/shaun-exertion-0${index}.ogg`),
  './assets/audio/sfx/player/garybran-forest-step-01.ogg', './assets/audio/sfx/player/garybran-forest-step-02.ogg',
  './assets/audio/sfx/player/shaun-hurt-01.ogg', './assets/audio/sfx/player/shaun-hurt-02.ogg',
  './assets/audio/sfx/player/shaun-death.ogg',
  ...['pistol-bang-01', 'pistol-bang-02', 'smg-bang-01', 'smg-bang-02', 'smg-bang-03', 'melee-impact-1', 'melee-impact-2', 'bullet-impact-1', 'bullet-impact-2', 'artninja-sword-swing-01', 'artninja-sword-swing-02'].map(name => `./assets/audio/sfx/weapon/${name}.ogg`),
  ...['moan-1', 'moan-2', 'moan-3', 'detection', 'attack', 'hurt-01', 'hurt-02', 'death-01', 'death-02'].map(name => `./assets/audio/sfx/zombie/${name}.ogg`),
]);

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
    this.quality = loadQuality();
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.cinematicShadowsFrozen = false;
    this.qualityConfig = applyQuality(this.renderer, this.scene, this.quality);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    this.motionBlur = new DreamMotionBlur(this.renderer, this.scene, this.camera);
    this.heartbeat = new Heartbeat();
    this.audio = getGlobalAudioManager();
    this.audio?.unlock?.();
    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider && this.audio?.setVolume) this.audio.setVolume(Number(volumeSlider.value) / 100);

    // ---- Input ----
    this.input = new InputManager();
    this.gamepadNoticeTime = 0;
    this.input.onGamepadConnected = () => { this.gamepadNoticeTime = 6; };
    this._ignoreLockErrorsUntil = 0;
    this._menuNav = { overlayId: null, index: 0, stickDir: 0, repeat: 0, highlighted: null };

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
    this.hitFlashEl = document.getElementById('hit-flash');
    this.bossCinematic = document.getElementById('boss-cinematic');
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
    this.ammoLabel = document.getElementById('ammo-label');
    this.ammoCount = document.getElementById('ammo-count');
    this.ammoHint = document.getElementById('ammo-hint');
    this.defaultControlsHint = this.controlsHint.textContent;
    this.weaponWheelEl = document.getElementById('weapon-wheel');
    this.weaponWheelName = document.getElementById('weapon-wheel-name');
    this.weaponWheelPreview = document.getElementById('weapon-wheel-preview');
    this.weaponWheelType = document.getElementById('weapon-wheel-type');
    this.weaponWheelDetails = document.getElementById('weapon-wheel-details');
    this.weaponWheelStatus = document.getElementById('weapon-wheel-status');
    this.weaponWheelRing = document.getElementById('weapon-wheel-ring');
    this.weaponWheelOpen = false;
    this.weaponWheelIndex = 0;
    this.weaponWheelItems = WEAPONS.map((weapon, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / WEAPONS.length;
      const item = document.createElement('div');
      item.className = 'weapon-wheel-item';
      item.style.left = `${50 + Math.cos(angle) * 38}%`;
      item.style.top = `${50 + Math.sin(angle) * 38}%`;
      item.setAttribute('role', 'option');
      item.id = `inventory-${weapon.id}`;
      const image = document.createElement('img');
      image.className = 'weapon-card-image'; image.src = weaponImage(weapon.id); image.alt = weapon.name;
      const name = document.createElement('strong'); name.textContent = weapon.name;
      const slot = document.createElement('kbd'); slot.textContent = weapon.slot;
      const category = document.createElement('small'); category.textContent = weapon.type === 'gun' ? 'FIREARM' : 'MELEE';
      const equipped = document.createElement('span'); equipped.className = 'weapon-equipped-label'; equipped.textContent = 'EQUIPPED';
      item.append(slot, category, image, name, equipped);
      this.weaponWheelRing.appendChild(item);
      return item;
    });

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
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.pointerLocked) this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      // A failed automatic re-capture after loading must not bounce to the pause menu;
      // the HUD's "click to capture" prompt covers that case instead.
      if (performance.now() < this._ignoreLockErrorsUntil) return;
      if (!this.input.pointerLockPending && document.pointerLockElement !== this.renderer.domElement) this.pause();
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === this.STATE.PLAYING && !this.input.pointerLocked) this._captureMouse();
    });

    // Main menu
    document.getElementById('btn-start').addEventListener('click', () => { this._playUiConfirm?.(); this.startGame(); });
    document.getElementById('btn-credits').addEventListener('click', () => { this._playUiConfirm?.(); this._showOverlay('credits-overlay'); });
    document.getElementById('btn-options').addEventListener('click', () => { this._playUiConfirm?.(); this._showOverlay('options-overlay'); });
    document.getElementById('btn-credits-back').addEventListener('click', () => { this._playUiConfirm?.(); this._showOverlay('menu-overlay'); });
    document.getElementById('btn-options-back').addEventListener('click', () => {
      this._playUiConfirm?.(); this._showOverlay(this.state === this.STATE.PAUSED ? 'pause-overlay' : 'menu-overlay');
    });

    // Options
    document.getElementById('sensitivity-slider').addEventListener('input', () => this._applyMouseSensitivity());
    const qualitySelect = document.getElementById('quality-select');
    qualitySelect.value = this.quality;
    qualitySelect.addEventListener('change', () => this._setQuality(qualitySelect.value));
    const gamepadToggle = document.getElementById('gamepad-toggle');
    gamepadToggle.checked = this.input.gamepadEnabled;
    gamepadToggle.addEventListener('change', () => this.input.setGamepadEnabled(gamepadToggle.checked));
    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) volumeSlider.addEventListener('input', () => this.audio?.setVolume?.(Number(volumeSlider.value) / 100));

    // Pause
    document.getElementById('pause-overlay').addEventListener('click', () => this.resume());
    document.getElementById('btn-pause-resume').addEventListener('click', event => {
      event.stopPropagation(); this._playUiConfirm?.(); this.resume();
    });
    document.getElementById('btn-pause-restart').addEventListener('click', event => {
      event.stopPropagation(); this._playUiConfirm?.(); this.restartLevel({ preserveCheckpoint: false });
    });
    document.getElementById('btn-pause-options').addEventListener('click', event => {
      event.stopPropagation(); this._playUiConfirm?.(); this._showOverlay('options-overlay');
    });
    document.getElementById('btn-pause-menu').addEventListener('click', event => {
      event.stopPropagation(); this._playUiConfirm?.(); this.returnToMenu();
    });

    // Game over
    document.getElementById('btn-retry').addEventListener('click', () => { this._playUiConfirm?.(); this.restartLevel(); });
    document.getElementById('btn-menu').addEventListener('click', () => { this._playUiConfirm?.(); this.returnToMenu(); });

    // Level complete
    document.getElementById('btn-nextlevel').addEventListener('click', () => { this._playUiConfirm?.(); this.loadNextLevel(); });

    // Win
    document.getElementById('btn-win-menu').addEventListener('click', () => { this._playUiConfirm?.(); this.returnToMenu(); });
  }

  _showOverlay(id) {
    if (id) this._closeWeaponWheel();
    this.motionBlur.reset();
    if (id) this.heartbeat.stop();
    const overlays = ['menu-overlay', 'credits-overlay', 'options-overlay', 'loading-overlay', 'pause-overlay', 'gameover-overlay', 'levelcomplete-overlay', 'win-overlay'];
    overlays.forEach(o => document.getElementById(o).classList.add('hidden'));
    if (id) document.getElementById(id).classList.remove('hidden');
    this.container.classList.toggle('playing', !id && this.state === this.STATE.PLAYING);
  }

  _playUiConfirm() {
    this.audio?.playSfx?.('./assets/audio/sfx/ui/confirm.ogg', {
      volume: 0.22, category: 'sfx', group: 'ui', maxVoices: 1,
      cooldownKey: 'ui-confirm', cooldown: 0.08,
    });
  }

  async _captureMouse({ pauseOnFailure = true } = {}) {
    this.heartbeat.unlock();
    this.audio?.unlock?.();
    this.input.flushMouseDelta();
    if (this.input.pointerLocked) return;
    // Automatic captures (after loading) fail without a user gesture; their
    // pointerlockerror must not trigger the pause-on-lock-error path.
    if (!pauseOnFailure) this._ignoreLockErrorsUntil = performance.now() + 2000;
    const captured = await this.input.requestPointerLock(this.renderer.domElement);
    if (!captured && pauseOnFailure && !this.input.gamepadInUse) this.pause();
  }

  /** Free the OS cursor while the loading overlay is up; look input must not accumulate either. */
  _releaseMouse() {
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
    this.input.flushMouseDelta();
  }

  _applyMouseSensitivity() {
    const setting = Number(document.getElementById('sensitivity-slider').value);
    if (this.player) this.player.mouseSensitivity = setting * 0.0004;
  }

  _setQuality(level) {
    this.quality = level;
    this.qualityConfig = applyQuality(this.renderer, this.scene, level);
    saveQuality(level);
    this.motionBlur.setSize(window.innerWidth, window.innerHeight);
  }

  // =====================================================================
  // State Transitions
  // =====================================================================
  async startGame() {
    this.combat.reset();
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');

    // Keep the cursor free during loading; it is re-captured when the level starts.
    this._releaseMouse();

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const launch = new URLSearchParams(window.location.search);
    const directFinal = launch.get('level') === '3';
    const directSophomore = launch.get('level') === '2';
    const directSophomoreSection = launch.get('section');
    const level = await this.levelManager.loadLevel(directFinal ? 2 : directSophomore ? 1 : 0, (p) => {
      progressBar.style.width = `${p * 100}%`;
    }, directFinal && launch.get('transform') === '1' ? { transformationPreview: true } :
      directFinal && launch.get('boss') === '1' ? { bossPreview: true } :
      directSophomore && directSophomoreSection === 'spikes' ? { puzzleIndex: SPIKE_CORRIDOR_PUZZLE } :
      directSophomore && directSophomoreSection === 'memory' ? { puzzleIndex: 2 } : null);
    this.currentLevel = level;
    applyQuality(this.renderer, this.scene, this.quality); // Re-cap shadows on freshly loaded lights.
    this.audio?.setLevelTheme?.(level.title);
    this.audio?.preload?.(LEVEL_AUDIO_ASSETS);

    level.audioContext = this.heartbeat.context;
    level.getEffectsVolume = () => Number(document.getElementById('volume-slider').value) / 100;
    await level.prepareAudio?.();
    await level.prepareCinematics?.(this.renderer, this.camera);
    // Create player
    if (this.player) this.player.dispose();
    this.player = new Player(this.scene, this.input, this.camera);
    this._applyMouseSensitivity();
    await this.player.loadCharacter();
    this.player.group.position.copy(level.spawnPoint);
    await level.prepareShaders?.(this.renderer, this.camera);
    level.preparePlayer?.(this.player);
    await this._warmLoadedView?.();

    // Enter playing state
    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');

    // Show level title briefly
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);

    // Request pointer lock. After a long load the user gesture may have expired;
    // on failure the HUD asks for a click instead of bouncing to the pause menu.
    this._captureMouse({ pauseOnFailure: false });
  }

  async restartLevel({ preserveCheckpoint = true } = {}) {
    this.combat.reset();
    this.audio?.stopAll?.();
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');
    this._releaseMouse();

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.restartLevel((p) => {
      progressBar.style.width = `${p * 100}%`;
    }, { preserveCheckpoint });
    this.currentLevel = level;
    applyQuality(this.renderer, this.scene, this.quality);
    this.audio?.restartLevelTheme?.(level.title);

    if (this.player) {
      level.audioContext = this.heartbeat.context;
      level.getEffectsVolume = () => Number(document.getElementById('volume-slider').value) / 100;
      await level.prepareAudio?.();
      await level.prepareCinematics?.(this.renderer, this.camera);
    await level.prepareShaders?.(this.renderer, this.camera);
      this.player.reset(level.spawnPoint);
      level.preparePlayer?.(this.player);
      await this._warmLoadedView?.();
    }

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this._captureMouse({ pauseOnFailure: false });
  }

  async loadNextLevel() {
    this.combat.reset();
    this.audio?.stopAll?.();
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');
    this._releaseMouse();

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const level = await this.levelManager.nextLevel((p) => {
      progressBar.style.width = `${p * 100}%`;
    });

    if (!level) {
      // Game complete!
      this.audio?.stopAll?.();
      this.state = this.STATE.WIN;
      this._showOverlay('win-overlay');
      this.hudEl.classList.add('hidden');
      document.exitPointerLock();
      return;
    }

    this.currentLevel = level;
    applyQuality(this.renderer, this.scene, this.quality);
    this.audio?.setLevelTheme?.(level.title);
    this.player.reset(level.spawnPoint);
    level.audioContext = this.heartbeat.context;
    level.getEffectsVolume = () => Number(document.getElementById('volume-slider').value) / 100;
    await level.prepareAudio?.();
    await level.prepareCinematics?.(this.renderer, this.camera);
    await level.prepareShaders?.(this.renderer, this.camera);
    level.preparePlayer?.(this.player);
    await this._warmLoadedView?.();

    this.state = this.STATE.PLAYING;
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this.levelTitleDisplay.textContent = level.title;
    this.levelTitleDisplay.classList.add('visible');
    setTimeout(() => this.levelTitleDisplay.classList.remove('visible'), 3000);
    this._captureMouse({ pauseOnFailure: false });
  }

  pause() {
    if (this.state !== this.STATE.PLAYING) return;
    this.state = this.STATE.PAUSED;
    this.currentLevel?.pauseEffects?.();
    this.audio?.pause?.();
    this._showOverlay('pause-overlay');
    this.hudEl.classList.add('hidden');
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }

  resume() {
    if (this.state !== this.STATE.PAUSED) return;
    this.state = this.STATE.PLAYING;
    this.audio?.resume?.();
    this._showOverlay(null);
    this.hudEl.classList.remove('hidden');
    this._captureMouse();
  }

  returnToMenu() {
    this.combat.reset();
    this.audio?.stopAll?.();
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
    const restartState = this.currentLevel?.getRestartState?.();
    const hasCheckpoint = restartState?.arenaCleared === true ||
      (Number.isInteger(restartState?.puzzleIndex) &&
        (restartState.puzzleIndex > 0 || (Number.isInteger(restartState.stageIndex) && restartState.stageIndex > 0)));
    document.getElementById('btn-retry').textContent = hasCheckpoint ? 'Retry Checkpoint' : 'Try Again';
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

  _openWeaponWheel() {
    if (!this.player || this.player.scriptedMovement || this.currentLevel?.allowsShooting === false) return;
    this.combat.cancelMelee();
    this.input.consumeMousePresses?.(0);
    this.weaponWheelOpen = true;
    this.weaponWheelEl.classList.remove('hidden');
    this.weaponWheelEl.setAttribute('aria-hidden', 'false');
    this.wheelClickHeld = this.input.isMouseButtonDown(0);
    this.weaponWheelIndex = Math.max(0, WEAPONS.findIndex(weapon => weapon.id === this.player.weapon));
    const angle = -Math.PI / 2 + this.weaponWheelIndex * Math.PI * 2 / WEAPONS.length;
    this.wheelX = Math.cos(angle) * 95;
    this.wheelY = Math.sin(angle) * 95;
    this._showWheelSelection();
    this.input.flushMouseDelta();
  }

  _closeWeaponWheel() {
    this.weaponWheelOpen = false;
    this.weaponWheelEl?.classList.add('hidden');
    this.weaponWheelEl?.setAttribute('aria-hidden', 'true');
  }

  _equipWeapon(id) {
    if (!this.player?.equipWeapon(id)) return;
    this.combat.cancelMelee();
    this.input.consumeMousePresses?.(0);
    this._closeWeaponWheel();
  }

  _cycleWeapon(direction) {
    if (!this.player) return;
    const current = Math.max(0, WEAPONS.findIndex(weapon => weapon.id === this.player.weapon));
    const next = WEAPONS[(current + direction + WEAPONS.length) % WEAPONS.length];
    this._equipWeapon(next.id);
  }

  // =====================================================================
  // Gamepad menu navigation (any overlay: stick/d-pad move, A confirms)
  // =====================================================================
  _activeOverlayId() {
    for (const id of ['menu-overlay', 'credits-overlay', 'options-overlay', 'loading-overlay',
      'pause-overlay', 'gameover-overlay', 'levelcomplete-overlay', 'win-overlay']) {
      if (!document.getElementById(id).classList.contains('hidden')) return id;
    }
    return null;
  }

  _updateMenuFocus(dt) {
    const nav = this._menuNav;
    const overlayId = this._activeOverlayId();
    if (!overlayId || !this.input.gamepadInUse) {
      this._clearMenuFocus();
      return;
    }
    // Swallow gameplay-only presses so they can't leak into the next playing frame.
    for (const button of [PAD.WHEEL, PAD.BASH, PAD.CAMERA, PAD.FIRE, PAD.ALT_FIRE, PAD.PREV_WEAPON, PAD.NEXT_WEAPON]) {
      this.input.consumeGamepadPress(button);
    }
    if (overlayId === 'loading-overlay') return;

    const buttons = [...document.getElementById(overlayId).querySelectorAll('.menu-btn')]
      .filter(button => button.offsetParent !== null);
    if (buttons.length === 0) {
      this._clearMenuFocus();
      return;
    }

    if (nav.overlayId !== overlayId) {
      nav.overlayId = overlayId;
      nav.index = 0;
      nav.stickDir = 0;
      nav.repeat = 0;
      this._highlightMenuButton(buttons, 0);
    }

    let dir = 0;
    if (this.input.consumeGamepadPress(PAD.UP)) dir = -1;
    if (this.input.consumeGamepadPress(PAD.DOWN)) dir = 1;
    const stickDir = this.input.moveAxisY < -0.5 ? -1 : this.input.moveAxisY > 0.5 ? 1 : 0;
    if (stickDir !== 0) {
      if (stickDir !== nav.stickDir) {
        dir = stickDir;
        nav.repeat = 0.4;
      } else {
        nav.repeat -= dt;
        if (nav.repeat <= 0) {
          dir = stickDir;
          nav.repeat = 0.16;
        }
      }
    }
    nav.stickDir = stickDir;
    if (dir !== 0) {
      nav.index = stepFocusIndex(nav.index, dir, buttons.length);
      this._highlightMenuButton(buttons, nav.index);
    }
    if (this.input.consumeGamepadPress(PAD.JUMP)) {
      this.input.releasePadButton(PAD.JUMP);
      buttons[nav.index]?.click();
    }
  }

  _highlightMenuButton(buttons, index) {
    this._menuNav.highlighted?.classList.remove('gamepad-focus');
    const button = buttons[index];
    this._menuNav.highlighted = button || null;
    if (button) {
      button.classList.add('gamepad-focus');
      button.focus({ preventScroll: true });
    }
  }

  _clearMenuFocus() {
    this._menuNav.overlayId = null;
    this._menuNav.highlighted?.classList.remove('gamepad-focus');
    this._menuNav.highlighted = null;
  }

  _showWheelSelection() {
    const weapon = WEAPONS[this.weaponWheelIndex];
    this.weaponWheelItems.forEach((item, index) => {
      item.classList.toggle('selected', index === this.weaponWheelIndex);
      item.classList.toggle('equipped', WEAPONS[index].id === this.player.weapon);
      item.setAttribute('aria-selected', String(index === this.weaponWheelIndex));
    });
    this.weaponWheelRing.setAttribute('aria-activedescendant', `inventory-${weapon.id}`);
    this.weaponWheelRing.style.setProperty('--selection-angle', `${this.weaponWheelIndex * 360 / WEAPONS.length}deg`);
    this.weaponWheelName.textContent = weapon.name;
    this.weaponWheelPreview.src = weaponImage(weapon.id);
    this.weaponWheelPreview.alt = weapon.name;
    this.weaponWheelType.textContent = weapon.type === 'gun' ? 'FIREARM' : 'MELEE';
    this.weaponWheelDetails.textContent = weapon.type === 'gun'
      ? `${weapon.damage} damage / hit · ${this.currentLevel?.hasUnlimitedAmmo?.(weapon.id) ? '∞' : this.player.ammo} bullets${weapon.ammo > 1 ? ' · 2 / shot' : ''}`
      : `${weapon.damage} damage / hit · ${weapon.reach}m reach`;
    this.weaponWheelStatus.textContent = weapon.id === this.player.weapon ? 'EQUIPPED' : 'CLICK TO EQUIP';
  }

  _updateWeaponWheel() {
    this.wheelX += this.input.mouseDeltaX;
    this.wheelY += this.input.mouseDeltaY;
    const length = Math.hypot(this.wheelX, this.wheelY);
    if (length > 120) { this.wheelX *= 120 / length; this.wheelY *= 120 / length; }
    if (length > 28) {
      let nearest = 0, best = -Infinity;
      for (let index = 0; index < WEAPONS.length; index++) {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / WEAPONS.length;
        const dot = this.wheelX * Math.cos(angle) + this.wheelY * Math.sin(angle);
        if (dot > best) { nearest = index; best = dot; }
      }
      if (nearest !== this.weaponWheelIndex) {
        this.weaponWheelIndex = nearest;
        this._showWheelSelection();
      }
    }
    const clicked = this.input.isMouseButtonDown(0);
    if (clicked && !this.wheelClickHeld) this._equipWeapon(WEAPONS[this.weaponWheelIndex].id);
    this.wheelClickHeld = clicked;
    this.input.flushMouseDelta();
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
    const captureMessage = this.state === this.STATE.PLAYING && !this.input.pointerLocked && !this.input.gamepadInUse
      ? 'Click the screen to capture the mouse' : '';
    const gamepadMessage = this.gamepadNoticeTime > 0 ? 'Gamepad connected' : '';
    const boundaryMessage = this.player.boundaryNoticeTime > 0 ? 'World boundary reached. You have been returned inside, facing back into the world.' : '';
    const message = boundaryMessage || captureMessage || gamepadMessage;
    this.worldMessage.classList.toggle('hidden', !message);
    if (this.worldMessage.textContent !== message) this.worldMessage.textContent = message;

    // Health bar
    const healthPct = (this.player.health / this.player.maxHealth) * 100;
    this.healthBarFill.style.width = `${healthPct}%`;
    this.hitFlashEl.style.opacity = String(Math.min(0.85, this.player.damageFlashTime / 0.35 * 0.85));
    this.healthBarFill.classList.remove('low', 'medium');
    if (healthPct < 30) this.healthBarFill.classList.add('low');
    else if (healthPct < 60) this.healthBarFill.classList.add('medium');

    // Score
    this.scoreDisplay.textContent = `Credits: ${this.player.score}`;
    this.controlsHint.textContent = this.input.gamepadInUse
      ? 'Left stick: Move | Right stick: Look | RT: Shoot | A: Jump | X: Weapons | B: Roll | LB: Sprint | RB: Bash | Y: Camera | Start: Pause'
      : `${this.currentLevel.controlsHint || this.defaultControlsHint} | 1: Wheel | 2-6: Equip`;
    this.ammoHud.classList.toggle('hidden', this.currentLevel.allowsShooting === false);
    const equipped = weaponById(this.player.weapon) || WEAPONS[0];
    const unlimited = this.currentLevel.hasUnlimitedAmmo?.(equipped.id) === true;
    this.ammoLabel.textContent = equipped.type === 'gun' ? `${equipped.name.toUpperCase()} · BULLETS` : equipped.name.toUpperCase();
    this.ammoCount.textContent = equipped.type === 'gun' && !unlimited ? String(this.player.ammo) : '∞';
    this.ammoHud.dataset.empty = String(equipped.type === 'gun' && !unlimited && this.player.ammo === 0);
    this.ammoHint.textContent = equipped.type === 'melee' ? `Click: ${equipped.id === 'sword' ? 'Slash → Stab → 360° slash · Chain within 0.75s' : 'Stab'}`
      : unlimited ? 'UNLIMITED AMMO · F: Gun bash'
        : this.combat.noticeTime > 0 ? this.combat.notice
        : this.player.ammo === 0 ? 'EMPTY · Click or F to bash'
          : equipped.id === 'dual' ? 'Click: both · Right click: one · F: Bash' : 'F: Gun bash · Collect green ammo boxes';
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

    const frameDt = this.clock.getDelta();
    const dt = Math.min(frameDt, 0.05); // cap gameplay physics to avoid spiral of death
    this.elapsedTime += dt;
    this.input.updateGamepad(dt);
    // Look deltas only get consumed during active gameplay (player look / weapon wheel).
    // Drop them everywhere else so mouse or right-stick movement during loading, menus,
    // or paused can't pile up and lurch the camera when gameplay resumes.
    if (!(this.state === this.STATE.PLAYING && (this.input.pointerLocked || this.input.gamepadInUse))) {
      this.input.flushMouseDelta();
    }
    this.gamepadNoticeTime = Math.max(0, this.gamepadNoticeTime - dt);

    // ---- Handle one-shot key presses ----
    let inventoryFrame = this.weaponWheelOpen;
    if (this.state === this.STATE.PLAYING && this.player && !this.player.scriptedMovement
      && this.currentLevel?.allowsShooting !== false) {
      if (this.input.consumeKeyPress('Digit1')) {
        if (this.weaponWheelOpen) this._closeWeaponWheel();
        else this._openWeaponWheel();
        inventoryFrame = true;
      }
      for (const weapon of WEAPONS) {
        if (this.input.consumeKeyPress(`Digit${weapon.slot}`)) this._equipWeapon(weapon.id);
      }
      if (this.input.consumeGamepadPress(PAD.PREV_WEAPON)) this._cycleWeapon(-1);
      if (this.input.consumeGamepadPress(PAD.NEXT_WEAPON)) this._cycleWeapon(1);
      if (this.weaponWheelOpen) { this._updateWeaponWheel(); inventoryFrame = true; }
    }
    if (this.state === this.STATE.PLAYING && !this.player.scriptedMovement && this.input.consumeKeyPress('KeyC')) {
      this.player.toggleCamera();
      this.motionBlur.reset();
    }

    // Gamepad Start pauses and resumes; pointer-lock loss handles the keyboard path.
    if (this.input.consumeGamepadPress(PAD.START)) {
      if (this.state === this.STATE.PLAYING) this.pause();
      else if (this.state === this.STATE.PAUSED) this.resume();
    }

    this._updateMenuFocus(dt);

    if (this.input.isDown('KeyR') && this.state === this.STATE.PLAYING) {
      this.input.keys['KeyR'] = false;
      this.restartLevel();
    }

    // ---- Update logic ----
    if (this.state === this.STATE.PLAYING && (this.input.pointerLocked || this.input.gamepadInUse) && this.player && this.currentLevel && !inventoryFrame) {
      this.player.update(
        dt, this.currentLevel.getObstacles?.() ?? NO_OBSTACLES,
        this.currentLevel.getWorldBounds?.(), this.currentLevel.getPlatforming?.()
      );
      this.audio?.setListenerPosition?.(this.player.group.position);
      this._handleShooting(dt);

      // The escape follows elapsed time, so a slow frame cannot stretch the film.
      const levelDt = this.currentLevel.bossCutscene?.usesElapsedTime ? Math.min(frameDt, 0.25) : dt;
      const events = this.currentLevel.update(levelDt, this.player, this.elapsedTime);

      if (events.creditCollected) {
        const finalCredit = events.finalCreditCollected === true;
        this.audio?.playSfx?.('./assets/audio/sfx/collect/credit-chime.ogg', {
          volume: finalCredit ? 0.92 : 0.66, pitch: finalCredit ? 0.88 : 1,
          category: 'sfx', group: 'pickup', maxVoices: 3, position: this.player.group.position,
        });
        if (finalCredit) this.audio?.playFinalCreditMilestone?.();
      }
      if (events.deanReveal) this.audio?.playDeanReveal?.();
      if (events.portalActivated) {
        this.audio?.playPortalActivation?.();
        this.audio?.startPortalHum?.(this.currentLevel.portalRoot?.position);
      }
      if (this.currentLevel.portalActive) this.audio?.updatePortalHum?.(this.currentLevel.portalRoot?.position);
      if (events.portalEntry) { this.audio?.playPortalEntry?.(); this.audio?.stopPortalHum?.(); }
      if (this.currentLevel.title?.toLowerCase().includes('final')) {
        this.audio?.setFinalEncounterPhase?.(this.currentLevel.bossFight?.phase === 'combat' ? 'boss' : 'arena');
      }

      if (events.levelComplete) {
        if (events.autoAdvance) { this.loadNextLevel(); return; }
        this.levelComplete();
      }

      if (!this.player.alive) {
        this.gameOver();
      }

      if (!this.currentLevel.bossCutscene) this._updateHUD();
    }

    // ---- Render ----
    this._updateCinematicPresentation();
    const active = this.state === this.STATE.PLAYING
      && (this.input.pointerLocked || this.input.gamepadInUse) && !document.hidden;
    const freezeCinematicShadows = active && !!this.currentLevel?.portalCinematicActive;
    if (freezeCinematicShadows !== this.cinematicShadowsFrozen) {
      this.renderer.shadowMap.autoUpdate = !freezeCinematicShadows;
      if (!freezeCinematicShadows) this.renderer.shadowMap.needsUpdate = true;
      this.cinematicShadowsFrozen = freezeCinematicShadows;
    }
    const effects = getDistressEffects(this.player, this.currentLevel?.wakeUpIntro, active);
    this.heartbeat.update(effects.distress, Number(document.getElementById('volume-slider').value) / 100);
    const cinematic = !!(this.currentLevel?.bossCutscene?.usesElapsedTime || this.currentLevel?.portalCinematicActive);
    this.motionBlur.render(dt, this.qualityConfig.blur && !cinematic ? effects.blur : 0);
  }

  _updateCinematicPresentation() {
    const playing = this.state === this.STATE.PLAYING && this.input.pointerLocked;
    const bossIntro = !!this.currentLevel?.bossCutscene;
    const cinematic = playing && (bossIntro || !!this.currentLevel?.portalCinematicActive || !!this.currentLevel?.degreeBurnCinematicActive
      || !!this.currentLevel?.transformationCinematicActive);
    this.bossCinematic?.classList.toggle('active', cinematic);
    this.bossCinematic?.classList.toggle('boss-intro', playing && bossIntro);
    this.bossCinematic?.style?.setProperty('--cutscene-fade', String(bossIntro ? this.currentLevel.bossCutscene.fade || 0 : 0));
    this.hudEl?.classList.toggle('cinematic', cinematic);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.motionBlur.setSize(window.innerWidth, window.innerHeight);
  }

  async _warmLoadedView() {
    await compileHiddenObjects(this.renderer, this.scene, this.camera, [this.player?.group]);
    await this.renderer.compileAsync(this.scene, this.camera);
    if (!this.player) return;
    // Force the actual lighting, shadows and skinned-player variants to link
    // while the DOM loading overlay still covers the canvas. compileAsync alone
    // cannot warm shaders for objects hidden during an entrance cutscene.
    const wasVisible = this.player.group.visible;
    this.player.group.visible = true;
    try { this.renderer.render(this.scene, this.camera); }
    finally { this.player.group.visible = wasVisible; }
  }
}
