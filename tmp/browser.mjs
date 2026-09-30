import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function browser() {
  const process = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9224',
    `--user-data-dir=${path.join(os.tmpdir(), 'thesis-check-' + Date.now())}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let targets;
  for (let n = 0; n < 100; n++) {
    try { targets = await (await fetch('http://127.0.0.1:9224/json')).json(); if (targets.length) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const url = new URL(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  const socket = createConnection(Number(url.port), url.hostname);
  let id = 0, buffer = Buffer.alloc(0), upgraded = false;
  const pending = new Map(), errors = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const current = ++id, timeout = setTimeout(() => { pending.delete(current); reject(new Error(method + ' timed out')); }, 30000);
    pending.set(current, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    const payload = Buffer.from(JSON.stringify({ id: current, method, params })), mask = randomBytes(4);
    const header = Buffer.alloc(payload.length < 126 ? 2 : 4); header[0] = 0x81;
    if (payload.length < 126) header[1] = 0x80 | payload.length;
    else { header[1] = 0xfe; header.writeUInt16BE(payload.length, 2); }
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    socket.write(Buffer.concat([header, mask, payload]));
  });
  await new Promise(resolve => {
    socket.on('connect', () => socket.write(`GET ${url.pathname} HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) { const end = buffer.indexOf('\r\n\r\n'); if (end < 0) return; buffer = buffer.subarray(end + 4); upgraded = true; resolve(); }
      while (buffer.length >= 2) {
        let size = buffer[1] & 127, offset = 2;
        if (size === 126) { if (buffer.length < 4) return; size = buffer.readUInt16BE(2); offset = 4; }
        if (size === 127) { if (buffer.length < 10) return; size = Number(buffer.readBigUInt64BE(2)); offset = 10; }
        if (buffer.length < offset + size) return;
        const payload = buffer.subarray(offset, offset + size); buffer = buffer.subarray(offset + size);
        let data; try { data = JSON.parse(payload.toString()); } catch { continue; }
        if (data.id) { const task = pending.get(data.id); pending.delete(data.id); data.error ? task?.reject(data.error) : task?.resolve(data.result); }
        else if (data.method === 'Runtime.exceptionThrown' || data.method === 'Log.entryAdded' && data.params.entry.level === 'error') errors.push(data.params);
        else if (data.method === 'Runtime.consoleAPICalled' && data.params.type === 'error') errors.push(data.params);
      }
    });
  });
  socket.on('close', () => { for (const task of pending.values()) task.reject(new Error('Browser closed')); pending.clear(); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }); await send('Page.bringToFront');
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  await send('Page.navigate', { url: 'http://127.0.0.1:3000/' });
  for (let n = 0; n < 100; n++) { if (await evaluate('!!window.__game')) break; await new Promise(r => setTimeout(r, 100)); }
  return { send, evaluate, errors, screenshot: async file => {
    const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(file, Buffer.from(result.data, 'base64'));
  }, close: () => { send('Browser.close').catch(() => {}); socket.unref(); process.unref(); } };
}
