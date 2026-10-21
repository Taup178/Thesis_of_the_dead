// Developer-only capture controls. Uses the supplied game scenes, rigs and animation clips.
// Inject into the running game through the capture driver; never imported by the game.
(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { SOPHOMORE_LAYOUT: layout } = await import('/src/levels/SophomoreLayout.js');
  const { updateSophomoreGauntlet } = await import('/src/levels/SophomoreGauntlet.js');
  const g = window.__game;
  // Stop the normal render loop so capture owns the camera and exact simulation time.
  g._animate = () => {};
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const style = document.createElement('style');
  style.textContent = 'body > :not(#game-container){display:none!important}#game-container{position:fixed;inset:0}';
  document.head.append(style);
  let scene = g.scene, motion = () => {};
  const camera = (position, focus, fov = 48) => {
    g.camera.position.fromArray(position); g.camera.fov = fov;
    g.camera.lookAt(...focus); g.camera.updateProjectionMatrix(); g.camera.updateMatrixWorld(true);
  };
  const render = () => { scene.updateMatrixWorld(true); g.renderer.render(scene, g.camera); };
  const actor = (position, animation = 'Idle', heading = 0) => {
    const p = g.player; p.group.visible = true; p.bodyMesh.visible = true;
    p.bodyMesh.position.set(0, 0, 0); p.bodyMesh.rotation.set(0, 0, 0);
    p.group.position.fromArray(position); p.group.rotation.set(0, heading, 0);
    p.scriptedMovement = false; p.isDodging = false; p.grounded = true;
    p._playAnimation(animation, 'Idle'); p.mixer?.update(0.12);
    p.weaponPresentation?.update(0);
  };
  const load = async index => {
    g.levelManager.progress.reach(2);
    await g.startGame(index); g.state = g.STATE.PAUSED; g._showOverlay(null);
    g.psychologicalVoices.cancel(); g.audio.stopAll();
    g.renderer.setPixelRatio(1); g.renderer.setSize(1920, 1080);
    g.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    g.renderer.shadowMap.needsUpdate = true;
    g.camera.aspect = 16 / 9; g.camera.updateProjectionMatrix();
    scene = g.scene;
  };
  const shots = {};
  shots.opening_wide = async () => {
    await load(0); const o = g.currentLevel.openingIntro;
    o.time = 12; o.update(0); scene = o.scene;
    motion = dt => { o.update(dt); };
  };
  shots.opening_close = async () => {
    const o = g.currentLevel.openingIntro; o.time = 28; o.update(0); scene = o.scene;
    motion = dt => { o.update(dt); };
  };
  shots.forest_credit = async () => {
    g.currentLevel.openingIntro?.dispose(); g.currentLevel.openingIntro = null; scene = g.scene;
    const l = g.currentLevel, p = l.credits[0].mesh.position;
    actor([p.x + 1.2, 0, p.z + 2.4], 'Idle_Gun');
    camera([p.x + 6.2, 2.6, p.z + 7.2], [p.x + 0.3, 1.2, p.z]);
    motion = dt => { l.atmosphere?.update(dt); l.creditEffects?.update(dt); g.player.mixer?.update(dt); };
    motion(0.016);
  };
  shots.forest_portal = async () => {
    const l = g.currentLevel; actor([3.5, 0, 35]);
    l._spawnOrbZombies();
    for (let i = 0; i < 55; i++) for (const z of l.zombies) if (z.portalExit) l._updatePortalExit(z, 1 / 60);
    camera([7, 2.4, 48.5], [0, 2.15, 41.5], 45);
    motion = dt => { l.atmosphere?.update(dt); for (const z of l.zombies) z.portalExit ? l._updatePortalExit(z, dt) : z.mixer?.update(dt); };
  };
  shots.forest_combat = async () => {
    const l = g.currentLevel; actor([0, 0, 28], 'Idle_Gun');
    l.zombies.forEach((z, i) => { z.portalExit = null; z.group.visible = true; z.group.scale.setScalar(1);
      z.group.position.set((i ? 1 : -1) * 1.4, 0, 22 - i); z._playAction('Walk'); });
    g.player.pitch = 0; g.player.yaw = 0; g.player._updateCamera();
    motion = dt => { l.atmosphere?.update(dt); g.player.mixer?.update(dt); for (const z of l.zombies) z.update(dt, g.player.group.position); };
  };
  shots.dungeon_saws = async () => {
    await load(1); const l = g.currentLevel;
    l._restoreArrivalPlayer?.(); l.arrivalPlayer = null; l.deanBladeIntro = false; l.phase = 'chase';
    actor([0, 0, layout.firstBladeZ + 3.8], 'Idle_Gun');
    l.bossMarker.position.set(-3.8, 0, layout.firstBladeZ - 6);
    camera([6, 2.8, layout.firstBladeZ + 6.5], [0, 1.2, layout.firstBladeZ - 2], 52);
    motion = dt => { updateSophomoreGauntlet(l, dt, g.player); l._updateLocalLighting(g.player, dt); g.player.mixer?.update(dt); l.dean.mixer?.update(dt); };
    motion(0.1);
  };
  shots.dungeon_bridge = async () => {
    const l = g.currentLevel; l.puzzleIndex = 1;
    actor([0, 0, layout.bridgeCheckpointZ], 'Idle');
    camera([6.2, 5.6, layout.bridgeFirstZ + 8], [0, -0.2, layout.bridgeFirstZ - 9], 55);
    motion = dt => { updateSophomoreGauntlet(l, dt, g.player); l._updateLocalLighting(g.player, dt); g.player.mixer?.update(dt); };
    motion(0.3);
  };
  shots.dungeon_memory = async () => {
    const l = g.currentLevel; l.puzzleIndex = 2; l._beginDemonstration();
    actor([l.tilePosition(...l.pattern[0]).x, 0, 1.6], 'Idle');
    camera([7.4, 7.2, 7.5], [0, 0.2, -14], 53);
    for (let i = 0; i < 50; i++) { l._updateDemonstration(1 / 60); l.dean.mixer?.update(1 / 60); }
    motion = dt => { if (l.phase === 'watch') l._updateDemonstration(dt); l.dean.mixer?.update(dt); l._updateLocalLighting(g.player, dt); };
  };
  shots.dungeon_spikes = async () => {
    const l = g.currentLevel; l.puzzleIndex = 3;
    actor([0, 0, layout.spikeCorridorMaxZ + 2], 'Idle_Gun');
    camera([6, 2.7, layout.spikeCorridorMaxZ + 5], [0, 0.2, layout.spikeCorridorMaxZ - 8], 52);
    motion = dt => { l.retractingSpikes?.update(dt); l._updateLocalLighting(g.player, dt); g.player.mixer?.update(dt); };
    motion(0.2);
  };
  shots.desert_wide = async () => {
    await load(2); const l = g.currentLevel;
    l._restoreArrivalPlayer();
    actor([0, 0, 5], 'Idle_Gun');
    camera([25, 8.5, 28], [0, 1, -7], 50);
    motion = dt => { g.player.mixer?.update(dt); l.dean.mixer?.update(dt); l.degreeGrip?.(); };
  };
  shots.dean_confrontation = async () => {
    const l = g.currentLevel; actor([0, 0, 4], 'Idle_Gun');
    l.bossMarker.position.set(0, 0, -4); l.bossMarker.lookAt(0, 0, 4);
    l.dean.mixer?.update(0.1); l.degreeGrip?.();
    camera([6.5, 2.5, 9], [0, 1.3, 0], 52);
    motion = dt => { g.player.mixer?.update(dt); l.dean.mixer?.update(dt); l.degreeGrip?.(); };
  };
  shots.degree_detail = async () => {
    const l = g.currentLevel; l.degreeGrip?.();
    const target = l.degreeScroll.getWorldPosition(V());
    camera(target.clone().add(V(1, 0.4, 1.5)).toArray(), target.toArray(), 43);
    motion = dt => { l.dean.mixer?.update(dt); l.degreeGrip?.(); };
  };
  window.__trailerCapture = {
    names: Object.keys(shots),
    async prepare(name) { if (!shots[name]) throw Error(`Unknown shot ${name}`); await shots[name](); render();
      return { name, level: g.currentLevel.title, camera: g.camera.position.toArray(), source: 'actual current game render' }; },
    frame(dt = 1 / 60) { motion(dt); render(); },
    still(dt = 0, type = 'image/png') { motion(dt); render(); return g.renderer.domElement.toDataURL(type, 0.94); },
    async record(seconds = 3) {
      const canvas = g.renderer.domElement, stream = canvas.captureStream(30);
      const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(t => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 14000000 });
      const chunks = []; recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const finished = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.start(); const end = performance.now() + seconds * 1000;
      let previous = performance.now();
      while (performance.now() < end) { await new Promise(requestAnimationFrame); const now = performance.now();
        motion(Math.min(0.1, (now - previous) / 1000)); previous = now; render(); }
      recorder.stop(); await finished; stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type });
      const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob);
      anchor.download = 'capture.webm'; anchor.click();
      return { bytes: blob.size, requestedSeconds: seconds, requestedFps: 30, mime: type };
    },
  };
  return { ready: true, shots: window.__trailerCapture.names };
})()
