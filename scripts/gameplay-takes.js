// Capture-only controls. Never imported by the shipped game.
// Each take starts at a documented checkpoint; everything after frame zero uses
// the real Game loop, player input, collision, combat and level state machines.
(async () => {
  const { SOPHOMORE_LAYOUT: layout } = await import('/src/levels/SophomoreLayout.js');
  const game = window.__game;
  const tick = Object.getPrototypeOf(game)._animate.bind(game);
  game._animate = () => {};
  const input = game.input;
  input.updateGamepad = () => {};
  input.gamepadInUse = true;
  input.requestPointerLock = async () => false;
  const clearInput = () => {
    input.keys = {}; input.pressedKeys.clear(); input.mouseButtons = {}; input.mousePresses = {};
    input.moveAxisX = input.moveAxisY = 0; input.flushMouseDelta();
  };
  const keys = (...codes) => { input.keys = Object.fromEntries(codes.map(code => [code, true])); };
  const tap = code => input.pressedKeys.add(code);
  let levelIndex = -1, control = () => {}, time = 0, frame = 0;
  const events = [];
  const actualLevelUpdate = level => {
    if (level._collapseTile) {
      const collapse = level._collapseTile.bind(level);
      level._collapseTile = tile => { events.push({ time, event: 'tile_collapse' }); return collapse(tile); };
    }
    const update = level.update.bind(level);
    level.update = (...args) => {
      const result = update(...args);
      for (const [event, value] of Object.entries(result || {})) {
        if (value === true) events.push({ time, event });
      }
      return result;
    };
  };
  async function load(index, url = '/') {
    if (levelIndex === index) return;
    history.replaceState(null, '', url);
    game.levelManager.progress.reach(2);
    await game.startGame(index === 2 ? null : index);
    levelIndex = index;
    input.gamepadInUse = true;
    game.audio.stopAll();
    await game.audio.context?.suspend();
    if (!game.audio.captureLogged) {
      const play = game.audio.playSfx.bind(game.audio);
      game.audio.playSfx = (sources, options = {}) => {
        const candidates = Array.isArray(sources) ? sources : [sources];
        const source = candidates[Math.floor(Math.random() * candidates.length)];
        if (source) events.push({ time, event: 'sfx_trigger', source, volume: options.volume ?? 1, pitch: options.pitch ?? 1 });
        return play(source, options);
      };
      game.audio.captureLogged = true;
    }
    game.psychologicalVoices.cancel();
    game.psychologicalVoices.update = () => {};
    for (const hint of ['loadout', 'roll', 'strike']) game.firstLevelTutorialSeen.add(hint);
    game.firstLevelHintQueue.length = 0;
    game.firstLevelTutorialBlocking = false;
    game.renderer.setPixelRatio(1); game.renderer.setSize(1920, 1080);
    game.camera.aspect = 16 / 9; game.camera.updateProjectionMatrix();
    actualLevelUpdate(game.currentLevel);
  }
  function place(x, z, yaw = 0, support = null) {
    const p = game.player;
    // Normal full-health checkpoint reset BETWEEN takes, never during one.
    p.reset();
    game.state = game.STATE.PLAYING; game._showOverlay(null);
    p.group.position.set(x, 0, z); p.lastSafePosition.copy(p.group.position);
    p.group.rotation.set(0, yaw, 0); p.bodyMesh.position.set(0, 0, 0); p.bodyMesh.rotation.set(0, 0, 0);
    p.group.visible = p.bodyMesh.visible = true;
    p.yaw = yaw; p.pitch = -0.12; p.velocity.set(0, 0, 0); p.verticalVelocity = 0;
    p.scriptedMovement = false; p.grounded = true; p.platformSupport = support;
    p.isDodging = false; p.dodgeTimer = p.dodgeCooldownTimer = 0;
    p.jumpHeld = p.dodgeHeld = false; p.cameraGroundY = 0;
    p._playAnimation('Idle_Gun', 'Idle'); p.mixer?.update(0.01); p._updateCamera();
    if ('previousGauntletPosition' in game.currentLevel) game.currentLevel.previousGauntletPosition = p.group.position.clone();
    clearInput();
  }
  function step(dt, render = true) {
    const raf = window.requestAnimationFrame, draw = game.renderer.render;
    const delta = game.clock.getDelta;
    window.requestAnimationFrame = () => 0;
    game.clock.getDelta = () => dt;
    if (!render) game.renderer.render = () => {};
    try { tick(); } finally {
      window.requestAnimationFrame = raf; game.renderer.render = draw; game.clock.getDelta = delta;
    }
  }
  function advance(seconds) { for (let i = 0; i < seconds * 60; i++) step(1 / 60, false); }
  const takes = {
    opening_scene: { seconds: 3, async prepare() {
      await load(0); const l = game.currentLevel;
      l.openingIntro.time = 24; l.openingIntro.update(0); clearInput();
      control = () => keys();
    } },
    forest_run: { seconds: 5, async prepare() {
      await load(0); const l = game.currentLevel;
      l.openingIntro?.dispose(); l.openingIntro = null; l.wakeUpIntro?.restore(); l.wakeUpIntro = null;
      place(0, 12); game.player.pitch = -0.08;
      control = () => keys('KeyW');
    } },
    forest_credit: { seconds: 5, async prepare() {
      await load(0); const l = game.currentLevel;
      l.openingIntro?.dispose(); l.openingIntro = null; l.wakeUpIntro?.restore(); l.wakeUpIntro = null;
      const orb = l.credits.find(credit => !credit.collected).mesh.position;
      place(orb.x, orb.z + 4.4);
      control = t => keys(...(t < 0.65 ? ['KeyW'] : []));
    } },
    forest_combat: { seconds: 5, async prepare() {
      await load(0); const l = game.currentLevel;
      l.openingIntro?.dispose(); l.openingIntro = null; l.wakeUpIntro?.restore(); l.wakeUpIntro = null;
      if (!l.creditsCollected) {
        const orb = l.credits[0].mesh.position; place(orb.x, orb.z); advance(10);
      }
      if (l.orbPortalCutscene) advance(10);
      // Reposition between takes only, in the real portal's approach lane.
      place(0, 32, Math.PI);
      game._equipWeapon('smg');
      control = t => {
        const target = l.zombies.find(z => z.alive && z.group.visible && !z.portalExit);
        if (target) {
          const p = game.player.group.position, z = target.group.position;
          const desired = Math.atan2(p.x - z.x, p.z - z.z);
          const difference = desired - game.player.yaw;
          input.mouseDeltaX = -Math.atan2(Math.sin(difference), Math.cos(difference)) / game.player.mouseSensitivity;
        }
        keys(...(t > 1.5 ? ['KeyA'] : [])); input.mouseButtons[0] = true;
        if (Math.abs(t - 2.2) < 1 / 120) tap('KeyQ');
      };
    } },
    forest_sword: { seconds: 3, async prepare() {
      await load(0); const l = game.currentLevel;
      l.openingIntro?.dispose(); l.openingIntro = null; l.wakeUpIntro?.restore(); l.wakeUpIntro = null;
      const credit = l.credits.find(c => !c.collected);
      if (credit) { place(credit.mesh.position.x, credit.mesh.position.z); advance(4); }
      if (l.orbPortalCutscene) advance(8);
      const target = l.zombies.find(z => z.alive && z.group.visible && !z.portalExit);
      if (!target) throw Error('No live zombie for sword coverage');
      place(target.group.position.x, target.group.position.z + 2.1); game._equipWeapon('sword');
      control = t => { keys(); if (Math.abs(t % 0.3) < 0.01) tap('KeyF'); };
    } },
    dungeon_saws: { seconds: 3, async prepare() {
      await load(1); const l = game.currentLevel;
      l._restoreArrivalPlayer(); l.deanBladeIntro = false; l.phase = 'chase'; l.puzzleIndex = 0;
      place(0, layout.firstBladeZ + 3.5, 0, l.bladeSurface);
      // The guide has already demonstrated the blades at this checkpoint.
      l.bossMarker.position.set(0, 0, layout.bladeCompleteZ - 8);
      control = () => { keys('KeyW');
        const p = game.player, blade = l.blades.find(b => b.z < p.group.position.z + 0.66);
        if (blade && p.group.position.z - blade.z < 2 && !p.isDodging && p.dodgeCooldownTimer <= 0) tap('KeyQ');
      };
    } },
    dungeon_bridge: { seconds: 3.5, async prepare() {
      await load(1); const l = game.currentLevel;
      l._restoreArrivalPlayer(); l.deanBladeIntro = false; l.phase = 'chase'; l.puzzleIndex = 1;
      place(0, layout.bladeDeckMinZ + 0.25, 0, l.bladeSurface);
      let next = 0, wasAirborne = false;
      control = () => {
        const p = game.player, bridge = l.bridgePlatforms[Math.min(next, 5)];
        if (wasAirborne && p.grounded && p.platformSupport?.bridge === next) { next++; wasAirborne = false; }
        const dx = bridge.platform.position.x - p.group.position.x;
        input.moveAxisX = Math.max(-0.55, Math.min(0.55, dx * 0.3));
        keys('KeyW');
        if (p.grounded) tap('Space'); else wasAirborne = true;
      };
    } },
    dungeon_spikes: { seconds: 4, async prepare() {
      await load(1); const l = game.currentLevel;
      l._restoreArrivalPlayer(); l.deanBladeIntro = false; l.phase = 'chase'; l.puzzleIndex = 3;
      place(1.5, layout.spikeCorridorMaxZ + 1.5, 0, l.bridgeExitSurface);
      control = t => { keys('KeyW'); if (Math.abs(t % 0.9) < 0.018) tap('Space'); };
    } },
    dungeon_memory: { seconds: 6, async prepare() {
      await load(1); const l = game.currentLevel;
      l._restoreArrivalPlayer(); l.deanBladeIntro = false; l.puzzleIndex = 2;
      l._beginDemonstration();
      const start = l.tilePosition(...l.pattern[0]); place(start.x, 1.4, 0, l.startSurface);
      game.player.pitch = -0.27;
      control = () => keys();
    } },
    dungeon_memory_run: { seconds: 5, async prepare() {
      await load(1); const l = game.currentLevel;
      l._restoreArrivalPlayer(); l.deanBladeIntro = false; l.puzzleIndex = 2; l._beginDemonstration();
      const start = l.tilePosition(...l.pattern[0]); place(start.x, 1.4, 0, l.startSurface);
      while (l.phase === 'watch') step(1 / 60, false);
      game.player.pitch = -0.27;
      control = () => {
        const p = game.player, index = Math.min(l.expectedIndex, l.pattern.length - 1);
        const target = l.tilePosition(...l.pattern[index]);
        const dx = target.x - p.group.position.x, dz = target.z - p.group.position.z;
        const distance = Math.hypot(dx, dz);
        keys(); input.moveAxisX = distance > 0.3 ? dx / distance : 0;
        input.moveAxisY = distance > 0.3 ? dz / distance : 0;
        if (p.grounded && distance < 3.4 && distance > 0.65) tap('Space');
      };
    } },
    dungeon_ambush: { seconds: 5, async prepare() {
      await load(1); const l = game.currentLevel;
      l._restoreArrivalPlayer(); l.deanBladeIntro = false; l.phase = 'chase'; l.puzzleIndex = 3;
      place(0, layout.spikeCorridorMaxZ - 6, 0, l.retractingSpikes.surface);
      l.ambush.start();
      control = t => {
        keys(); input.mouseButtons[0] = t > 1.2;
        const target = l.zombies.find(z => z.alive && z.group.visible && z.group.position.y >= 0);
        if (target) {
          const p = game.player.group.position, z = target.group.position;
          const difference = Math.atan2(p.x - z.x, p.z - z.z) - game.player.yaw;
          input.mouseDeltaX = -Math.atan2(Math.sin(difference), Math.cos(difference)) / game.player.mouseSensitivity;
        }
        if (Math.abs(t % 0.9) < 0.018) tap('Space');
      };
    } },
    dean_intro: { seconds: 3, async prepare() {
      await load(2, '/?level=3&boss=1');
      advance(4); place(0, 4);
      control = () => keys();
    } },
    dean_combat: { seconds: 8, async prepare() {
      await load(2, '/?level=3&boss=1');
      const l = game.currentLevel;
      // Use the existing boss preview, then advance its normal entrance off-camera.
      advance(4); place(0, 4);
      for (let i = 0; i < 900 && l.bossFight.phase !== 'combat'; i++) step(1 / 60, false);
      if (l.bossFight.phase !== 'combat') throw Error('Dean did not enter his normal combat state');
      game._syncEnemyLock(); game.player.toggleBossLock();
      control = t => {
        keys(...(t < 1.2 ? ['KeyD'] : t < 2.2 ? ['KeyA'] : ['KeyD']));
        input.mouseButtons[0] = t > 0.4 && t < 1.9;
        if (Math.abs(t - 0.75) < 0.018 || Math.abs(t - 2.5) < 0.018) tap('KeyQ');
      };
    } },
    desert_house: { seconds: 5.5, async prepare() {
      levelIndex = -1; await load(2, '/?level=3');
      const l = game.currentLevel; l._restoreArrivalPlayer(); place(0, 22);
      const house = l.houses[1];
      game.player.yaw = Math.atan2(-house.root.position.x, 22 - house.root.position.z);
      game.player.pitch = -0.03; game._equipWeapon('smg');
      control = t => {
        keys(); input.mouseButtons[0] = t > 0.3;
        const target = house.alive ? house.root : l.zombies.find(z => z.alive && z.group.visible)?.group;
        if (target) {
          const p = game.player.group.position, z = target.position;
          const difference = Math.atan2(p.x - z.x, p.z - z.z) - game.player.yaw;
          input.mouseDeltaX = -Math.atan2(Math.sin(difference), Math.cos(difference)) / game.player.mouseSensitivity;
        }
      };
    } },
  };
  window.__gameplayCapture = {
    names: Object.keys(takes),
    async prepare(name) {
      if (!takes[name]) throw Error(`Unknown take: ${name}`);
      await takes[name].prepare(); time = 0; frame = 0; events.length = 0;
      game.state = game.STATE.PLAYING; game._showOverlay(null);
      return { name, seconds: takes[name].seconds, level: game.currentLevel.title,
        start: game.player.group.position.toArray(), controller: control.toString(), method: 'real game loop with automated controller; checkpoint staging before take only' };
    },
    frame(dt = 1 / 30, capture = true) {
      control(time);
      const controls = { keys: { ...input.keys }, presses: [...input.pressedKeys], before: game.player.group.position.toArray() };
      step(dt, capture); time += dt; frame++;
      return { jpeg: capture ? game.renderer.domElement.toDataURL('image/jpeg', 0.95) : null,
        state: { time, frame, controls, alive: game.player.alive, health: game.player.health,
          ammo: game.player.ammo, score: game.player.score, position: game.player.group.position.toArray(),
          phase: game.currentLevel.phase || game.currentLevel.bossFight?.phase || 'forest',
          bossHealth: game.currentLevel.dean?.health ?? null,
          housesDestroyed: game.currentLevel.houses?.filter(h => !h.alive).length ?? 0,
          credits: game.currentLevel.creditsCollected, kills: game.currentLevel.zombies.filter(z => !z.alive).length,
          rolling: game.player.isDodging, grounded: game.player.grounded } };
    },
    events() { return events; },
  };
  return { names: window.__gameplayCapture.names };
})()
