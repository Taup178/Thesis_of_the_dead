import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const playwright = process.env.TRAILER_PLAYWRIGHT || '/usr/local/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwright));
const output = resolve(process.env.TRAILER_OUTPUT || 'production/trailer/references');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required',
  '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const manifest = { capturedAt: new Date().toISOString(), resolution: '1920x1080', shots: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, acceptDownloads: true });
  page.on('pageerror', error => { manifest.errors.push(error.message); console.log('PAGE ERROR', error.message); });
  await page.addInitScript(() => localStorage.setItem('thesis-of-the-dead:quality', 'medium'));
  await page.goto(process.env.TRAILER_BASE_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(await readFile('scripts/trailer-scenes.js', 'utf8'));
  const allNames = await page.evaluate(() => window.__trailerCapture.names);
  const names = process.env.TRAILER_SHOTS?.split(',') || allNames;
  for (const name of names) {
    const info = await page.evaluate(name => window.__trailerCapture.prepare(name), name);
    const png = await page.evaluate(() => window.__trailerCapture.still());
    await writeFile(join(output, `${name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    if (process.env.TRAILER_STILLS_ONLY !== '1' && ['opening_close', 'forest_portal', 'dungeon_saws', 'dungeon_memory', 'dean_confrontation'].includes(name)) {
      const frames = join(output, `${name}-frames`); await mkdir(frames, { recursive: true });
      // Short motion references are offline 12 FPS; final production can use the same
      // deterministic renderer at 60 FPS, independent of the machine's live frame rate.
      for (let frame = 0; frame < 24; frame++) {
        const jpeg = await page.evaluate(() => window.__trailerCapture.still(1 / 12, 'image/jpeg'));
        await writeFile(join(frames, `${String(frame).padStart(4, '0')}.jpg`), Buffer.from(jpeg.split(',')[1], 'base64'));
      }
      execFileSync(process.env.TRAILER_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
        '-framerate', '12', '-i', join(frames, '%04d.jpg'), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', join(output, `${name}.mp4`)]);
      info.recording = { seconds: 2, fps: 12, method: 'deterministic in-engine motion reference; not a performance benchmark' };
    }
    manifest.shots.push(info); console.log(JSON.stringify(info));
    await writeFile(join(output, 'capture-manifest.json'), JSON.stringify(manifest, null, 2));
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ output, screenshots: manifest.shots.length, errors: manifest.errors }));
