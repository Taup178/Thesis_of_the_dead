import * as THREE from 'three';
import { Player } from './Player.js';
import { OpeningCutscene } from './OpeningCutscene.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
const player = new Player(new THREE.Scene(), { flushMouseDelta() {}, isDown: () => false }, camera);
const [assets] = await Promise.all([OpeningCutscene.loadAssets(), player.loadCharacter()]);
const opening = new OpeningCutscene(player, assets);
window.__opening = opening; window.__renderer = renderer;
let playing = true, previous = performance.now();
const seek = document.getElementById('seek');
document.getElementById('play').onclick = () => { playing = !playing; document.getElementById('play').textContent = playing ? 'Pause' : 'Play'; };
window.seekOpening = time => { playing = false; opening.time = time; opening.done = false; opening.endingAt = null; opening.update(0); render(); };
seek.oninput = () => window.seekOpening(Number(seek.value));
function render() {
  renderer.render(opening.scene, camera);
  document.getElementById('fade').style.opacity = opening.fade;
  document.getElementById('card').textContent = opening.cardText;
  document.getElementById('card').style.opacity = opening.cardOpacity;
  seek.value = opening.time; document.getElementById('time').textContent = opening.time.toFixed(1);
}
function frame(now) {
  const dt = Math.min((now - previous) / 1000, 0.1); previous = now;
  if (playing && !opening.done) opening.update(dt);
  render(); requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
