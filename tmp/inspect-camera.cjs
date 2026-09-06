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

  // Simulate mouse look up
  await page.mouse.move(640, 360);
  await page.mouse.down();
  await page.mouse.move(640, 200, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(500);

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

    return {
      pitch: player.pitch,
      yaw: player.yaw,
      cameraLocalPos: player.camera.position.toArray(),
      cameraLocalRot: player.camera.rotation.toArray(),
      holderRot: player.cameraHolder.rotation.toArray(),
      playerRot: player.group.rotation.toArray(),
      isFirstPerson: player.isFirstPerson,
    };
  });

  console.log('Camera report:', JSON.stringify(report, null, 2));

  await browser.close();
})();
