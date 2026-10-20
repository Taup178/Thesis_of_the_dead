// Uses an existing local Playwright installation; never installs packages.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const links = join(process.env.LOCALAPPDATA, 'ms-playwright', '.links');
const location = readFileSync(join(links, readdirSync(links)[0]), 'utf8').trim();
const { chromium } = await import(pathToFileURL(join(location, 'index.mjs')));
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  if (process.argv.includes('--opening-audio')) {
    await page.goto('http://127.0.0.1:5175/voice-audition.html');
    const result = await page.evaluate(async () => {
      const { AudioManager } = await import('/src/core/AudioManager.js');
      const { loadLevel1VoiceAssets } = await import('/src/audio/Level1Voices.js');
      const { OPENING_VOICE_CUES } = await import('/src/audio/openingVoiceCatalog.js');
      const assets = await loadLevel1VoiceAssets(), audio = new AudioManager(), clips = [];
      audio.ensureContext(); await audio.context.resume();
      for (const cue of OPENING_VOICE_CUES) {
        const asset = assets[cue.clip], buffer = await audio.internalVoices.load(asset);
        if (!buffer || buffer.numberOfChannels !== 2 || !asset.effectsBaked) throw Error(`Invalid clip ${cue.clip}`);
        const handle = await audio.internalVoices.play(asset, { identity: cue.identity });
        if (!handle) throw Error(`Could not start ${cue.clip}`);
        clips.push({ id: cue.clip, duration: buffer.duration, channels: buffer.numberOfChannels });
        handle.stop();
      }
      audio.dispose(); return clips;
    });
    console.log(JSON.stringify({ decodedAndStarted: result }, null, 2));
    await browser.close(); process.exit(0);
  }
  if (process.argv.includes('--game')) {
    await page.goto('http://127.0.0.1:5175/');
    await page.evaluate(() => window.__game.startGame());
    await page.waitForFunction(() => window.__game.currentLevel?.openingIntro, { timeout: 120000 });
    await page.evaluate(() => {
      const game = window.__game;
      game.state = game.STATE.PAUSED;
      game._showOverlay(null);
      const opening = game.currentLevel.openingIntro;
      opening.time = 28; opening.update(0);
      game.renderer.render(opening.scene, game.camera);
      document.getElementById('opening-presentation').classList.remove('active');
    });
    await page.screenshot({ path: 'tmp/opening-game.png' });
    console.log('Actual game opening captured');
    await browser.close(); process.exit(0);
  }
  await page.goto('http://127.0.0.1:5175/opening-preview.html');
  await page.waitForFunction(() => window.__opening, { timeout: 60000 });
  for (const [time, name] of [[1.8, 'headphones'], [5.4, 'card'], [12, 'wide'], [28, 'close']]) {
    await page.evaluate(time => window.seekOpening(time), time);
    await page.screenshot({ path: `tmp/opening-${name}.png` });
  }
  console.log(JSON.stringify(await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const opening = window.__opening;
    const sample = {};
    for (const name of ['Hips', 'UpperLegL', 'LowerLegL', 'FootL', 'LowerArmL', 'Middle1L']) {
      sample[name] = opening.actor.getObjectByName(name).getWorldPosition(new THREE.Vector3()).toArray();
    }
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, .28), new THREE.Vector3(0, -1, 0));
    const seat = ray.intersectObject(opening.couch, true).map(hit => hit.point.y);
    const vertices = [], contact = [], hip = opening.actor.getObjectByName('Hips').getWorldPosition(new THREE.Vector3());
    opening.actor.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      mesh.skeleton.update();
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        const v = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
        if (Math.abs(v.x) < .24 && v.z > hip.z - .2 && v.z < hip.z + .1 && v.y > .1 && v.y < hip.y + .2) {
          vertices.push(v.y);
          const ids=mesh.geometry.attributes.skinIndex, weights=mesh.geometry.attributes.skinWeight;
          contact.push({point:v.toArray(), bones:[0,1,2,3].map(c=>[mesh.skeleton.bones[ids.getComponent(i,c)].name,weights.getComponent(i,c)])});
        }
      }
    });
    return { lights: opening.scene.children.filter(n => n.isLight).length, sample, seat,
      seatedSurface: vertices.length ? Math.min(...vertices) : null,
      contact: contact.sort((a,b)=>a.point[1]-b.point[1]).slice(0,3),
      bedBounds: new THREE.Box3().setFromObject(opening.bed).getSize(new THREE.Vector3()).toArray(),
      bedParts: ['Bed', 'Mini_Table'].map(name => {
        const box = new THREE.Box3().setFromObject(opening.bed.getObjectByName(name), true);
        return { name, min: box.min.toArray(), max: box.max.toArray() };
      }) };
  }), null, 2));
  await page.evaluate(() => {
    const camera = window.__opening.player.camera;
    camera.position.set(-3, 1.15, 1.2); camera.lookAt(0, .65, .25);
  });
  await page.screenshot({ path: 'tmp/opening-side.png' });
} finally { await browser.close(); }
