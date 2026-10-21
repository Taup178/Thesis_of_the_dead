import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const { chromium } = await import(pathToFileURL(process.env.TRAILER_PLAYWRIGHT || '/usr/local/lib/node_modules/playwright/index.mjs'));
const output = resolve(process.env.TRAILER_OUTPUT || 'production/trailer/gameplay');
const fps = Number(process.env.TRAILER_FPS || 30);
const validateOnly = process.env.TRAILER_VALIDATE_ONLY === '1';
if (![24, 30, 60].includes(fps)) throw Error('TRAILER_FPS must be 24, 30 or 60');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const manifest = { startedAt: new Date().toISOString(), width: 1920, height: 1080, fps,
  audio: 'silent capture masters; original music, voices and synchronized effects to be mixed separately', takes: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => { manifest.errors.push(error.message); console.log('PAGE ERROR', error.message); });
  await page.addInitScript(() => localStorage.setItem('thesis-of-the-dead:quality', 'medium'));
  await page.goto(process.env.TRAILER_BASE_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(await readFile('scripts/gameplay-takes.js', 'utf8'));
  const allNames = await page.evaluate(() => window.__gameplayCapture.names);
  const names = process.env.TRAILER_TAKES?.split(',') || allNames;
  for (const name of names) {
    console.log(JSON.stringify({ preparing: name, at: new Date().toISOString() }));
    const info = await page.evaluate(name => window.__gameplayCapture.prepare(name), name);
    const seconds = Number(process.env.TRAILER_SECONDS || info.seconds);
    const frames = join(output, `${name}-frames`); await mkdir(frames, { recursive: true });
    const states = [];
    for (let frame = 0; frame < Math.round(seconds * fps); frame++) {
      const result = await page.evaluate(({ dt, capture }) => window.__gameplayCapture.frame(dt, capture),
        { dt: 1 / fps, capture: !validateOnly });
      if (!validateOnly) await writeFile(join(frames, `${String(frame).padStart(5, '0')}.jpg`), Buffer.from(result.jpeg.split(',')[1], 'base64'));
      states.push(result.state);
      if (frame % fps === 0) console.log(JSON.stringify({ name, progress: frame, frames: seconds * fps, state: result.state }));
      if (!result.state.alive) { info.endedByDeath = true; break; }
    }
    if (!validateOnly) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps),
      '-i', join(frames, '%05d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', join(output, `${name}.mp4`)]);
    info.events = await page.evaluate(() => window.__gameplayCapture.events());
    info.frames = states.length; info.duration = states.length / fps;
    info.firstState = states[0]; info.lastState = states.at(-1);
    await writeFile(join(output, `${name}-telemetry.json`), JSON.stringify({ ...info, states }, null, 2));
    manifest.takes.push(info);
    await writeFile(join(output, 'gameplay-manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ completed: name, frames: states.length, duration: info.duration }));
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ output, takes: manifest.takes.length, errors: manifest.errors }));
