import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Use a separate local game profile so the main browser's sound settings stay intact.
const url = new URL(process.argv[2] || 'http://127.0.0.1:3000/?level=2');
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('The autoplay game launcher only opens local development URLs.');
}
const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
const browser = roots.flatMap(root => [
  join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
]).find(existsSync);
if (!browser) throw new Error('Chrome or Edge is required for the Windows autoplay game window.');

const child = spawn(browser, [
  `--user-data-dir=${join(tmpdir(), 'thesis-of-the-dead-autoplay')}`,
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--no-default-browser-check',
  '--new-window',
  url.href,
], { detached: true, stdio: 'ignore' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.unref();
console.log(`Opening the local game with menu music autoplay: ${url.href}`);
