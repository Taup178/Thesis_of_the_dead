import { browser } from './browser.mjs';
const b = await browser();
try {
  console.log(await b.evaluate(`(async () => {
    const T=await import('/node_modules/three/build/three.module.js');window.T=T;
    const {Player}=await import('/src/player/Player.js');const g=__game;
    g.state='inspect';g._showOverlay(null);g.hudEl.classList.remove('hidden');
    g.scene.background=new T.Color(0x8c9fac);g.scene.add(new T.HemisphereLight(0xffffff,0x706450,2));
    const sun=new T.DirectionalLight(0xffe4c5,2.5);sun.position.set(5,8,5);g.scene.add(sun);
    const floor=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:0x6c7661}));floor.rotation.x=-Math.PI/2;g.scene.add(floor);
    g.player=new Player(g.scene,g.input,g.camera);await g.player.loadCharacter();
    g.currentLevel={zombies:[],credits:[],allowsShooting:true};
    g.player.mixer.update(0.3);g.player._updateCamera();g.player.weaponPresentation.update(0);g._updateHUD();
    g.camera.position.set(2,1.8,-3);g.camera.lookAt(0,0.9,0);
    const w=g.player.weaponPresentation;
    return {character:g.player.characterModel.name,gun:w.gun.getWorldPosition(new T.Vector3()).toArray(),muzzle:g.player.getMuzzleWorldPosition().toArray(),viewIndices:w.viewModel.getObjectByName('Shaun').geometry.index.count};
  })()`));
  await b.screenshot('tmp/weapon-third.png');
  console.log('first',await b.evaluate(`(() => {const p=__game.player;p.toggleCamera();p.weaponPresentation.update(0);return {muzzle:p.getMuzzleWorldPosition().toArray(),camera:p.camera.position.toArray()};})()`));
  await b.screenshot('tmp/weapon-first.png');
  console.log('bash',await b.evaluate(`(() => {const p=__game.player;p.startGunBash();p.mixer.update(0.25);p.bashTime=0.35;p.weaponPresentation.update(0.25);return p.currentActionName;})()`));
  await b.screenshot('tmp/weapon-bash.png');
  const combat = await b.evaluate(`(async () => {
    const {Zombie}=await import('/src/enemies/Zombie.js');
    const g=__game,p=g.player,c=g.combat,level=g.currentLevel;
    p.bashTime=0;p.mixer.update(1);p._updateCamera();p.weaponPresentation.update(0);
    const idle={pointerLocked:true,consumeKeyPress:()=>false,isMouseButtonDown:()=>false};
    c.update(0,p,level,idle,()=>g._getShotTargets());
    for (let i=0;i<2;i++) {
      const z=new Zombie(g.scene,new T.Vector3(i*2,0,-7),'./assets/models/zombies/Zombie_Basic.gltf');
      await z.ready;z.mixer.update(0.1);level.zombies.push(z);
      g.camera.lookAt(z.group.position.clone().add(new T.Vector3(0,1.25,0)));p.weaponPresentation.update(0);
      for (let shot=0;shot<2;shot++) {
        c.shootCooldown=0;c.fire(p,g._getShotTargets());
        for (let frame=0;frame<20;frame++) c.updateProjectiles(1/60,p,level,g._getShotTargets());
      }
      if(z.alive) throw Error('Actual zombie mesh was not killed: '+z.health);
    }
    const afterShots=p.ammo,dropped=c.pickups.length;
    p.group.position.copy(c.pickups[0].group.position);p.group.position.y=0;
    c.updatePickups(0,p);const afterPickup=p.ammo;
    const z=new Zombie(g.scene,p.group.position.clone().add(new T.Vector3(0,0,-1.6)),'./assets/models/zombies/Zombie_Basic.gltf');
    await z.ready;z.mixer.update(0.1);level.zombies.push(z);
    p.ammo=0;p.bashTime=0;p.yaw=0;p._updateCamera();p.weaponPresentation.update(0);
    c.update(0.01,p,level,{...idle,isMouseButtonDown:()=>true},()=>g._getShotTargets());
    c.update(0.23,p,level,idle,()=>g._getShotTargets());
    const result={afterShots,dropped,afterPickup,bashKilled:!z.alive,ammo:p.ammo,action:p.currentActionName};
    if(afterShots!==26||dropped!==1||afterPickup!==38||z.alive||p.ammo!==0) throw Error(JSON.stringify(result));
    return result;
  })()`);
  console.log('combat',combat);
  console.log('errors',b.errors.filter(e=>!e.entry?.url?.endsWith('/favicon.ico')));
} finally { b.close(); }
