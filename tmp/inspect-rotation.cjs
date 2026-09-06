const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  page.on('console', (msg) => console.log(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));

  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });

  const startBtn = await page.$('#btn-start');
  if (startBtn) await startBtn.click();

  await page.waitForFunction(() => {
    const hud = document.getElementById('hud');
    return hud && !hud.classList.contains('hidden');
  }, { timeout: 30000 });

  await page.waitForTimeout(2000);

  const report = await page.evaluate(() => {
    const findPlayer = () => {
      if (window.game && window.game.player) return window.game.player;
      for (const key of Object.keys(window)) {
        const val = window[key];
        if (val && val.player && val.player.group) return val.player;
      }
      return null;
    };
    const player = findPlayer();
    if (!player) return { error: 'player not found' };

    const character = player.characterModel;
    return {
      characterRotationY: character.rotation.y,
      cameraPosition: player.camera.position.toArray(),
      playerPosition: player.group.position.toArray(),
    };
  });

  console.log('Rotation report:', JSON.stringify(report, null, 2));

  await browser.close();
})();
