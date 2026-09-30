import { browser } from './browser.mjs';
const b=await browser();
try {
  console.log(await b.evaluate(`(async()=>{
    const {Player}=await import('/src/player/Player.js'); const g=__game;
    g.state='inspect';g._showOverlay(null);g.hudEl.classList.remove('hidden');
    g.currentLevel=await g.levelManager.loadLevel(1,undefined,{seed:1234});
    g.player=new Player(g.scene,g.input,g.camera);await g.player.loadCharacter();g.currentLevel.preparePlayer(g.player);
    const p=g.player,l=g.currentLevel;p.group.position.y=0;p.grounded=true;p.platformSupport=l.startSurface;
    p.mixer.update(0.1);p._updateCamera();p.weaponPresentation.update(0);l._beginDemonstration();g._updateHUD();
    return {spikes:l.spikes.count,tip:l.spikeTipY};
  })()`));
  await b.screenshot('tmp/sophomore-dark.png');
  console.log(await b.evaluate(`(()=>{
    const g=__game,l=g.currentLevel,p=g.player;const tile=l.tiles[1-l.pattern[0][0]][0];
    p.group.position.copy(l.tilePosition(tile.i,tile.j));p.platformSupport=tile.surface;p.grounded=true;
    l.phase='follow';l.expectedIndex=0;l.update(1/60,p);
    for(let n=0;n<35;n++){p.update(1/60,[],null,l.getPlatforming());l.update(1/60,p);}
    g._updateHUD();return {phase:l.phase,fragments:tile.fragments.length,alive:p.alive,y:p.group.position.y};
  })()`));
  await b.screenshot('tmp/sophomore-spike-fall.png');
  console.log(await b.evaluate(`(()=>{
    const g=__game,l=g.currentLevel,p=g.player;
    for(let n=0;n<90&&p.alive;n++){p.update(1/60,[],null,l.getPlatforming());l.update(1/60,p);}
    if(p.alive||p.group.position.y!==l.spikeTipY)throw Error('Spike contact failed');
    return {alive:p.alive,impactY:p.group.position.y};
  })()`));
  await b.screenshot('tmp/sophomore-spike-impact.png');
  const errors=b.errors.filter(e=>!e.entry?.url?.endsWith('/favicon.ico'));console.log('errors',errors);if(errors.length)process.exitCode=1;
}finally{b.close();}
