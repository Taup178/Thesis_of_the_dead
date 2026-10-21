param([string]$BaseUrl = 'http://127.0.0.1:5175', [switch]$NewMovesOnly, [switch]$EnrageOnly, [switch]$VictoryOnly)
$ErrorActionPreference = 'Stop'
$reviewProfile = Join-Path $env:TEMP 'thesis-monster-browser-review'
$reviewArgs = @('--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
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
  $reply = Invoke-ReviewCdp 'Runtime.evaluate' @{ expression = $Expression; awaitPromise = $true; returnByValue = $true }
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
  Invoke-ReviewCdp 'Page.navigate' @{ url = "$BaseUrl/?level=3&transform=1" } | Out-Null
  for ($attempt = 0; $attempt -lt 100; $attempt++) {
    if (Invoke-ReviewJs '!!window.__game') { break }; Start-Sleep -Milliseconds 100
  }
  Invoke-ReviewJs '(async () => { await window.__game.startGame(); const g=window.__game; g.state=g.STATE.PAUSED; g._showOverlay(null); g.player.hits=[]; g.player.takeDamage=(damage,impact)=>g.player.hits.push({damage,leg:g.currentLevel.monsterFight?.degree.leg,source:impact.source?.toArray()}); for(let i=0;i<2400&&!g.currentLevel.monsterFight;i++)g.currentLevel.update(1/60,g.player); return {active:!!g.currentLevel.monsterFight,scripted:g.player.scriptedMovement}; })()' | ConvertTo-Json -Compress
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
