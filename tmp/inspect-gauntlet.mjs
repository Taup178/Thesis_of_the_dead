import { browser } from './gauntlet-browser.mjs';
const b = await browser();
try {
  const summary = await b.evaluate(`(async()=>{
    const {Player}=await import('/src/player/Player.js'); const g=window.__game;
    g.state='inspect';g._showOverlay(null);g.hudEl.classList.remove('hidden');
    const l=await g.levelManager.loadLevel(1,undefined,{seed:1234,puzzleIndex:0});
    const p=new Player(g.scene,g.input,g.camera);await p.loadCharacter();g.player=p;g.currentLevel=l;l.preparePlayer(p);
    for(let i=0;i<900&&l.phase!=='chase';i++)l.update(1/60,p);
    p._updateCamera();g._updateHUD();
    return {phase:l.phase,spawn:p.group.position.toArray(),blades:l.blades.length,bridges:l.bridgePlatforms.length,runes:l.runePads.length};
  })()`);
  console.log(summary);
  await b.screenshot('tmp/gauntlet-blades.png');
  console.log(await b.evaluate(`(()=>{const g=__game,l=g.currentLevel,p=g.player;
    p.group.position.set(0,0,55.5);p.grounded=true;p.platformSupport=l.bladeSurface;
    l.update(0,p);for(let i=0;i<80;i++)l.update(1/60,p);
    p._updateCamera();g._updateHUD();return {phase:l.phase,dean:l.bossMarker.position.toArray(),canMove:l.getPlatforming().canMove};})()`));
  await b.screenshot('tmp/gauntlet-bridge.png');
  console.log(await b.evaluate(`(()=>{const g=__game,l=g.currentLevel,p=g.player;
    l.puzzleIndex=2;p.group.position.set(0,0,32.5);p.grounded=true;p.platformSupport=l.runeSurface;
    p._updateCamera();g._updateHUD();return {phase:l.phase,runes:l.runePads.length};})()`));
  await b.screenshot('tmp/gauntlet-runes.png');
  const errors=b.errors.filter(e=>!e.entry?.url?.endsWith('/favicon.ico'));
  console.log('errors',errors.length);
  if(errors.length) { console.log(errors); process.exitCode=1; }
} finally { b.close(); }
