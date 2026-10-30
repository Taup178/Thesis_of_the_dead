import { EndingVoice } from '../audio/EndingVoice.js';
import * as THREE from 'three';
import { InputManager } from './InputManager.js';
import { Player } from '../player/Player.js';
import { WeaponCombat } from '../player/WeaponCombat.js';
import { LevelManager } from '../levels/LevelManager.js';
import { SPIKE_CORRIDOR_PUZZLE } from '../levels/SophomoreLayout.js';
import { DreamMotionBlur } from '../shaders/DreamMotionBlur.js';
import { applyQuality } from './Quality.js';
import { GRAPHICS_DESCRIPTIONS, graphicsPreset, isCustomGraphics, loadGraphics, normalizeGraphics, saveGraphics } from './GraphicsSettings.js';
import { bindSettingsTabs } from './SettingsTabs.js';
import { ClosingCredits } from './ClosingCredits.js';
import { compileHiddenObjects } from './ShaderWarmup.js';
import { PAD, stepFocusIndex } from './Gamepad.js';
import { Heartbeat, getDistressEffects } from './Heartbeat.js';
import { getGlobalAudioManager } from './AudioManager.js';
import { MenuMusic } from './MenuMusic.js';
import { WEAPONS, weaponById, weaponImage } from '../player/WeaponInventory.js';
import { ChapterVoices } from '../audio/ChapterVoices.js';
import { INTERNAL_VOICE_GAIN } from '../audio/InternalVoices.js';
import { getEnemyLockTargets, selectEnemyLockTarget, getEnemyPinPosition } from '../player/EnemyLockOn.js';

const NO_OBSTACLES = [];

/**
 * B (Back) leaves these overlays by clicking the same button the mouse would use.
 * The main menu, loading, game over, level complete and win screens have no parent to return to.
 */
export const MENU_BACK_BUTTONS = {
  'levels-overlay': 'btn-levels-back',
  'credits-overlay': 'btn-credits-back',
  'options-overlay': 'btn-options-back',
  'pause-overlay': 'btn-pause-resume',
};

/** Pixels a stick/d-pad press scrolls a long menu panel (credits, options). */
const MENU_SCROLL_STEP = 64;

/**
 * Level 1 field notes. `control` is the input that dismisses the note; pad buttons
 * reach it through the usual key translation, except when `padControl` names one
 * directly (LB strikes through the mouse path, not its keyboard twin). Keyboard and
 * pad wordings are kept side by side so a controller player is never told to press
 * a key they cannot reach.
 */
export const FIRST_LEVEL_HINTS = {
  loadout: { control: 'Digit1', key: '1', padKey: 'X', prompt: 'PRESS 1 TO OPEN INVENTORY', padPrompt: 'PRESS X TO OPEN INVENTORY' },
  roll: { control: 'KeyQ', key: 'Q', padKey: 'B', prompt: 'PRESS Q TO ROLL', padPrompt: 'PRESS B TO ROLL' },
  strike: { control: 'KeyF', key: 'F', padKey: 'LB', prompt: 'PRESS F TO STRIKE', padPrompt: 'PRESS LB TO STRIKE', padControl: PAD.ATTACK },
  lock: { control: 'KeyL', key: 'L', padKey: 'R3', prompt: 'PRESS L TO LOCK ON', padPrompt: 'PRESS R3 TO LOCK ON' },
};

const LEVEL_AUDIO_ASSETS = Object.freeze([
  './assets/audio/sfx/player/red-ending-fire-scream.wav',
  './assets/audio/sfx/collect/ammo-pickup-event-a.wav', './assets/audio/sfx/collect/ammo-pickup-event-b.wav',
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
    this.endingPreviewActive = import.meta.env?.DEV && new URLSearchParams(window.location.search).get('victory') === '1'
      && ['red', 'blue'].includes(new URLSearchParams(window.location.search).get('ending'));
    this.STATE = { MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover', LEVELCOMPLETE: 'levelcomplete', WIN: 'win', LOADING: 'loading' };
    this.state = this.STATE.MENU;

    // ---- Three.js basics ----
    this.scene = new THREE.Scene();
    this.graphics = loadGraphics(); this.quality = this.graphics.preset;
    // Anti-aliasing is applied in the live post-processing pipeline, so toggling
    // it never needs a new WebGL context or a restart.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.cinematicShadowsFrozen = false;
    this.qualityConfig = applyQuality(this.renderer, this.scene, this.quality, this.graphics);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.graphics.brightness;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    this.motionBlur = new DreamMotionBlur(this.renderer, this.scene, this.camera);
    this.motionBlur.configure(this.graphics);
    this.heartbeat = new Heartbeat();
    this.audio = getGlobalAudioManager();
    this.psychologicalVoices = new ChapterVoices(this.audio.internalVoices, {
      onCaptions: lines => this._renderVoiceCaptions(lines),
    });
    this.audio?.unlock?.();
    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider && this.audio?.setVolume) this.audio.setVolume(Number(volumeSlider.value) / 100);

    // ---- Input ----
    this.input = new InputManager();
    this.gamepadNoticeTime = 0;
    this.input.onGamepadConnected = () => { this.gamepadNoticeTime = 6; };
    this._ignoreLockErrorsUntil = 0;
    this._menuNav = { overlayId: null, index: 0, stickDir: 0, stickDirX: 0, repeat: 0, repeatX: 0, highlighted: null };

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
    this.enemyLockPin = document.getElementById('enemy-lock-pin');
    this.enemyPinPosition = new THREE.Vector3();
    this.hitFlashEl = document.getElementById('hit-flash');
    this.bossCinematic = document.getElementById('boss-cinematic');
    document.getElementById('skip-opening')?.addEventListener('click', () => this._skipOpening());
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
    this.fieldNote = document.getElementById('field-note');
    this.fieldNoteTitle = document.getElementById('field-note-title');
    this.fieldNoteDetail = document.getElementById('field-note-detail');
    this.fieldNotePrompt = document.getElementById('field-note-prompt');
    this.firstLevelTutorialSeen = new Set();
    this.firstLevelHintQueue = [];
    this.firstLevelHintTime = 0;
    this.firstLevelTutorialBlocking = false;
    this.firstLevelTutorialActive = null;
    this.firstLevelTutorialInventoryPause = false;
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
    this.weaponWheelPadHint = document.getElementById('weapon-wheel-pad-hint');
    this.weaponWheelKeyHints = [...document.querySelectorAll('.wheel-key-hint')];
    this.pauseGamepadHint = document.getElementById('pause-gamepad-hint');
    this.optionsGamepadHint = document.getElementById('options-gamepad-hint');
    this.menuKeyHint = document.getElementById('menu-key-hint');
    this.menuGamepadHint = document.getElementById('menu-gamepad-hint');
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
    this.menuMusic = new MenuMusic(document.getElementById('menu-music'), document.getElementById('volume-slider'));
    this.menuMusic.setActive(true);

    // ---- Start render loop ----
    this._animate();
  }

  // =====================================================================
  // UI Binding
  // =====================================================================
  _bindUI() {
    const unlockAudio = () => this.audio?.unlock?.();
    document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
    document.addEventListener('keydown', unlockAudio, { capture: true });
    document.querySelectorAll?.('.menu-btn')?.forEach(button => {
      button.addEventListener('pointerenter', () => this.audio?.playUiHover?.());
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.input.pointerLocked && !this.endingPreviewActive) this.pause();
    });
    document.addEventListener('pointerlockerror', () => {
      // A failed automatic re-capture after loading must not bounce to the pause menu;
      // the HUD's "click to capture" prompt covers that case instead.
      if (performance.now() < this._ignoreLockErrorsUntil) return;
      if (!this.input.pointerLockPending && document.pointerLockElement !== this.renderer.domElement && !this.endingPreviewActive) this.pause();
    });
    this.renderer.domElement.addEventListener('click', () => {
      if (this.state === this.STATE.PLAYING && !this.input.pointerLocked) this._captureMouse();
    });

    // Main menu
    document.getElementById('btn-start').addEventListener('click', () => { this._playUiConfirm?.(); this.startGame(); });
    document.getElementById('btn-levels').addEventListener('click', () => { this._playUiConfirm?.(); this._showOverlay('levels-overlay'); });
    document.getElementById('btn-levels-back').addEventListener('click', () => { this._playUiConfirm?.(); this._showOverlay('menu-overlay'); });
    document.querySelectorAll?.('[data-level-index]')?.forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.levelIndex);
        if (!this.levelManager.progress.canPlay(index)) return;
        this._playUiConfirm?.(); this.startGame(index);
      });
    });
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
    this._bindGraphicsSettings();
    const gamepadToggle = document.getElementById('gamepad-toggle');
    gamepadToggle.checked = this.input.gamepadEnabled;
    gamepadToggle.addEventListener('change', () => this.input.setGamepadEnabled(gamepadToggle.checked));
    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) volumeSlider.addEventListener('input', () => this.audio?.setVolume?.(Number(volumeSlider.value) / 100));
    this._bindInternalVoiceSettings?.();

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
    if (id === 'loading-overlay') this.container.classList.add('loading');
    else if (id) this.container.classList.remove('loading');
    if (id === 'levels-overlay') this._refreshLevelMenu();
    this.menuMusic?.setActive(this.state === this.STATE.MENU && ['menu-overlay', 'levels-overlay', 'credits-overlay', 'options-overlay'].includes(id));
    if (id) this._closeWeaponWheel();
    this.motionBlur.reset();
    if (id) this.heartbeat.stop();
    const overlays = ['menu-overlay', 'levels-overlay', 'credits-overlay', 'options-overlay', 'loading-overlay', 'pause-overlay', 'gameover-overlay', 'closing-credits-overlay', 'levelcomplete-overlay', 'win-overlay'];
    overlays.forEach(o => document.getElementById(o).classList.add('hidden'));
    if (id) document.getElementById(id).classList.remove('hidden');
    this.container.classList.toggle('playing', !id && this.state === this.STATE.PLAYING);
  }

  _refreshLevelMenu() {
    for (const button of document.querySelectorAll('[data-level-index]')) {
      const index = Number(button.dataset.levelIndex);
      const unlocked = this.levelManager.progress.canPlay(index);
      button.disabled = !unlocked;
      button.querySelector('[data-level-status]').textContent = unlocked ? 'Available' : `Locked · Reach Level ${index + 1}`;
    }
  }

  _bindInternalVoiceSettings() {
    const playback = this.audio.internalVoices;
    for (const [id, key, type] of [
      ['internal-voices-toggle', 'enabled', 'checkbox'], ['internal-voice-volume', 'volume', 'range'],
      ['internal-voice-mode', 'mode', 'select'], ['internal-voice-subtitles', 'subtitles', 'checkbox'],
    ]) {
      const control = document.getElementById(id);
      if (!control) continue;
      if (type === 'checkbox') control.checked = playback.settings[key];
      else control.value = type === 'range' ? playback.settings[key] * 100 : playback.settings[key];
      control.addEventListener(type === 'range' ? 'input' : 'change', () => {
        const value = type === 'checkbox' ? control.checked : type === 'range' ? Number(control.value) / 100 : control.value;
        playback.configure({ [key]: value });
        this.psychologicalVoices.cancel();
      });
    }
  }

  _renderVoiceCaptions(lines) {
    const container = document.getElementById('voice-subtitles');
    if (!container) return;
    container.replaceChildren(...lines.map(line => {
      const row = document.createElement('p');
      row.textContent = line.text;
      return row;
    }));
    container.hidden = lines.length === 0;
  }

  _playUiConfirm() {
    this.audio?.playUiConfirm?.();
  }

  _syncEnemyLock() {
    const player = this.player;
    const targets = player.alive && !player.scriptedMovement && this.currentLevel.allowsShooting !== false
      ? getEnemyLockTargets(this.currentLevel) : [];
    const previous = player.lockOnTarget;
    const target = targets.find(target => target.object === previous)
      || selectEnemyLockTarget(targets, player, !!previous);
    player.setBossLockTarget(target?.object ?? null, target?.height ?? 2);
    if (previous && target && previous !== target.object) player.toggleBossLock();
    this.enemyLockDescriptor = target;
  }

  _updateEnemyLockPin() {
    if (!this.enemyLockPin) return;
    const show = this.state === this.STATE.PLAYING && this.player?.alive && !this.player.scriptedMovement
      && this.player.lockOnTarget && this.enemyLockDescriptor?.object === this.player.lockOnTarget;
    if (!show) { this.enemyLockPin.classList.add('hidden'); return; }
    getEnemyPinPosition(this.enemyLockDescriptor, this.enemyPinPosition).project(this.camera);
    const point = this.enemyPinPosition;
    const inView = point.z >= -1 && point.z <= 1 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1;
    this.enemyLockPin.classList.toggle('hidden', !inView);
    if (inView) {
      this.enemyLockPin.style.left = `${(point.x * 0.5 + 0.5) * 100}%`;
      this.enemyLockPin.style.top = `${(-point.y * 0.5 + 0.5) * 100}%`;
    }
  }

  async _captureMouse({ pauseOnFailure = true } = {}) {
    this.heartbeat.unlock();
    this.audio?.unlock?.();
    this.input.flushMouseDelta();
    if (this.input.pointerLocked || this.endingPreviewActive) return;
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
    if (!Object.hasOwn(GRAPHICS_DESCRIPTIONS, level)) return;
    this.graphics = { ...graphicsPreset(level), brightness: this.graphics.brightness, showFps: this.graphics.showFps };
    this._applyGraphicsSettings();
  }

  _bindGraphicsSettings() {
    bindSettingsTabs(document.getElementById('options-overlay'), (tab, index) => {
      if (!this._menuNav) return;
      this._menuNav.highlighted?.classList.remove('gamepad-focus');
      this._menuNav.index = index;
      this._menuNav.highlighted = tab;
      if (this.input.gamepadInUse) tab.classList.add('gamepad-focus');
    });
    for (const control of document.querySelectorAll('[data-graphics]')) {
      control.addEventListener(control.type === 'range' ? 'input' : 'change', () => {
        const key = control.dataset.graphics;
        const value = control.type === 'checkbox' ? control.checked
          : control.type === 'range' ? Number(control.value) / 100
            : key === 'textureFiltering' ? Number(control.value) : control.value;
        this.graphics = normalizeGraphics({ ...this.graphics, [key]: value });
        this._applyGraphicsSettings();
      });
    }
    document.getElementById('btn-graphics-reset').addEventListener('click', () => {
      this.graphics = graphicsPreset(); this._applyGraphicsSettings();
    });
    this._syncGraphicsSettings();
  }

  _applyGraphicsSettings() {
    this.quality = this.graphics.preset;
    this.qualityConfig = applyQuality(this.renderer, this.scene, this.quality, this.graphics);
    const cinematicScene = this.currentLevel?.endingCutscene?.scene || this.currentLevel?.openingIntro?.scene;
    if (cinematicScene) applyQuality(this.renderer, cinematicScene, this.quality, this.graphics);
    this.motionBlur.configure(this.graphics);
    saveGraphics(this.graphics); this._syncGraphicsSettings();
  }

  _syncGraphicsSettings() {
    for (const control of document.querySelectorAll('[data-graphics]')) {
      const value = this.graphics[control.dataset.graphics];
      if (control.type === 'checkbox') control.checked = value;
      else control.value = control.type === 'range' ? Math.round(value * 100) : value;
    }
    const custom = isCustomGraphics(this.graphics);
    document.getElementById('quality-select').value = custom ? 'custom' : this.quality;
    document.getElementById('graphics-description').textContent = custom
      ? `Custom settings based on ${this.quality}. Changes apply immediately.` : GRAPHICS_DESCRIPTIONS[this.quality];
    document.getElementById('render-scale-value').textContent = `${Math.round(this.graphics.renderScale * 100)}%`;
    document.getElementById('brightness-value').textContent = `${Math.round(this.graphics.brightness * 100)}%`;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    document.getElementById('graphics-resolution').textContent = `${size.x} × ${size.y} render resolution`;
    document.getElementById('graphics-fps').hidden = !this.graphics.showFps || !!this.closingCredits?.active;
  }

  _updateGraphicsStats(frameDt) {
    if (!this.graphics.showFps || frameDt <= 0 || frameDt > 1) return;
    this.graphicsStatsTime = (this.graphicsStatsTime ?? 0) + frameDt;
    this.graphicsStatsFrames = (this.graphicsStatsFrames ?? 0) + 1;
    if (this.graphicsStatsTime < .5) return;
    const fps = this.graphicsStatsFrames / this.graphicsStatsTime;
    document.getElementById('graphics-fps').textContent = `${Math.round(fps)} FPS · ${(1000 / fps).toFixed(1)} ms`;
    this.graphicsStatsTime = this.graphicsStatsFrames = 0;
  }

  // =====================================================================
  // State Transitions
  // =====================================================================
  async startGame(levelIndex = null) {
    if (levelIndex !== null && !this.levelManager.progress.canPlay(levelIndex)) return;
    this.psychologicalVoices?.resetSession();
    this.combat.reset();
    this.firstLevelTutorialSeen.clear();
    this.firstLevelHintQueue.length = 0;
    this.firstLevelHintTime = 0;
    this.firstLevelTutorialBlocking = false;
    this.firstLevelTutorialActive = null;
    this.firstLevelTutorialInventoryPause = false;
    this.fieldNote?.classList.remove('visible', 'paused-guide');
    this.fieldNote?.setAttribute('aria-hidden', 'true');
    this.state = this.STATE.LOADING;
    this._showOverlay('loading-overlay');
    this.hudEl.classList.add('hidden');

    // Keep the cursor free during loading; it is re-captured when the level starts.
    this._releaseMouse();

    const progressBar = document.getElementById('progress-bar');
    progressBar.style.width = '0%';

    const launch = new URLSearchParams(window.location.search);
    const directFinal = levelIndex === null && launch.get('level') === '3';
    const directSophomore = levelIndex === null && launch.get('level') === '2';
    const directSophomoreSection = launch.get('section');
    const level = await this.levelManager.loadLevel(levelIndex ?? (directFinal ? 2 : directSophomore ? 1 : 0), (p) => {
      progressBar.style.width = `${p * 100}%`;
    }, directFinal && launch.get('victory') === '1' ? { victoryPreview: true,
      choicePreview: launch.get('choice') === '1', endingPreview: import.meta.env?.DEV ? launch.get('ending') : null } :
      directFinal && launch.get('transform') === '1' ? { transformationPreview: true } :
      directFinal && launch.get('boss') === '1' ? { bossPreview: true } :
      directSophomore && directSophomoreSection === 'spikes' ? { puzzleIndex: SPIKE_CORRIDOR_PUZZLE } :
      directSophomore && directSophomoreSection === 'memory' ? { puzzleIndex: 2 } : null);
    this.currentLevel = level;
    await this.psychologicalVoices?.loadForLevel?.(level);
    applyQuality(this.renderer, this.scene, this.quality, this.graphics); // Re-cap shadows on freshly loaded lights.
    this.audio?.setLevelTheme?.(level.title);
    this.audio?.preload?.(LEVEL_AUDIO_ASSETS);

    level.audioManager = this.audio;
    level.audioContext = this.audio?.ensureContext?.() ?? this.heartbeat.context;
    level.getEffectsVolume = () => Number(document.getElementById('volume-slider').value) / 100;
    await level.prepareAudio?.();
    await level.prepareCinematics?.(this.renderer, this.camera);
    // Create player
    if (this.player) this.player.dispose();
    this.player = new Player(this.scene, this.input, this.camera);
    this._applyMouseSensitivity();
    await this.player.loadCharacter();
    await this.player.setFootstepSurface?.(level.footstepSurface);
    this.player.group.position.copy(level.spawnPoint);
    await level.prepareShaders?.(this.renderer, this.camera, this.player);
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
    this.psychologicalVoices?.leave();
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
    applyQuality(this.renderer, this.scene, this.quality, this.graphics);
    this.audio?.restartLevelTheme?.(level.title);
    await this.psychologicalVoices?.loadForLevel?.(level);

    if (this.player) {
      level.audioManager = this.audio;
      level.audioContext = this.audio?.ensureContext?.() ?? this.heartbeat.context;
      level.getEffectsVolume = () => Number(document.getElementById('volume-slider').value) / 100;
      await level.prepareAudio?.();
      await level.prepareCinematics?.(this.renderer, this.camera);
      await level.prepareShaders?.(this.renderer, this.camera, this.player);
      this.player.reset(level.spawnPoint);
      await this.player.setFootstepSurface?.(level.footstepSurface);
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
    this.psychologicalVoices?.leave();
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
    applyQuality(this.renderer, this.scene, this.quality, this.graphics);
    this.audio?.setLevelTheme?.(level.title);
    this.player.reset(level.spawnPoint);
    await this.player.setFootstepSurface?.(level.footstepSurface);
    await this.psychologicalVoices?.loadForLevel?.(level);
    level.audioManager = this.audio;
    level.audioContext = this.audio?.ensureContext?.() ?? this.heartbeat.context;
    level.getEffectsVolume = () => Number(document.getElementById('volume-slider').value) / 100;
    await level.prepareAudio?.();
    await level.prepareCinematics?.(this.renderer, this.camera);
    await level.prepareShaders?.(this.renderer, this.camera, this.player);
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
    if (!this.currentLevel?.endingCutscene?.finalVoice) this.psychologicalVoices?.cancel();
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
    this.closingCredits?.dispose(); this.closingCredits = null;
    this.psychologicalVoices?.leave();
    this.combat.reset();
    this.audio?.stopAll?.();
    this.state = this.STATE.MENU;
    document.exitPointerLock();
    // The ending temporarily parents the player into its own scene. Restore it
    // before Player.dispose removes and frees the character's shared resources.
    if (this.currentLevel) {
      this.currentLevel.dispose();
      this.currentLevel = null;
      this.levelManager.currentLevel = null;
    }
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    this.hudEl.classList.add('hidden');
    this._showOverlay('menu-overlay');
  }

  gameOver() {
    this.psychologicalVoices?.cancel();
    this.currentLevel?.pauseEffects?.();
    this.state = this.STATE.GAMEOVER;
    this._showOverlay('gameover-overlay');
    document.getElementById('gameover-text').textContent = this.currentLevel?.failureReason || 'Your stamina ran out. The zombies got your degree.';
    const restartState = this.currentLevel?.getRestartState?.();
    const hasCheckpoint = restartState?.arenaCleared === true || restartState?.transformationPreview === true ||
      (Number.isInteger(restartState?.puzzleIndex) &&
        (restartState.puzzleIndex > 0 || (Number.isInteger(restartState.stageIndex) && restartState.stageIndex > 0)));
    document.getElementById('btn-retry').textContent = hasCheckpoint ? 'Retry Checkpoint' : 'Try Again';
    this.hudEl.classList.add('hidden');
    document.exitPointerLock();
  }

  levelComplete() {
    this.psychologicalVoices?.cancel();
    this.currentLevel?.pauseEffects?.();
    this.state = this.STATE.LEVELCOMPLETE;
    const overlay = document.getElementById('levelcomplete-overlay');
    document.getElementById('levelcomplete-title').textContent = this.currentLevel?.destinyChoice
      ? (this.currentLevel.destinyChoice === 'blue' ? 'A Quiet Beginning' : 'The Wrong Way Out') : 'Level Complete!';
    document.getElementById('levelcomplete-text').textContent = this.currentLevel.getCompletionText?.() ||
      `You collected ${this.currentLevel.creditsCollected} credits and survived ${this.currentLevel.title}.`;
    if (this.currentLevel?.endingCutscene?.done && this.currentLevel.destinyChoice) {
      this.closingCredits?.dispose();
      this.audio?.stopAll?.();
      this.closingCredits = new ClosingCredits(document.getElementById('closing-credits-overlay'), () => {
        this._showOverlay('levelcomplete-overlay');
        document.getElementById('graphics-fps').hidden = !this.graphics.showFps;
        document.getElementById('btn-nextlevel').focus({ preventScroll: true });
      });
      this._showOverlay('closing-credits-overlay');
      this.closingCredits.start(this.currentLevel.destinyChoice);
      document.getElementById('graphics-fps').hidden = true;
    } else this._showOverlay('levelcomplete-overlay');
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
    if (!this.player?.alive || this.player.scriptedMovement || this.currentLevel?.allowsShooting === false) return;
    this.psychologicalVoices?.cancel();
    this.combat.cancelMelee();
    this.input.consumeMousePresses?.(0);
    this.weaponWheelOpen = true;
    this.weaponWheelEl.classList.remove('hidden');
    this.weaponWheelEl.setAttribute('aria-hidden', 'false');
    this.wheelClickHeld = this.input.isMouseButtonDown(0);
    this.weaponWheelIndex = Math.max(0, WEAPONS.findIndex(weapon => weapon.id === this.player.weapon));
    this._setWheelIndex(this.weaponWheelIndex);
    if (this.weaponWheelPadHint) this.weaponWheelPadHint.hidden = !this.input.gamepadInUse;
    for (const hint of this.weaponWheelKeyHints || []) hint.hidden = this.input.gamepadInUse;
    this.input.flushMouseDelta();
  }

  /** Move the wheel picker to `index` (wrapping) and park the analog cursor on that slot. */
  _setWheelIndex(index) {
    const count = WEAPONS.length;
    this.weaponWheelIndex = ((index % count) + count) % count;
    const angle = -Math.PI / 2 + this.weaponWheelIndex * Math.PI * 2 / count;
    this.wheelX = Math.cos(angle) * 95;
    this.wheelY = Math.sin(angle) * 95;
    this._showWheelSelection();
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
    this._finishFirstLevelInventoryPause();
  }

  _finishFirstLevelInventoryPause() {
    if (!this.firstLevelTutorialInventoryPause) return;
    this.firstLevelTutorialInventoryPause = false;
    this.audio?.resume?.();
  }

  _handleFirstLevelTutorialControl() {
    if (!this.firstLevelTutorialBlocking) return false;
    const hint = this.firstLevelTutorialActive;
    // A pad button named directly (LB strikes on the mouse path) takes over from the key.
    const padControl = this.input.gamepadInUse ? hint?.padControl : undefined;
    const acknowledged = padControl !== undefined
      ? this.input.consumeGamepadPress(padControl)
      : !!hint?.control && this.input.consumeKeyPress(hint.control);
    if (acknowledged) {
      this.firstLevelTutorialBlocking = false;
      this.firstLevelTutorialActive = null;
      this.fieldNote?.classList.remove('visible', 'paused-guide');
      this.fieldNote?.setAttribute('aria-hidden', 'true');
      this.audio?.resume?.();
      if (hint.id === 'loadout') {
        this.firstLevelTutorialInventoryPause = true;
        this._openWeaponWheel();
        return true;
      }
      // Re-queue the acknowledged input so it performs the move the guide described.
      if (padControl !== undefined) this.input.mousePresses[0] = (this.input.mousePresses[0] || 0) + 1;
      else this.input.pressedKeys.add(hint.control);
      return false;
    }
    this.input.pressedKeys.clear();
    this.input.flushMouseDelta();
    return true;
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
    for (const id of ['menu-overlay', 'levels-overlay', 'credits-overlay', 'options-overlay', 'loading-overlay',
      'pause-overlay', 'gameover-overlay', 'closing-credits-overlay', 'levelcomplete-overlay', 'win-overlay']) {
      if (!document.getElementById(id).classList.contains('hidden')) return id;
    }
    return null;
  }

  _updateMenuFocus(dt) {
    const nav = this._menuNav;
    const overlayId = this._activeOverlayId();
    // Highlight for whichever device was used last: hover for the mouse, focus for the pad.
    const padActive = !!this.input.gamepadInUse && this.input.lastInputDevice === 'pad';
    document.body?.classList.toggle('using-pad', padActive);
    // The HUD (and its gamepad hint) is hidden while paused, so the pause menu carries its own.
    if (this.pauseGamepadHint) {
      this.pauseGamepadHint.hidden = !(overlayId === 'pause-overlay' && padActive);
    }
    // The Options screen adjusts sliders and toggles in place, so it needs its own pad line.
    if (this.optionsGamepadHint) {
      this.optionsGamepadHint.hidden = !(overlayId === 'options-overlay' && padActive);
    }
    // Main menu footer: show the pad controls instead of the keyboard ones.
    if (this.menuKeyHint) this.menuKeyHint.hidden = padActive;
    if (this.menuGamepadHint) this.menuGamepadHint.hidden = !padActive;
    if (!overlayId || !padActive) {
      this._clearMenuFocus();
      return;
    }
    // Swallow gameplay-only presses so they can't leak into the next playing frame.
    // The d-pad's left/right pair survives on the Options screen, where it adjusts controls.
    const gameplayPresses = [PAD.WHEEL, PAD.BASH, PAD.CAMERA, PAD.FIRE, PAD.ALT_FIRE, PAD.ATTACK];
    if (overlayId !== 'options-overlay') gameplayPresses.push(PAD.PREV_WEAPON, PAD.NEXT_WEAPON);
    for (const button of gameplayPresses) {
      this.input.consumeGamepadPress(button);
    }
    if (overlayId === 'loading-overlay') return;

    // B goes back: submenus return to their parent and pause resumes. Screens with no
    // parent (game over, win) still swallow the press so it cannot roll in gameplay.
    if (this.input.consumeGamepadPress(PAD.ROLL)) {
      this.input.releasePadButton(PAD.ROLL);
      const backButtonId = MENU_BACK_BUTTONS[overlayId];
      if (backButtonId) {
        document.getElementById(backButtonId)?.click();
        return;
      }
    }

    const overlay = document.getElementById(overlayId);
    // Options rows take the focus too, so volume, toggles and dropdowns adjust from the pad.
    const selector = overlayId === 'options-overlay' ? '.option-row, .menu-btn, .controls-reference' : '.menu-btn';
    const items = [...overlay.querySelectorAll(selector)]
      .filter(item => item.offsetParent !== null && !item.disabled);
    if (items.length === 0) {
      this._clearMenuFocus();
      return;
    }
    // Long panels (credits) have a single Back button, so the stick scrolls the panel
    // itself; item lists move the highlight, which stays in view.
    const panel = overlay.querySelector('.menu-container');
    const scrollable = !!panel && panel.scrollHeight > panel.clientHeight + 1;

    if (nav.overlayId !== overlayId) {
      nav.overlayId = overlayId;
      nav.index = overlayId === 'options-overlay'
        ? Math.max(0, items.findIndex(item => item.getAttribute?.('aria-selected') === 'true')) : 0;
      nav.stickDir = 0;
      nav.stickDirX = 0;
      nav.repeat = 0;
      nav.repeatX = 0;
      this._highlightMenuButton(items, nav.index);
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
      if (items.length > 1) {
        nav.index = stepFocusIndex(nav.index, dir, items.length);
        this._highlightMenuButton(items, nav.index);
        items[nav.index]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
      } else if (scrollable) {
        panel.scrollBy({ top: dir * MENU_SCROLL_STEP, behavior: 'smooth' });
      }
    }

    // Left/right nudges the focused option: volume and sensitivity slide, dropdowns
    // step and toggles check (right) or clear (left), as in a console settings screen.
    let adjust = 0;
    if (this.input.consumeGamepadPress(PAD.NEXT_WEAPON)) adjust = 1;
    if (this.input.consumeGamepadPress(PAD.PREV_WEAPON)) adjust = -1;
    const stickX = this.input.moveAxisX < -0.5 ? -1 : this.input.moveAxisX > 0.5 ? 1 : 0;
    if (stickX !== 0) {
      if (stickX !== nav.stickDirX) {
        adjust = stickX;
        nav.repeatX = 0.4;
      } else {
        nav.repeatX -= dt;
        if (nav.repeatX <= 0) {
          adjust = stickX;
          nav.repeatX = 0.16;
        }
      }
    }
    nav.stickDirX = stickX;
    if (adjust !== 0 && overlayId === 'options-overlay') {
      const item = items[nav.index];
      if (item.dataset?.settingsTab) {
        const tabs = [...overlay.querySelectorAll('[data-settings-tab]')];
        tabs[(tabs.indexOf(item) + adjust + tabs.length) % tabs.length]?.click();
      } else this._adjustMenuOption(this._menuItemControl(item), adjust);
    }

    if (this.input.consumeGamepadPress(PAD.JUMP)) {
      this.input.releasePadButton(PAD.JUMP);
      const item = items[nav.index];
      const control = this._menuItemControl(item);
      if (control) this._pressMenuOption(control);
      else item?.click();
    }
  }

  /** The input/select inside an option row, or null for a plain menu button. */
  _menuItemControl(item) {
    return item?.querySelector?.('input, select') || null;
  }

  /** A or a click on an option row: toggles, or steps a dropdown on. */
  _pressMenuOption(control) {
    if (control.type === 'checkbox') control.click();
    else this._adjustMenuOption(control, 1);
  }

  /** Left/right on an option row. Ranges slide, dropdowns step, toggles check/clear. */
  _adjustMenuOption(control, direction) {
    if (!control || direction === 0) return;
    if (control.type === 'range') {
      const min = Number(control.min || 0);
      const max = Number(control.max || 100);
      const step = max - min > 20 ? 5 : 1;
      const value = Math.min(max, Math.max(min, Number(control.value) + direction * step));
      control.value = String(value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (control.type === 'checkbox') {
      if (control.checked !== direction > 0) control.click();
    } else if (control.tagName === 'SELECT') {
      const count = control.options?.length ?? 0;
      if (count === 0) return;
      let index = control.selectedIndex;
      for (let tried = 0; tried < count; tried++) {
        index = (index + direction + count) % count;
        if (!control.options[index].disabled) break;
      }
      if (control.options[index].disabled) return;
      control.selectedIndex = index;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  _highlightMenuButton(buttons, index) {
    this._menuNav.highlighted?.classList.remove('gamepad-focus');
    const button = buttons[index];
    if (button && button !== this._menuNav.highlighted) this.audio?.playUiHover?.();
    this._menuNav.highlighted = button || null;
    if (button) {
      button.classList.add('gamepad-focus');
      (button.querySelector?.('input, select') || button).focus({ preventScroll: true });
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
      ? `${weapon.damage} damage / hit · ${this.currentLevel?.hasUnlimitedAmmo?.(weapon.id) ? '∞' : this.player.getAmmo?.(weapon.id) ?? this.player.ammo} bullets${weapon.ammo > 1 ? ' · 2 / shot' : ''}`
      : `${weapon.damage} damage / hit · ${weapon.reach}m reach`;
    const pickPrompt = this.input?.gamepadInUse ? 'PRESS A TO EQUIP' : 'CLICK TO EQUIP';
    this.weaponWheelStatus.textContent = weapon.id === this.player.weapon ? 'EQUIPPED' : pickPrompt;
  }

  _updateWeaponWheel() {
    // D-pad steps the picker around the ring: right/down forward, left/up back.
    const padForward = this.input.consumeGamepadPress(PAD.NEXT_WEAPON);
    const padDown = this.input.consumeGamepadPress(PAD.DOWN);
    const padBack = this.input.consumeGamepadPress(PAD.PREV_WEAPON);
    const padUp = this.input.consumeGamepadPress(PAD.UP);
    const step = (padForward || padDown ? 1 : 0) + (padBack || padUp ? -1 : 0);
    if (step !== 0) this._setWheelIndex(this.weaponWheelIndex + step);
    // B backs out of the wheel without equipping.
    if (this.input.consumeGamepadPress(PAD.ROLL)) {
      this.input.releasePadButton(PAD.ROLL);
      // Drop the held press so backing out does not roll as gameplay resumes.
      if (this.player) this.player.dodgeHeld = true;
      this._closeWeaponWheel();
      this._finishFirstLevelInventoryPause();
      this.input.flushMouseDelta();
      return;
    }
    // A equips the highlighted slot, just like clicking it with the mouse.
    if (this.input.consumeGamepadPress(PAD.JUMP)) {
      this.input.releasePadButton(PAD.JUMP);
      // Drop the held press so closing the wheel does not also jump.
      if (this.player) this.player.jumpHeld = true;
      this._equipWeapon(WEAPONS[this.weaponWheelIndex].id);
      this.input.flushMouseDelta();
      return;
    }
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
    // Mouse players click a slot; on a pad only A picks, so LB and RT cannot equip.
    if (!this.input.gamepadInUse) {
      const clicked = this.input.isMouseButtonDown(0);
      if (clicked && !this.wheelClickHeld) this._equipWeapon(WEAPONS[this.weaponWheelIndex].id);
      this.wheelClickHeld = clicked;
    }
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
      ? 'Left stick: Move | Right stick: Look | LB: Shoot/Attack | RB: Sprint | A: Jump | X: Weapons | B: Roll | Y: Camera | L3: Gun bash | Start: Pause'
      : `${this.currentLevel.controlsHint || this.defaultControlsHint} | 1: Wheel | 2-6: Equip`;
    if (this.player.bossLockAvailable) this.controlsHint.textContent += this.input.gamepadInUse
      ? ` | R3: ${this.player.lockOnTarget ? 'Unlock [LOCKED]' : 'Lock enemy'}`
      : ` | L/Middle-click: ${this.player.lockOnTarget ? 'Unlock [LOCKED]' : 'Lock enemy'}`;
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

    const checkpoints = [this.currentLevel.exitCheckpoint?.root, this.currentLevel.bossFight?.centerMarker,
      ...(this.currentLevel.victoryPortals?.indicators ?? []).map(marker => marker.root)];
    for (const checkpoint of checkpoints) {
      if (!checkpoint?.visible) continue;
      const position = checkpoint.getWorldPosition(new THREE.Vector3());
      const x = (position.x - px) * scale + w / 2, y = (position.z - pz) * scale + h / 2;
      if (x > 5 && x < w - 5 && y > 5 && y < h - 5) {
        ctx.fillStyle = '#e4c48b';
        ctx.strokeStyle = '#21170e'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); ctx.stroke();
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
    this._updateGraphicsStats(frameDt);
    let voiceEvents = {};
    const dt = Math.min(frameDt, 0.05); // cap gameplay physics to avoid spiral of death
    this.elapsedTime += dt;
    this.input.updateGamepad(dt);
    // Look deltas only get consumed during active gameplay (player look / weapon wheel).
    // Drop them everywhere else so mouse or right-stick movement during loading, menus,
    // or paused can't pile up and lurch the camera when gameplay resumes.
    if (!(this.state === this.STATE.PLAYING && (this.input.pointerLocked || this.input.gamepadInUse || this.endingPreviewActive))) {
      this.input.flushMouseDelta();
    }
    this.gamepadNoticeTime = Math.max(0, this.gamepadNoticeTime - dt);

    // ---- Handle one-shot key presses ----
    let inventoryFrame = this.weaponWheelOpen;
    if (this._handleFirstLevelTutorialControl()) inventoryFrame = true;
    if (this.state === this.STATE.PLAYING && this.player?.alive && !this.player.scriptedMovement
      && this.currentLevel?.allowsShooting !== false) {
      // X opens the wheel, but B is the button that closes it — swallow X while it is open.
      if (this.weaponWheelOpen && this.input.gamepadInUse) this.input.consumeGamepadPress(PAD.WHEEL);
      if (this.input.consumeKeyPress('Digit1')) {
        if (this.weaponWheelOpen) {
          this._closeWeaponWheel();
          this._finishFirstLevelInventoryPause();
        }
        else this._openWeaponWheel();
        inventoryFrame = true;
      }
      for (const weapon of WEAPONS) {
        if (this.input.consumeKeyPress(`Digit${weapon.slot}`)) this._equipWeapon(weapon.id);
      }
      if (!this.weaponWheelOpen) {
        if (this.input.consumeGamepadPress(PAD.PREV_WEAPON)) this._cycleWeapon(-1);
        if (this.input.consumeGamepadPress(PAD.NEXT_WEAPON)) this._cycleWeapon(1);
      }
      if (this.weaponWheelOpen) { this._updateWeaponWheel(); inventoryFrame = true; }
    }
    if (this.state === this.STATE.PLAYING && !this.player.scriptedMovement && !this.player.carryingDegree && this.input.consumeKeyPress('KeyC')) {
      this.player.toggleCamera();
      this.motionBlur.reset();
    }

    // Gamepad Start pauses and resumes; pointer-lock loss handles the keyboard path.
    if (this.input.consumeGamepadPress(PAD.START)) {
      if (this.state === this.STATE.PLAYING) this.pause();
      else if (this.state === this.STATE.PAUSED) this.resume();
    }

    this._updateMenuFocus(dt);
    if (this.closingCredits?.active) {
      if (!document.hidden) this.closingCredits.update(frameDt);
      // Credits are DOM text over black. Stop rendering the ended 3D stage.
      return;
    }

    if (this.input.isDown('KeyR') && this.state === this.STATE.PLAYING) {
      this.input.keys['KeyR'] = false;
      this.restartLevel();
    }

    // ---- Update logic ----
    if (this.state === this.STATE.PLAYING && (this.input.pointerLocked || this.input.gamepadInUse || this.endingPreviewActive) && this.player && this.currentLevel && !inventoryFrame) {
      if (!this.player.alive) {
        this._updatePlayerDeath(dt);
      } else {
        this._syncEnemyLock();
        const lockKey = this.input.consumeKeyPress('KeyL');
        const lockMouse = this.input.consumeMousePresses?.(1);
        if (lockKey || lockMouse) this.player.toggleBossLock();
        this.player.update(
          dt, this.currentLevel.getObstacles?.() ?? NO_OBSTACLES,
          this.currentLevel.getWorldBounds?.(), this.currentLevel.getPlatforming?.()
        );
        this.audio?.setListenerPosition?.(this.player.group.position);
        this._handleShooting(dt);

        // The escape follows elapsed time, so a slow frame cannot stretch the film.
        const cinematicClock = this.currentLevel.bossCutscene?.usesElapsedTime
          || this.currentLevel.orbPortalCutscene?.usesElapsedTime || this.currentLevel.portalCinematicActive
          || this.currentLevel.openingCinematicActive;
        if (this.currentLevel.openingCinematicActive
          && this._consumeOpeningSkip()) this._skipOpening();
        const levelDt = cinematicClock ? Math.min(frameDt, 0.15) : dt;
        const events = this.currentLevel.update(levelDt, this.player, this.elapsedTime);
        this._syncEnemyLock();
        if (this.player.lockOnTarget && !this.player.scriptedMovement) this.player._updateCamera();
        voiceEvents = events;
        this._checkFirstLevelTutorial(events, dt);

        if (events.creditCollected) {
          const finalCredit = events.finalCreditCollected === true;
          this.audio?.playCreditPickup?.();
          if (finalCredit) this.audio?.playFinalCreditMilestone?.();
        }
        if (events.firstCreditCollected) {
          this.audio?.playTheme?.('freshman-rannsaka', './assets/audio/music/rannsaka.mp3', { volume: 0.62 });
        }
        if (events.deanReveal) this.audio?.playDeanReveal?.();
        if (events.houseZombiesEmerging) this.audio?.setFinalEncounterPhase?.('house-emergence');
        if (events.portalActivated) {
          this.audio?.playPortalActivation?.();
          this.audio?.startPortalHum?.(this.currentLevel.portalRoot?.position);
        }
        if (this.currentLevel.portalActive) this.audio?.updatePortalHum?.(this.currentLevel.portalRoot?.position);
        if (events.portalArrival || events.portalPassage) this.audio?.playPortalEntry?.();
        if (events.portalEntry) { this.audio?.playPortalEntry?.(); this.audio?.stopPortalHum?.(); }
        if (this.currentLevel.title?.toLowerCase().includes('final')) {
          const phase = this.currentLevel.getMusicPhase();
          this.audio?.setFinalEncounterPhase?.(phase);
        }

        if (events.levelComplete) {
          if (events.autoAdvance) { this.loadNextLevel(); return; }
          this.levelComplete();
        }

        if (!this.player.alive) {
          this.combat.cancelMelee();
          // Direct scripted fatalities keep their existing timing; combat deaths finish visibly.
          if (!this.player.deathSequence) this.gameOver();
        }

        if (!this.currentLevel.bossCutscene && !this.currentLevel.orbPortalCutscene && !this.currentLevel.openingCinematicActive) this._updateHUD();
      }
    }

    // ---- Render ----
    this._updateEnemyLockPin();
    this._updateCinematicPresentation();
    const active = this.state === this.STATE.PLAYING
      && (this.input.pointerLocked || this.input.gamepadInUse || this.endingPreviewActive) && !document.hidden;
    const ending = this.currentLevel?.endingCutscene;
    if (ending?.choice === 'blue' && !ending.finalVoice) {
      ending.finalVoice = new EndingVoice(this.audio.internalVoices,
        this.psychologicalVoices.third.assets.l3_protector_good_ending,
        lines => this._renderVoiceCaptions(lines));
    }
    if (ending?.choice === 'blue' && ending.time >= 7.5 && !ending.finalVoicePrepared) {
      this.psychologicalVoices.cancel();
      ending.finalVoicePrepared = true;
    }
    if (active && ending?.choice === 'blue' && ending.time >= 8) ending.finalVoice.start();
    const voiceGain = this.audio?.internalVoiceGain?.gain;
    const audioContext = this.audio?.context;
    if (voiceGain && audioContext) {
      const fade = 1;
      voiceGain.setTargetAtTime(this.audio.internalVoices.settings.volume * INTERNAL_VOICE_GAIN * fade, audioContext.currentTime, 0.08);
    }
    this.psychologicalVoices?.update(dt, this.currentLevel, this.player, {
      active,
      blocked: !!ending && (ending.choice === 'red' ? ending.time >= 20 : ending.time >= 7.5) || this.firstLevelTutorialBlocking || this.firstLevelTutorialInventoryPause || this.weaponWheelOpen,
      events: voiceEvents,
    });
    const freezeCinematicShadows = active && !!this.currentLevel?.portalCinematicActive;
    if (freezeCinematicShadows !== this.cinematicShadowsFrozen) {
      this.renderer.shadowMap.autoUpdate = !freezeCinematicShadows;
      if (!freezeCinematicShadows) this.renderer.shadowMap.needsUpdate = true;
      this.cinematicShadowsFrozen = freezeCinematicShadows;
    }
    const effects = getDistressEffects(this.player, this.currentLevel?.wakeUpIntro, active);
    this.heartbeat.update(effects.distress, Number(document.getElementById('volume-slider').value) / 100);
    const cinematic = !!(this.currentLevel?.bossCutscene?.usesElapsedTime
      || this.currentLevel?.orbPortalCutscene?.usesElapsedTime || this.currentLevel?.portalCinematicActive
      || this.currentLevel?.openingCinematicActive || this.currentLevel?.endingCutscene);
    // Warm-up passes may render temporary poses. Keep them behind the loading cover.
    if (this.state === this.STATE.LOADING) return;
    if (this.currentLevel?.endingCutscene) this.currentLevel.endingCutscene.render(this.renderer, this.quality);
    else this.motionBlur.render(dt, this.qualityConfig.blur && !cinematic ? effects.blur : 0,
      this.currentLevel?.openingCinematicActive ? this.currentLevel.openingIntro.scene : this.currentLevel?.endingCutscene?.scene || this.scene, cinematic);
    // Reveal only after the live frame and its cinematic fade have been prepared.
    this.container.classList.remove('loading');
  }

  _updatePlayerDeath(dt) {
    this.currentLevel.exitCheckpoint?.hide();
    this.currentLevel.updateDeathEffects?.(dt, this.player);
    const finished = this.player.updateDeath(dt);
    this._updateHUD();
    if (finished) this.gameOver();
  }

  _queueFirstLevelHint(id, title, detail) {
    if (this.firstLevelTutorialSeen.has(id)) return;
    this.firstLevelTutorialSeen.add(id);
    const hint = FIRST_LEVEL_HINTS[id];
    this.firstLevelHintQueue.push({ id, title, detail, control: hint.control, padControl: hint.padControl, prompt: hint.prompt, padPrompt: hint.padPrompt, key: hint.key, padKey: hint.padKey });
  }

  /** Word the note for the input in hand: gamepad buttons when a pad is connected, keys otherwise. */
  _resolveFirstLevelHint(hint) {
    const pad = !!this.input?.gamepadInUse;
    const controls = FIRST_LEVEL_HINTS[hint.id] || {};
    const keyLabel = (pad ? controls.padKey : controls.key) ?? hint.key ?? '';
    return {
      detail: String(hint.detail ?? '').replaceAll('{control}', keyLabel),
      prompt: (pad ? controls.padPrompt : controls.prompt) ?? hint.prompt ?? '',
    };
  }

  _checkFirstLevelTutorial(events, dt) {
    const level = this.currentLevel;
    if (!level?.title?.includes('Freshman Woods')) return;

    if (this.combat.firstZombieHit) {
      this._queueFirstLevelHint('loadout', 'First blood', 'The shot drew blood. Press {control} to inspect your loadout.');
    }

    if (!level.bossCutscene && !level.orbPortalCutscene && !level.portalCinematicActive && this.player?.alive) {
      let nearestZombieSq = Infinity;
      for (const zombie of level.zombies || []) {
        if (!zombie.alive || !zombie.group.visible || zombie.portalExit) continue;
        nearestZombieSq = Math.min(nearestZombieSq, zombie.group.position.distanceToSquared(this.player.group.position));
      }
      if (nearestZombieSq <= 7.84) {
        this._queueFirstLevelHint('strike', 'Too close for a clean shot', 'Press {control} to strike at close range; with an empty firearm, Shaun pistol-whips the target.');
      } else if (nearestZombieSq <= 64) {
        this._queueFirstLevelHint('roll', 'It is closing in', 'Press {control} to roll clear when the dead get within reach.');
      }
    }

    // The third orb releases the third wave. Offer lock-on only while a
    // target can actually be selected; never trap the player on an empty scene.
    if (level.creditsCollected >= 3 && this.player?.alive && !this.player.lockOnTarget
      && this.player.bossLockAvailable && !level.bossCutscene && !level.orbPortalCutscene
      && !level.portalCinematicActive && !level.openingCinematicActive) {
      this._queueFirstLevelHint('lock', 'Focus your aim',
        'Lock on to a visible enemy to keep them in view. Press {control} again to unlock.');
    }
    this._updateFirstLevelTutorial(dt);
  }

  _updateFirstLevelTutorial(dt) {
    const level = this.currentLevel;
    if (!this.fieldNote) return;
    if (!level?.title?.includes('Freshman Woods')) {
      this.fieldNote.classList.remove('visible');
      this.fieldNote.setAttribute('aria-hidden', 'true');
      return;
    }
    if (this.state !== this.STATE.PLAYING) return;
    if (level.bossCutscene || level.orbPortalCutscene || level.portalCinematicActive || level.openingCinematicActive) return;

    if (this.firstLevelTutorialBlocking || this.firstLevelTutorialInventoryPause) return;
    if (this.firstLevelHintQueue.length) {
      // A target may disappear while earlier hints are displayed. Keep this
      // hint queued until locking can succeed, without blocking other hints.
      if (this.player?.lockOnTarget) this.firstLevelHintQueue = this.firstLevelHintQueue.filter(hint => hint.id !== 'lock');
      const index = this.firstLevelHintQueue.findIndex(hint => hint.id !== 'lock' || this.player?.bossLockAvailable);
      if (index < 0) return;
      const [hint] = this.firstLevelHintQueue.splice(index, 1);
      const copy = this._resolveFirstLevelHint(hint);
      this.fieldNoteTitle.textContent = hint.title;
      this.fieldNoteDetail.textContent = copy.detail;
      this.fieldNotePrompt.textContent = copy.prompt;
      this.firstLevelHintTime = 0;
      this.firstLevelTutorialActive = hint;
      this.firstLevelTutorialBlocking = true;
      this.audio?.pause?.();
      this.fieldNote.setAttribute('aria-hidden', 'false');
      this.fieldNote.classList.add('visible', 'paused-guide');
    }
  }

  _updateCinematicPresentation() {
    const playing = this.state === this.STATE.PLAYING && (this.input.pointerLocked || this.input.gamepadInUse || this.endingPreviewActive);
    // The opening's black card screen must already cover its warm-up frame,
    // even while an automatic pointer-lock request is still pending.
    const opening = this.state === this.STATE.PLAYING && this.currentLevel?.openingCinematicActive;
    const bossIntro = !!this.currentLevel?.bossCutscene;
    const completedEnding = this.state === this.STATE.LEVELCOMPLETE && !!this.currentLevel?.endingCutscene;
    const cinematic = !!opening || completedEnding || playing && (bossIntro || !!this.currentLevel?.orbPortalCutscene
      || !!this.currentLevel?.portalCinematicActive || !!this.currentLevel?.degreeBurnCinematicActive
      || !!this.currentLevel?.transformationCinematicActive || !!this.currentLevel?.victoryCinematicActive
      || opening || this.currentLevel?.forestRevealTime < 0.8);
    this.bossCinematic?.classList.toggle('active', cinematic);
    this.bossCinematic?.classList.toggle('boss-intro', playing && bossIntro);
    const fade = opening ? this.currentLevel.openingIntro.fade : this.currentLevel?.endingCutscene ? this.currentLevel.endingCutscene.fade
      : this.currentLevel?.destinyPassage ? THREE.MathUtils.smoothstep(this.currentLevel.destinyPassage.time, this.currentLevel.destinyPassage.duration * 0.65, this.currentLevel.destinyPassage.duration) : this.currentLevel?.forestRevealTime < 0.8
      ? 1 - THREE.MathUtils.smoothstep(this.currentLevel.forestRevealTime, 0, 0.8) : bossIntro ? this.currentLevel.bossCutscene.fade || 0 : 0;
    this.bossCinematic?.style?.setProperty('--cutscene-fade', String(fade));
    const openingUI = document.getElementById('opening-presentation');
    openingUI?.classList.toggle('active', !!opening);
    openingUI?.setAttribute('aria-hidden', String(!opening));
    document.getElementById('opening-card')?.style.setProperty('opacity', String(opening ? this.currentLevel.openingIntro.cardOpacity : 0));
    if (opening) document.getElementById('opening-card').textContent = this.currentLevel.openingIntro.cardText;
    this.levelTitleDisplay?.classList.toggle('opening-hidden', !!opening);
    this.hudEl?.classList.toggle('cinematic', cinematic);
  }

  _consumeOpeningSkip() {
    return this.input.consumeKeyPress('Enter') || this.input.consumeGamepadPress?.(PAD.ROLL) || false;
  }

  _skipOpening() {
    if (!this.currentLevel?.openingCinematicActive) return;
    this.psychologicalVoices?.cancel();
    this.currentLevel.openingIntro.skip();
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    applyQuality(this.renderer, this.scene, this.quality, this.graphics);
    this.motionBlur.setSize(window.innerWidth, window.innerHeight);
    this._syncGraphicsSettings();
  }

  async _warmLoadedView() {
    await compileHiddenObjects(this.renderer, this.scene, this.camera, [this.player?.group,
      this.currentLevel?.exitCheckpoint?.root, this.currentLevel?.bossFight?.centerMarker]);
    await this.renderer.compileAsync(this.scene, this.camera);
    if (!this.player) return;
    // Force the actual lighting, shadows and skinned-player variants to link
    // while the DOM loading overlay still covers the canvas. compileAsync alone
    // cannot warm shaders for objects hidden during an entrance cutscene.
    const wasVisible = this.player.group.visible;
    this.player.group.visible = true;
    try {
      this.renderer.render(this.scene, this.camera);
      this.motionBlur?.render(1 / 60, 0);
    }
    finally { this.player.group.visible = wasVisible; }
    if (this.currentLevel?.openingCinematicActive) {
      await this.renderer.compileAsync(this.currentLevel.openingIntro.scene, this.camera);
      this.renderer.render(this.currentLevel.openingIntro.scene, this.camera);
    }
  }
}
