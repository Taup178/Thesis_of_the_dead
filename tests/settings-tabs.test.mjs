import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSettingsTabs } from '../src/core/SettingsTabs.js';

test('settings categories show only their own controls and support keyboard navigation', () => {
  const names = ['volume', 'controls', 'graphics'];
  const panels = names.map(name => ({ dataset: { settingsPanel: name }, hidden: name !== 'volume' }));
  const tabs = names.map(name => ({ dataset: { settingsTab: name }, attributes: {}, listeners: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    focus() { this.focused = true; } }));
  const scroller = { scrollTop: 250 }, selected = [];
  const select = bindSettingsTabs({
    querySelectorAll: selector => selector === '[data-settings-tab]' ? tabs : panels,
    querySelector: () => scroller,
  }, tab => selected.push(tab.dataset.settingsTab));
  tabs[2].listeners.click();
  assert.deepEqual(panels.map(panel => panel.hidden), [true, true, false]);
  assert.equal(tabs[2].attributes['aria-selected'], 'true');
  assert.deepEqual(tabs.map(tab => tab.tabIndex), [-1, -1, 0]);
  assert.equal(scroller.scrollTop, 0);
  let prevented = false;
  tabs[2].listeners.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(tabs[0].focused, true);
  assert.deepEqual(panels.map(panel => panel.hidden), [false, true, true]);
  tabs[0].listeners.keydown({ key: 'End', preventDefault() {} });
  assert.deepEqual(panels.map(panel => panel.hidden), [true, true, false]);
  select('controls'); assert.deepEqual(panels.map(panel => panel.hidden), [true, false, true]);
  assert.deepEqual(selected, ['graphics', 'volume', 'graphics', 'controls']);
});
