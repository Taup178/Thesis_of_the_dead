import { browser } from './browser-transformation.mjs';
const b = await browser('http://127.0.0.1:5173/?level=3&transform=1');
try {
  console.log(await b.evaluate(`(async () => {
    const g=__game;g.state='inspect';g._showOverlay('loading-overlay');
    const T=await import('/node_modules/three/build/three.module.js');
    const {Level3}=await import('/src/levels/Level3.js');const {Player}=await import('/src/player/Player.js');
    const level=new Level3(g.scene,{transformationPreview:true});await level.load();g.currentLevel=level;
    await level.prepareCinematics(g.renderer,g.camera);
    g.player=new Player(g.scene,g.input,g.camera);await g.player.loadCharacter();level.preparePlayer(g.player);
    g._showOverlay(null);g.hudEl.classList.add('cinematic');
    g._updateCinematicPresentation=()=>{g.bossCinematic.classList.add('active');g.hudEl.classList.add('cinematic');};
    level.update(0,g.player);
    window.advanceTo=(time)=>{while(level.transformation.time<time-.0001)level.update(Math.min(1/60,time-level.transformation.time),g.player);
      g.scene.updateMatrixWorld(true);g.renderer.render(g.scene,g.camera);
      return {time:level.transformation.time,swapped:level.transformation.swapped,dust:level.transformation.dust.coverage,
        calls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,monster:level.transformationMonster.group.visible};};
    window.dustOcclusion=()=>{
      const target=new T.WebGLRenderTarget(512,320);target.texture.colorSpace=T.SRGBColorSpace;
      const old=g.renderer.getRenderTarget(),monster=level.transformationMonster.group;
      const seen=new Uint8Array(512*320*4),hidden=new Uint8Array(seen.length);
      g.renderer.setRenderTarget(target);g.renderer.render(g.scene,g.camera);g.renderer.readRenderTargetPixels(target,0,0,512,320,seen);
      monster.visible=false;g.renderer.render(g.scene,g.camera);g.renderer.readRenderTargetPixels(target,0,0,512,320,hidden);
      monster.visible=true;g.renderer.setRenderTarget(old);target.dispose();
      let maximum=0,total=0,changed=0;
      for(let i=0;i<seen.length;i++){if(i%4===3)continue;const delta=Math.abs(seen[i]-hidden[i]);maximum=Math.max(maximum,delta);total+=delta;if(delta>2)changed++;}
      return {maximumPixelDifference:maximum,averagePixelDifference:total/(512*320*3),changedChannels:changed};
    };
    return {timing:level.transformation.timing,monsterHeight:level.transformationMonster.height};
  })()`));
  console.log('swell',await b.evaluate('advanceTo(__game.currentLevel.transformation.timing.burst-.03)'));
  await b.screenshot('tmp/transformation-swell.png');
  console.log('dust',await b.evaluate('advanceTo(__game.currentLevel.transformation.timing.swap+.04)'));
  const peak=await b.evaluate('dustOcclusion()');console.log('peak occlusion',peak);
  await b.screenshot('tmp/transformation-dust.png');
  console.log('mid fade',await b.evaluate('advanceTo((__game.currentLevel.transformation.timing.clearStart+__game.currentLevel.transformation.timing.clearEnd)/2)'));
  console.log('mid occlusion',await b.evaluate('dustOcclusion()'));
  await b.screenshot('tmp/transformation-mid-fade.png');
  console.log('reveal',await b.evaluate('advanceTo(__game.currentLevel.transformation.timing.end)'));
  await b.screenshot('tmp/transformation-reveal.png');
  console.log('controls',await b.evaluate('(()=>{const g=__game,l=g.currentLevel;for(let i=0;i<45;i++)l.update(1/60,g.player);return {scripted:g.player.scriptedMovement,shooting:l.allowsShooting,cinematic:l.transformationCinematicActive,bossPosition:l.transformationMonster.group.position.toArray()};})()'));
  console.log('errors',b.errors.filter(e=>!e.entry?.url?.endsWith('/favicon.ico')));
} finally { b.close(); }
