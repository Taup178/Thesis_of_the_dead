/** Show one settings category while preserving each control's current value. */
export function bindSettingsTabs(root, onSelect = () => {}) {
  const tabs = [...root.querySelectorAll('[data-settings-tab]')];
  const panels = [...root.querySelectorAll('[data-settings-panel]')];
  const select = (name, focus = false) => {
    const active = tabs.find(tab => tab.dataset.settingsTab === name);
    if (!active) return;
    for (const tab of tabs) {
      const selected = tab === active;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.settingsPanel !== name;
    const scroller = root.querySelector('.settings-panels');
    if (scroller) scroller.scrollTop = 0;
    if (focus) active.focus({ preventScroll: true });
    onSelect(active, tabs.indexOf(active));
  };
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab.dataset.settingsTab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); select(tabs[next].dataset.settingsTab, true);
    });
  }
  return select;
}
