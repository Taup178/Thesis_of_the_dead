import { browser } from './browser.mjs';
const b = await browser();
try {
  console.log(await b.evaluate(`(async()=>{
    const T=await import('/node_modules/three/build/three.module.js');window.T=T;
    const {Player}=await import('/src/player/Player.js'); const g=__game;
    g.state='inspect';g._showOverlay(null);g.hudEl.classList.remove('hidden');
    g.currentLevel=await g.levelManager.loadLevel(1,undefined,{seed:1234});
    g.player=new Player(g.scene,g.input,g.camera);await g.player.loadCharacter();g.currentLevel.preparePlayer(g.player);
    const p=g.player,l=g.currentLevel;p.group.position.y=0;p.grounded=true;p.platformSupport=l.startSurface;
    p.mixer.update(0.1);p._updateCamera();p.weaponPresentation.update(0);l._beginDemonstration();g._updateHUD();
    return {rows:l.rows,portal:l.exitPortal.center.toArray(),model:!!l.exitPortal.model};
  })()`));
  await b.screenshot('tmp/sophomore-room.png');
  console.log(await b.evaluate(`(()=>{
    const g=__game,l=g.currentLevel,p=g.player;l.stageIndex=3;
    const [i,j]=l.pattern.at(-1);p.group.position.copy(l.tilePosition(i,j));p.platformSupport=l.tiles[i][j].surface;p.grounded=true;
    l.currentTile=null;l.expectedIndex=l.pattern.length-1;l.bossMarker.position.copy(l.deanCheckpointPosition(i,j));l.phase='follow';
    p._updateCamera();p.weaponPresentation.update(0);l.update(0.016,p);g._updateHUD();
    return {phase:l.phase,complete:l.levelComplete};
  })()`));
  await b.screenshot('tmp/sophomore-exit.png');
  console.log(await b.evaluate(`(()=>{
    const g=__game,l=g.currentLevel,p=g.player;let n=0;
    while((!l.deanPassage||l.deanPassage.time<1.1)&&n++<500)l.update(1/60,p);
    return {phase:l.phase,deanScale:l.bossMarker.scale.x,complete:l.levelComplete};
  })()`));
  await b.screenshot('tmp/sophomore-dean-portal.png');
  console.log(await b.evaluate(`(()=>{
    const g=__game,l=g.currentLevel,p=g.player;let n=0;
    while(l.phase!=='exit'&&n++<500)l.update(1/60,p);
    g.input.keys.KeyW=true;
    while(l.phase==='exit'&&n++<1000){p.update(1/60,[],null,l.getPlatforming());l.update(1/60,p);}
    g.input.keys.KeyW=false;
    if(l.phase!=='entering')throw Error('Exit is unreachable: '+l.phase);
    for(let i=0;i<65;i++)l.update(1/60,p);
    g._updateHUD();return {phase:l.phase,deanVisible:l.bossMarker.visible,playerScale:p.group.scale.x};
  })()`));
  await b.screenshot('tmp/sophomore-player-portal.png');
  console.log(await b.evaluate(`(()=>{const g=__game,l=g.currentLevel,p=g.player;let e;for(let i=0;i<100;i++)e=l.update(1/60,p);
    if(!e.autoAdvance||!e.levelComplete||p.group.visible)throw Error('Portal did not complete');
    l.dispose();return {events:e,restored:p.group.scale.x===1&&p.group.visible&&!p.scriptedMovement};})()`));
  const errors=b.errors.filter(e=>!e.entry?.url?.endsWith('/favicon.ico'));
  console.log('errors',errors); if(errors.length)process.exitCode=1;
} finally {b.close();}
