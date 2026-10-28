import * as THREE from 'three';
import { Player } from './Player.js';
import { DegreeVictory } from './DegreeVictory.js';
import { OpeningCutscene } from './OpeningCutscene.js';
import { EndingCutscene } from '../levels/EndingCutscene.js';
import { loadEndingTextures } from '../levels/EndingAssets.js';
import { createDegreeScroll } from '../props/DegreeScroll.js';
import { applyQuality } from '../core/Quality.js';

// Development-only review fixture. Uses the production actor, grip, effects,
// camera path and graphics presets; no debug seeking enters the game itself.
if (!import.meta.env.DEV) throw new Error('Cinematic review is development-only.');
const choice = new URLSearchParams(location.search).get('ending') === 'red' ? 'red' : 'blue';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .1, 100);
const player = new Player(scene, { flushMouseDelta() {}, isDown: () => false }, camera);
const [assets, textures] = await Promise.all([OpeningCutscene.loadAssets(), loadEndingTextures(), player.loadCharacter()]);
const scroll = createDegreeScroll(); scene.add(scroll); scroll.position.set(-3, .6, -3);
const boss = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()); boss.position.set(-4, .5, -4); scene.add(boss);
const victory = new DegreeVictory(player, { group: boss }, { scroll, pose: [], closedFingers: new Map() });
victory.grip.attach(scroll);
victory.transfer = { position: scroll.position.clone(), rotation: scroll.quaternion.clone(), scale: scroll.scale.clone() };
victory.keepHolding();
// The portal transition removes the imagined degree before the ending room.
scroll.visible = false;
const ending = new EndingCutscene(player, choice, assets, textures);
let playing = false, previous = performance.now(), samples = [], frameTimes = [], lastReport = 0;
const authoredEye = new THREE.Vector3();
const timeInput = document.getElementById('time'), play = document.getElementById('play'), quality = document.getElementById('quality');
function seek(time) {
  playing = false; play.textContent = 'Play';
  ending._clearReliefPose(); player.mixer.stopAllAction(); player.currentActionName = null; player.currentAction = null;
  ending.actionName = null; ending.time = 0; ending.done = false; player.group.visible = true;
  for (const action of Object.values(player.actions)) { action.reset(); action.setLoop(THREE.LoopRepeat, Infinity); action.clampWhenFinished = false; }
  for (let t = 0; t < time - .000001; t += 1 / 60) ending.update(Math.min(1 / 60, time - t));
  ending.update(0); authoredEye.copy(camera.position); samples = []; frameTimes = []; render();
}
function render() {
  // Reapply the authored camera before the optional diagnostic orbit.
  camera.position.copy(authoredEye);
  const angle = Number(document.getElementById('angle').value);
  camera.position.sub(ending.focus).applyAxisAngle(THREE.Object3D.DEFAULT_UP, angle).add(ending.focus);
  camera.lookAt(ending.focus); camera.updateMatrixWorld(true);
  ending.render(renderer, quality.value);
  document.getElementById('fade').style.opacity = ending.fade;
  if (document.activeElement !== timeInput) timeInput.value = ending.time.toFixed(1);
}
play.onclick = () => { if (ending.done) seek(0); playing = !playing; play.textContent = playing ? 'Pause' : 'Play'; samples = []; };
document.getElementById('seek').onclick = () => seek(Math.min(choice === 'red' ? 23 : 19, Math.max(0, Number(timeInput.value))));
document.querySelectorAll('[data-time]').forEach(button => { button.onclick = () => seek(Number(button.dataset.time)); });
quality.onchange = () => { applyQuality(renderer, ending.scene, quality.value); samples = []; frameTimes = []; render(); };
document.getElementById('angle').onchange = () => { samples = []; render(); };
applyQuality(renderer, ending.scene, quality.value); seek(2);
function frame(now) {
  const elapsed = now - previous, dt = Math.min(elapsed / 1000, .15); previous = now;
  if (!ending.done) { ending.update(playing ? dt : 0); authoredEye.copy(camera.position); }
  if (ending.done) { playing = false; play.textContent = 'Play'; }
  frameTimes.push(elapsed); if (frameTimes.length > 180) frameTimes.shift();
  renderer.info.autoReset = false; renderer.info.reset();
  const start = performance.now(); render(); samples.push(performance.now() - start);
  if (samples.length > 180) samples.shift();
  if (now - lastReport > 700) {
    const sorted = [...samples].sort((a, b) => a - b);
    const frames = [...frameTimes].sort((a, b) => a - b);
    document.getElementById('status').textContent = `${choice} · ${ending.time.toFixed(1)}s · ${quality.value} · frame p50 ${(frames[Math.floor(frames.length*.5)] ?? 0).toFixed(1)}ms · CPU render p95 ${(sorted[Math.floor(sorted.length*.95)] ?? 0).toFixed(1)}ms · ${renderer.info.render.calls} draws`;
    lastReport = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); applyQuality(renderer, ending.scene, quality.value); });
