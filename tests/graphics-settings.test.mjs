import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { graphicsPreset, normalizeGraphics, loadGraphics, saveGraphics, isCustomGraphics } from '../src/core/GraphicsSettings.js';
import { applyQuality, qualityConfig } from '../src/core/Quality.js';
import { DreamMotionBlur } from '../src/shaders/DreamMotionBlur.js';
import { Game } from '../src/core/Game.js';

function renderer() {
  let ratio = 1;
  return { shadowMap: { enabled: true, type: THREE.PCFShadowMap, autoUpdate: true },
    capabilities: { getMaxAnisotropy: () => 8 },
    setPixelRatio(value) { ratio = value; }, getPixelRatio: () => ratio,
    setSize() {}, getSize: target => target.set(800, 600),
    getDrawingBufferSize: target => target.set(800 * ratio, 600 * ratio), render() {} };
}

test('presets change real resolution, shadows, texture filtering and restore them after Low', () => {
  const previous = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, innerWidth: 800, innerHeight: 600 };
  const r = renderer(), scene = new THREE.Scene(), light = new THREE.DirectionalLight();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const geometry = new THREE.BoxGeometry(); scene.add(light, new THREE.Mesh(geometry, material));
  try {
    applyQuality(r, scene, 'ultra');
    assert.equal(r.getPixelRatio(), 1.25);
    assert.equal(light.shadow.mapSize.x, 4096);
    assert.equal(texture.anisotropy, 8, 'filtering is limited to the actual GPU capability');
    let disposed = false; light.shadow.map = { dispose() { disposed = true; } };
    applyQuality(r, scene, 'low');
    assert.equal(r.shadowMap.enabled, false); assert.equal(disposed, true);
    assert.equal(light.shadow.map, null); assert.equal(r.getPixelRatio(), .75);
    applyQuality(r, scene, 'high', { shadows: 'low', brightness: 1.2, renderScale: .5 });
    assert.equal(r.shadowMap.enabled, true); assert.equal(light.shadow.mapSize.x, 512);
    assert.equal(r.toneMappingExposure, 1.2); assert.equal(r.getPixelRatio(), .5);
    assert.equal(qualityConfig('high').ambientOcclusion, true);
  } finally { globalThis.window = previous; geometry.dispose(); material.dispose(); texture.dispose(); }
});

test('graphics settings migrate, persist custom choices and reject corrupt values', () => {
  const previous = globalThis.localStorage, entries = new Map([['thesis-of-the-dead:quality', 'high']]);
  globalThis.localStorage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  try {
    assert.equal(loadGraphics().preset, 'high');
    const settings = { ...graphicsPreset('high'), shadows: 'off', renderScale: .8, bloom: false };
    saveGraphics(settings); assert.deepEqual(loadGraphics(), settings);
    assert.equal(isCustomGraphics(loadGraphics()), true);
    const invalid = normalizeGraphics({ preset: 'invalid', shadows: 'ray-traced', renderScale: Infinity, brightness: -5, bloom: 'yes' });
    assert.equal(invalid.preset, 'medium'); assert.equal(invalid.shadows, 'medium');
    assert.equal(invalid.renderScale, 1); assert.equal(invalid.brightness, .7); assert.equal(invalid.bloom, true);
    entries.set('thesis-of-the-dead:graphics', '{bad'); assert.equal(loadGraphics().preset, 'medium');
  } finally { globalThis.localStorage = previous; }
});

test('post effects render with motion blur off, resize correctly and bypass cinematics', () => {
  const previous = globalThis.window;
  globalThis.window = { innerWidth: 800, innerHeight: 600 };
  const r = renderer(), scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const effects = new DreamMotionBlur(r, scene, camera);
  try {
    effects.configure(graphicsPreset('high'));
    assert.equal(effects.ao.width, 400); assert.equal(effects.ao.height, 300);
    assert.ok(effects.bloom.enabled && effects.fxaa.enabled && effects.grading.enabled);
    let composited = 0, direct = 0;
    effects.composer.render = () => { composited++; }; r.render = () => { direct++; };
    effects.render(1 / 60, 0);
    assert.equal(composited, 1); assert.equal(effects.blur.enabled, false);
    effects.render(1 / 60, 0, scene, true); assert.equal(direct, 1);
    r.setPixelRatio(2); effects.setSize(800, 600);
    assert.equal(effects.ao.width, 800); assert.equal(effects.fxaa.uniforms.resolution.value.x, 1 / 1600);
    let aoDisposed = false; effects.ao.normalRenderTarget.addEventListener('dispose', () => { aoDisposed = true; });
    effects.configure(graphicsPreset('low'));
    assert.equal(aoDisposed, true); assert.equal(effects.ao, null); assert.equal(effects.bloom, null);
    effects.render(1 / 60, 0); assert.equal(direct, 2);
    effects.configure(graphicsPreset('high'));
    assert.ok(effects.composer.passes.indexOf(effects.ao) < effects.composer.passes.indexOf(effects.bloom));
  } finally { effects.dispose(); globalThis.window = previous; }
});

test('graphics controls apply live, show Custom, restore a preset and save the result', () => {
  const previous = { document: globalThis.document, window: globalThis.window, storage: globalThis.localStorage };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { listeners: {}, querySelectorAll: () => [], addEventListener(type, fn) { this.listeners[type] = fn; } });
    return elements.get(id);
  };
  const control = { dataset: { graphics: 'bloom' }, type: 'checkbox', checked: true,
    listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; } };
  const entries = new Map();
  globalThis.document = { querySelectorAll: () => [control], getElementById: element };
  globalThis.window = { devicePixelRatio: 1, innerWidth: 800, innerHeight: 600 };
  globalThis.localStorage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  const game = Object.assign(Object.create(Game.prototype), { graphics: graphicsPreset(), quality: 'medium',
    scene: new THREE.Scene(), renderer: renderer(), motionBlur: { configure() {} } });
  try {
    game._bindGraphicsSettings(); control.checked = false; control.listeners.change();
    assert.equal(game.graphics.bloom, false); assert.equal(element('quality-select').value, 'custom');
    assert.equal(loadGraphics().bloom, false);
    game._setQuality('high'); assert.equal(control.checked, true); assert.equal(element('quality-select').value, 'high');
    element('btn-graphics-reset').listeners.click();
    assert.deepEqual(game.graphics, graphicsPreset());
    const select = { tagName: 'SELECT', selectedIndex: 4, options: [{ disabled: true }, {}, {}, {}, {}], dispatchEvent() {} };
    game._adjustMenuOption(select, 1); assert.equal(select.selectedIndex, 1, 'gamepad skips the disabled Custom label');
  } finally { globalThis.document = previous.document; globalThis.window = previous.window; globalThis.localStorage = previous.storage; }
});
