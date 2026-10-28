param([string]$BaseUrl = 'http://127.0.0.1:5175', [switch]$NewMovesOnly, [switch]$EnrageOnly, [switch]$VictoryOnly, [switch]$VoicesOnly, [switch]$MusicOnly, [switch]$MotionOnly, [switch]$MonsterVocalsOnly)
$ErrorActionPreference = 'Stop'
$reviewProfile = Join-Path $env:TEMP 'thesis-monster-browser-review'
$reviewArgs = @('--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,800', '--remote-debugging-port=9224', ('"--user-data-dir=' + $reviewProfile + '"'), 'about:blank')
$reviewBrowser = Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList $reviewArgs -WindowStyle Hidden -PassThru
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$script:reviewMessageId = 0
$script:reviewErrors = @()
function Invoke-ReviewCdp([string]$Method, $Parameters = @{}) {
  $script:reviewMessageId++
  $messageId = $script:reviewMessageId
  $bytes = [Text.Encoding]::UTF8.GetBytes((@{ id = $messageId; method = $Method; params = $Parameters } | ConvertTo-Json -Depth 30 -Compress))
  $socket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  while ($true) {
    $buffer = [byte[]]::new(65536)
    $stream = [IO.MemoryStream]::new()
    do {
      $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      $stream.Write($buffer, 0, $received.Count)
    } while (-not $received.EndOfMessage)
    $reply = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
    $stream.Dispose()
    if ($reply.method -eq 'Runtime.exceptionThrown') { $script:reviewErrors += $reply.params.exceptionDetails.text }
    if ($reply.id -eq $messageId) {
      if ($reply.error) { throw ($reply.error | ConvertTo-Json -Compress) }
      return $reply.result
    }
  }
}
function Invoke-ReviewJs([string]$Expression) {
  $reply = Invoke-ReviewCdp 'Runtime.evaluate' @{ expression = $Expression; awaitPromise = $true; returnByValue = $true; userGesture = $true }
  if ($reply.exceptionDetails) { throw ($reply.exceptionDetails | ConvertTo-Json -Depth 8 -Compress) }
  return $reply.result.value
}
try {
  $browserReady = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { Invoke-RestMethod 'http://127.0.0.1:9224/json/version' | Out-Null; $browserReady = $true; break } catch { Start-Sleep -Milliseconds 100 }
  }
  if (-not $browserReady) { throw 'Chrome debugging endpoint did not start.' }
  $target = Invoke-RestMethod -Method Put 'http://127.0.0.1:9224/json/new?about:blank'
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  Invoke-ReviewCdp 'Runtime.enable' | Out-Null
  Invoke-ReviewCdp 'Network.enable' | Out-Null
  Invoke-ReviewCdp 'Network.setCacheDisabled' @{ cacheDisabled = $true } | Out-Null
  $previewQuery = if ($VictoryOnly -or $VoicesOnly) { 'level=3&victory=1' } else { 'level=3&transform=1' }
  Invoke-ReviewCdp 'Page.navigate' @{ url = "$BaseUrl/?$previewQuery" } | Out-Null
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    if (Invoke-ReviewJs '!!window.__game') { break }; Start-Sleep -Milliseconds 100
  }
  Invoke-ReviewJs '(async () => { await window.__game.startGame(); const g=window.__game; g.state=g.STATE.PAUSED; g._showOverlay(null); g.player.hits=[]; g.player.takeDamage=(damage,impact)=>g.player.hits.push({damage,leg:g.currentLevel.monsterFight?.degree.leg,source:impact.source?.toArray()}); for(let i=0;i<2400&&!g.currentLevel.monsterFight;i++)g.currentLevel.update(1/60,g.player); return {active:!!g.currentLevel.monsterFight,scripted:g.player.scriptedMovement}; })()' | ConvertTo-Json -Compress
  if ($MonsterVocalsOnly) {
    Invoke-ReviewJs '(async function(){const g=window.__game,b=g.currentLevel.monsterFight,a=g.audio;g.psychologicalVoices?.cancel();await a.ensureContext().resume();const files=["intro","taunt-01","taunt-02","taunt-03","enrage","rush","growl-01","growl-02","attack-roar","death"].map(id=>"./assets/audio/voices/monster/"+id+".ogg");await a.preload(files);if(!files.every(file=>a.cache.has(file)))throw Error("Missing monster vocal decode");b.vocals.update(2);await new Promise(r=>setTimeout(r,100));const normal=[...a.activeVoices].find(v=>v.group==="monster-vocal");if(!normal||normal.gain.gain.value<=0)throw Error("Monster taunt is inaudible");const introSeconds=normal.source.buffer.duration;b.takeDamage(600);await new Promise(r=>setTimeout(r,100));const death=[...a.activeVoices].filter(v=>v.group==="monster-death");if(death.length!==1||[...a.activeVoices].some(v=>v.group==="monster-vocal"))throw Error("Death did not replace the taunt");const result={decoded:files.length,introSeconds,deathSeconds:death[0].source.buffer.duration,deathGain:death[0].gain.gain.value,duckOwners:a.dialogueDuckOwners.size};b.vocals.stop();return result;})()' | ConvertTo-Json -Depth 6 -Compress
    Write-Output ('Browser errors: ' + ($script:reviewErrors | ConvertTo-Json -Compress))
    return
  }
  if ($MotionOnly) {
    $motionFrames = Join-Path (Get-Location).Path 'tmp/monster-motion-preview'
    New-Item -ItemType Directory -Force $motionFrames | Out-Null
    Invoke-ReviewJs '(function(){const g=window.__game,b=g.currentLevel.monsterFight;b.degree.clear();b.rocks.clear();b.group.position.set(0,0,-8);b.group.rotation.set(0,0,0);g.player.group.position.set(0,0,10);b._beginSpinApproach(g.player);g.camera.fov=50;g.camera.updateProjectionMatrix();g.camera.position.set(8,4.5,2);g.camera.lookAt(0,2,-7);return {state:b.state};})()' | ConvertTo-Json -Compress
    $motionTelemetry = @()
    for ($motionFrame = 0; $motionFrame -lt 120; $motionFrame++) {
      $frameState = Invoke-ReviewJs '(function(){const g=window.__game,b=g.currentLevel.monsterFight;if(b.state==="idle")b.cooldown=100;b.update(1/30,g.player);g.camera.position.lerp(b.group.position.clone().add({x:8,y:4.5,z:10}),1-Math.exp(-8/30));g.camera.lookAt(b.group.position.x,2,b.group.position.z+1);g.renderer.render(g.scene,g.camera);const hands=b.motion.arms.map(a=>b.group.worldToLocal(a.hand.getWorldPosition(b.group.position.clone())));return {state:b.state,age:b.time,speed:b.motion.moveSpeed,span:hands[0].x-hands[1].x,dedicatedRun:!!b.motion._sprintPose};})()'
      $motionTelemetry += [pscustomobject]@{ frame = $motionFrame; state = $frameState.state; age = $frameState.age; speed = $frameState.speed; span = $frameState.span; dedicatedRun = $frameState.dedicatedRun }
      $shot = Invoke-ReviewCdp 'Page.captureScreenshot' @{ format = 'png' }
      [IO.File]::WriteAllBytes((Join-Path $motionFrames ('frame-{0:D3}.png' -f $motionFrame)), [Convert]::FromBase64String($shot.data))
    }
    $motionTelemetry | ConvertTo-Json -Depth 6 | Set-Content tmp/monster-motion-preview.json -Encoding UTF8
    Invoke-ReviewJs '(function(){const b=window.__game.currentLevel.monsterFight;return {state:b.state,position:b.group.position.toArray(),hits:window.__game.player.hits};})()' | ConvertTo-Json -Depth 6 -Compress
    & production/trailer/tools/ffmpeg.exe -hide_banner -loglevel error -y -framerate 30 -i (Join-Path $motionFrames 'frame-%03d.png') -vf 'pad=ceil(iw/2)*2:ceil(ih/2)*2' -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -movflags +faststart tmp/monster-motion-preview.mp4
    if ($LASTEXITCODE -ne 0) { throw 'Motion preview export failed.' }
    $spinFrames = @($motionTelemetry | Where-Object { $_.state -eq 'spin' })
    if (-not ($motionTelemetry[0].dedicatedRun) -or -not $spinFrames.Count -or ($spinFrames | Measure-Object span -Maximum).Maximum -lt 4.3) { throw 'Preview did not use the corrected running animation and wide-arm spin.' }
    $spinStart = ($spinFrames[0].frame / 30).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)
    $spinEnd = (($spinFrames[-1].frame + 2) / 30).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)
    $motionFilter = '[0:v]split=3[normal][run][spin];[normal]drawtext=fontfile=public/assets/ui/fonts/IMFeENsc28P.ttf:text=FULL SPEED:fontsize=28:fontcolor=white:x=30:y=80:box=1:boxcolor=black@0.6[n];[run]trim=start=0.2:end=1.5,setpts=2*(PTS-STARTPTS),drawtext=fontfile=public/assets/ui/fonts/IMFeENsc28P.ttf:text=RUN - HALF SPEED:fontsize=28:fontcolor=white:x=30:y=80:box=1:boxcolor=black@0.6[r];[spin]trim=start=SPINSTART:end=SPINEND,setpts=2*(PTS-STARTPTS),drawtext=fontfile=public/assets/ui/fonts/IMFeENsc28P.ttf:text=WIDE SPIN - HALF SPEED:fontsize=28:fontcolor=white:x=30:y=80:box=1:boxcolor=black@0.6[s];[n][r][s]concat=n=3:v=1:a=0[v]'
    $motionFilter = $motionFilter.Replace('SPINSTART', $spinStart).Replace('SPINEND', $spinEnd)
    & production/trailer/tools/ffmpeg.exe -hide_banner -loglevel error -y -i tmp/monster-motion-preview.mp4 -filter_complex $motionFilter -map '[v]' -r 30 -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -movflags +faststart tmp/monster-run-and-wide-spin-preview.mp4
    if ($LASTEXITCODE -ne 0) { throw 'Wide spin preview export failed.' }
    Write-Output ('Browser errors: ' + ($script:reviewErrors | ConvertTo-Json -Compress))
    return
  }
  if ($MusicOnly) {
    Invoke-ReviewJs '(async function(){const g=window.__game,a=g.audio,c=a.ensureContext();await c.resume();const starts=[],create=c.createBufferSource.bind(c);c.createBufferSource=()=>{const s=create(),start=s.start.bind(s);s.start=(when,offset=0)=>{starts.push({offset,duration:s.buffer.duration});return start(when,offset);};return s;};await a.setFinalEncounterPhase("dean");const dean=[...a.themeSources].find(t=>t.key==="final-dean"),deanStart=starts.at(-1);if(!dean||deanStart.offset!==60||deanStart.duration<=60)throw Error("Tar did not start at 1:00");await new Promise(r=>setTimeout(r,100));const deanEarly=dean.gain.gain.value;await new Promise(r=>setTimeout(r,3200));if(!(deanEarly<dean.gain.gain.value*0.25))throw Error("Tar did not fade up smoothly");await a.setFinalEncounterPhase("monster");const monster=[...a.themeSources].find(t=>t.key==="final-monster"),monsterStart=starts.at(-1);if(!monster||monsterStart.offset!==25||monsterStart.duration<=25)throw Error("Red Moon did not start at 0:25");await new Promise(r=>setTimeout(r,100));const monsterEarly=monster.gain.gain.value;await new Promise(r=>setTimeout(r,3200));if(!(monsterEarly<monster.gain.gain.value*0.25))throw Error("Red Moon did not fade up smoothly");g.currentLevel.degreeVictory={done:true};await a.setFinalEncounterPhase(g.currentLevel.getMusicPhase());await new Promise(r=>setTimeout(r,2200));if(a.themeSources.size||a.themeKey!=="final-complete"||!g.menuMusic.audio.paused)throw Error("Music survived the degree cutscene");return {dean:deanStart,monster:monsterStart,endingSilent:true,oldBossTrackLoaded:a.cache.has("./assets/audio/music/lost-horror.ogg")};})()' | ConvertTo-Json -Depth 5 -Compress
    Write-Output ('Browser errors: ' + ($script:reviewErrors | ConvertTo-Json -Compress))
    return
  }
  if ($VoicesOnly) {
    # Drive this adapter explicitly while the game simulation is paused.
    Invoke-ReviewJs 'window.__game.psychologicalVoices.update = () => {};' | Out-Null
    Invoke-ReviewJs '(async function(){const g=window.__game,p=g.audio.internalVoices,d=g.psychologicalVoices.third;await g.audio.ensureContext().resume();p.settings={...p.settings,enabled:true,volume:0.7,subtitles:true};const entries=Object.entries(d.assets);if(entries.length!==24)throw Error("Missing chapter clips");const clips=[];for(const [id,asset]of entries){const b=await p.load(asset);if(!b||b.numberOfChannels!==2||!asset.effectsBaked)throw Error("Invalid audio: "+id);const h=await p.play(asset,{identity:id.split("_")[1]});if(!h)throw Error("Playback failed: "+id);if(!g.audio.dialogueDuckOwners.size)throw Error("Speech did not duck music");clips.push({id,duration:b.duration,channels:b.numberOfChannels});h.stop();}if(g.audio.dialogueDuckOwners.size)throw Error("Ducking was not released");return {decodedAndStarted:clips.length,clips};})()' | ConvertTo-Json -Depth 6 -Compress
    Invoke-ReviewJs '(async function(){const g=window.__game,l=g.currentLevel,v=g.psychologicalVoices.third,p=g.audio.internalVoices;v._attach(l,g.player);v.update(0.1,l,g.player,{active:true});if(v.running)throw Error("Pickup line before boss falls");for(let i=0;i<3000&&!l.degreeVictory?.taken;i++)l.update(1/60,g.player);v.update(0.1,l,g.player,{active:true});await new Promise(r=>setTimeout(r,80));if(!v.running||v.running.cue.id!=="degree_taken")throw Error("Actual degree transfer did not start its voice");if(!v.captions.size||!p.active.size)throw Error("No audible captioned response");const result={cue:v.running.cue.id,captions:[...v.captions.values()],audible:p.active.size};v.cancel();return result;})()' | ConvertTo-Json -Depth 6 -Compress
    Invoke-ReviewJs '(async function(){const g=window.__game,l=g.currentLevel,v=g.psychologicalVoices.third;l.destinyChoice="blue";g.levelComplete();v.update(0.1,l,g.player,{active:true});await new Promise(r=>setTimeout(r,80));const caption=document.getElementById("voice-subtitles"),overlay=document.getElementById("levelcomplete-overlay");if(v.running?.cue.id!=="blue_choice"||caption.hidden||Number(getComputedStyle(caption).zIndex)<=Number(getComputedStyle(overlay).zIndex))throw Error("Ending voice/caption did not survive the completion card");return {ending:v.running.cue.id,captionAboveCompletion:true};})()' | ConvertTo-Json -Compress
    Write-Output ('Browser errors: ' + ($script:reviewErrors | ConvertTo-Json -Compress))
    return
  }
  if ($VictoryOnly) {
    Invoke-ReviewJs '(function(){const g=window.__game,l=g.currentLevel;l.monsterFight.takeDamage(600);for(let i=0;i<3000&&!l.degreeVictory?.taken;i++)l.update(1/60,g.player);g.renderer.render(g.scene,g.camera);const v=l.degreeVictory;return {phase:v?.phase,time:v?.time,taken:v?.taken,error:v?.grip.getWorldPosition(v.contact.clone()).distanceTo(v.contact),position:g.player.group.position.toArray()};})()' | ConvertTo-Json -Compress
    $shot = Invoke-ReviewCdp 'Page.captureScreenshot' @{ format = 'png' }
    [IO.File]::WriteAllBytes((Join-Path (Get-Location).Path 'tmp/monster-victory-contact.png'), [Convert]::FromBase64String($shot.data))
    foreach ($capture in @('celebration', 'portals')) {
      $condition = if ($capture -eq 'celebration') { 'l.degreeVictory.phase==="hold"&&l.degreeVictory.time>=2.7' } else { 'l.victoryPortals.time>=2.4' }
      $expression = '(function(){const g=window.__game,l=g.currentLevel;for(let i=0;i<2400;i++){l.update(1/60,g.player);if(CONDITION)break;}g._updateHUD();g.renderer.render(g.scene,g.camera);return {taken:l.degreeVictory.taken,celebrated:l.degreeVictory.done,portals:l.victoryPortals.time,complete:l.levelComplete,paper:l.degreeScroll.getWorldPosition(l.degreeVictory.contact.clone()).toArray(),paperScale:l.degreeScroll.getWorldScale(l.degreeVictory.contact.clone()).toArray()};})()'.Replace('CONDITION', $condition)
      Invoke-ReviewJs $expression | ConvertTo-Json -Compress
      $shot = Invoke-ReviewCdp 'Page.captureScreenshot' @{ format = 'png' }
      [IO.File]::WriteAllBytes((Join-Path (Get-Location).Path ("tmp/monster-victory-" + $capture + ".png")), [Convert]::FromBase64String($shot.data))
    }
    Invoke-ReviewJs '(function(){const g=window.__game,l=g.currentLevel;for(let i=0;i<120&&!l.destinyReady;i++)l.update(1/60,g.player);const ready=l.destinyReady&&!g.player.scriptedMovement&&!l.levelComplete;g.player.group.position.copy(l.victoryPortals.portals[1].center);g.player.group.position.y=0;g.player.group.position.z+=4;g.player.grounded=true;g.input.keys.KeyW=true;for(let i=0;i<180;i++){g.player.update(1/60,l.getObstacles(),l.getWorldBounds());l.update(1/60,g.player);}g.input.keys.KeyW=false;if(!ready||l.destinyChoice!=="blue"||!l.levelComplete)throw Error("Destiny flow failed");return {ready,choice:l.destinyChoice,complete:l.levelComplete};})()' | ConvertTo-Json -Compress
    Write-Output ('Browser errors: ' + ($script:reviewErrors | ConvertTo-Json -Compress))
    return
  }
  if ($EnrageOnly) {
    Invoke-ReviewJs '(function(){const g=window.__game,b=g.currentLevel.monsterFight;g.state=g.STATE.PLAYING;b.takeDamage(360);for(let i=0;i<24;i++)b.update(1/60,g.player);g._syncEnemyLock();g.player.toggleBossLock();g.camera.position.set(4,3,4);g.camera.lookAt(0,2.5,-4);g._updateEnemyLockPin();g.renderer.render(g.scene,g.camera);return {state:b.state,health:b.health,held:g.currentLevel.degreeScroll.parent===g.currentLevel.transformation.degreeCatch.grip,pin:!g.enemyLockPin.classList.contains("hidden")};})()' | ConvertTo-Json -Compress
    $shot = Invoke-ReviewCdp 'Page.captureScreenshot' @{ format = 'png' }
    [IO.File]::WriteAllBytes((Join-Path (Get-Location).Path 'tmp/monster-enrage-pin.png'), [Convert]::FromBase64String($shot.data))
    Invoke-ReviewJs '(function(){const g=window.__game;g.player.toggleBossLock();g._syncEnemyLock();g._updateEnemyLockPin();const result={locked:!!g.player.lockOnTarget,pinDisplay:getComputedStyle(g.enemyLockPin).display};if(result.locked||result.pinDisplay!=="none")throw Error("Unlock did not hide the pin");return result;})()' | ConvertTo-Json -Compress
    Write-Output ('Browser errors: ' + ($script:reviewErrors | ConvertTo-Json -Compress))
    return
  }
  if ($NewMovesOnly) {
    foreach ($pose in @(@{ name = 'spin'; age = 0.43 }, @{ name = 'slam'; age = 1.15 }, @{ name = 'slam'; age = 2.08 })) {
      $expression = '(function(){const g=window.__game,b=g.currentLevel.monsterFight;b.degree.clear();b.rocks.clear();b.group.position.set(0,0,-4);b.group.rotation.set(0,0,0);b.state="MOVE";b.time=0;if(b.state==="spin")b._beginSpin();else b._beginSlam(g.player);for(let t=0;t<AGE;t+=1/60)b.update(1/60,g.player);g.camera.position.set(9,5,13);g.camera.lookAt(b.group.position.x,2,b.group.position.z);g.renderer.render(g.scene,g.camera);return {state:b.state,position:b.group.position.toArray(),held:g.currentLevel.degreeScroll.parent===g.currentLevel.transformation.degreeCatch.grip};})()'.Replace('MOVE', $pose.name).Replace('AGE', [string]$pose.age)
      Invoke-ReviewJs $expression | ConvertTo-Json -Compress
      $shot = Invoke-ReviewCdp 'Page.captureScreenshot' @{ format = 'png' }
      [IO.File]::WriteAllBytes((Join-Path (Get-Location).Path ("tmp/monster-" + $pose.name + "-" + $pose.age + ".png")), [Convert]::FromBase64String($shot.data))
    }
    Write-Output ('Browser errors: ' + ($script:reviewErrors | ConvertTo-Json -Compress))
    return
  }
  $captures = @('degree-outbound', 'degree-return', 'jump-first', 'smash-first', 'jump-second', 'smash-third')
  foreach ($capture in $captures) {
    $condition = switch ($capture) {
      'degree-outbound' { 'b.degree.active&&b.degree.leg==="outbound"&&b.degree.age>0.35' }
      'degree-return' { 'b.degree.active&&b.degree.leg==="return"&&b.degree.age>0.45' }
      'jump-first' { 'b.state==="smash"&&b.impacts===0&&b.group.position.y>0.6' }
      'smash-first' { 'b.state==="smash"&&b.impacts===1&&b.group.position.y===0' }
      'jump-second' { 'b.state==="smash"&&b.impacts===1&&b.group.position.y>0.5' }
      'smash-third' { 'b.state==="smash"&&b.impacts===3&&b.group.position.y===0' }
    }
    $expression = '(function(){const g=window.__game,b=g.currentLevel.monsterFight;let found=false;for(let i=0;i<2400;i++){g.currentLevel.update(1/60,g.player);if(CONDITION){found=true;break}}g._updateHUD();g.renderer.render(g.scene,g.camera);return {found,state:b.state,impacts:b.impacts,position:b.group.position.toArray(),degreeHeld:g.currentLevel.degreeScroll.parent===g.currentLevel.transformation.degreeCatch.grip,hits:g.player.hits};})()'.Replace('CONDITION', $condition)
    $result = Invoke-ReviewJs $expression
    if (-not $result.found) { throw "Could not reach capture: $capture" }
    $shot = Invoke-ReviewCdp 'Page.captureScreenshot' @{ format = 'png' }
    [IO.File]::WriteAllBytes((Join-Path (Get-Location).Path "tmp/monster-$capture.png"), [Convert]::FromBase64String($shot.data))
    Write-Output ($capture + ': ' + ($result | ConvertTo-Json -Depth 8 -Compress))
  }
  Write-Output ('Browser errors: ' + ($script:reviewErrors | ConvertTo-Json -Compress))
} finally {
  $socket.Dispose()
  if ($reviewBrowser -and -not $reviewBrowser.HasExited) { Stop-Process -Id $reviewBrowser.Id -ErrorAction SilentlyContinue }
}
