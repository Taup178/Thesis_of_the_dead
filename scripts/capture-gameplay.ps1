param([string]$BaseUrl = 'http://127.0.0.1:5173', [switch]$Probe,
  [string]$Takes = 'dungeon_saws', [int]$Fps = 30, [double]$Seconds = 0,
  [string]$Output = 'production/trailer/local-capture', [string]$Ffmpeg = '')
$ErrorActionPreference = 'Stop'
$captureRoot = (Get-Location).Path
$captureOutput = [IO.Path]::GetFullPath((Join-Path $captureRoot $Output))
if (-not $captureOutput.StartsWith(($captureRoot + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must stay in the workspace.' }
if ($Fps -notin @(24,30,60)) { throw 'FPS must be 24, 30 or 60.' }
New-Item -ItemType Directory -Path $captureOutput -Force | Out-Null
$captureProfile = Join-Path $env:TEMP 'thesis-gameplay-capture-browser'
$captureArgs = @('--headless=new', '--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1920,1080', '--remote-debugging-port=9236',
  ('"--user-data-dir=' + $captureProfile + '"'), 'about:blank')
$captureBrowser = Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ArgumentList $captureArgs -WindowStyle Hidden -PassThru
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$script:captureId = 0
function Invoke-CaptureCdp([string]$Method, $Parameters = @{}) {
  $script:captureId++; $id = $script:captureId
  $bytes = [Text.Encoding]::UTF8.GetBytes((@{id=$id;method=$Method;params=$Parameters}|ConvertTo-Json -Depth 40 -Compress))
  $socket.SendAsync([ArraySegment[byte]]::new($bytes),[System.Net.WebSockets.WebSocketMessageType]::Text,$true,[Threading.CancellationToken]::None).GetAwaiter().GetResult()|Out-Null
  while ($true) {
    $buffer=[byte[]]::new(262144);$stream=[IO.MemoryStream]::new()
    do {$part=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),[Threading.CancellationToken]::None).GetAwaiter().GetResult();$stream.Write($buffer,0,$part.Count)} while(-not $part.EndOfMessage)
    $reply=[Text.Encoding]::UTF8.GetString($stream.ToArray())|ConvertFrom-Json;$stream.Dispose()
    if ($reply.id -eq $id) {if($reply.error){throw ($reply.error|ConvertTo-Json -Compress)};return $reply.result}
  }
}
function Invoke-CaptureJs([string]$Expression) {
  $reply=Invoke-CaptureCdp 'Runtime.evaluate' @{expression=$Expression;awaitPromise=$true;returnByValue=$true;userGesture=$true}
  if($reply.exceptionDetails){throw ($reply.exceptionDetails|ConvertTo-Json -Depth 8 -Compress)}
  return $reply.result.value
}
try {
  $ready=$false
  for($i=0;$i -lt 40;$i++) {try {Invoke-RestMethod 'http://127.0.0.1:9236/json/version'|Out-Null;$ready=$true;break}catch{Start-Sleep -Milliseconds 100}}
  if(-not $ready){throw 'Capture browser did not start.'}
  $target=Invoke-RestMethod -Method Put 'http://127.0.0.1:9236/json/new?about:blank'
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl,[Threading.CancellationToken]::None).GetAwaiter().GetResult()|Out-Null
  Invoke-CaptureCdp 'Runtime.enable'|Out-Null
  Invoke-CaptureCdp 'Emulation.setDeviceMetricsOverride' @{width=1920;height=1080;deviceScaleFactor=1;mobile=$false}|Out-Null
  Invoke-CaptureCdp 'Page.addScriptToEvaluateOnNewDocument' @{source="localStorage.setItem('thesis-of-the-dead:quality','medium');"}|Out-Null
  Invoke-CaptureCdp 'Page.navigate' @{url=$BaseUrl}|Out-Null
  for($i=0;$i -lt 100;$i++){if(Invoke-CaptureJs '!!window.__game'){break};Start-Sleep -Milliseconds 100}
  Invoke-CaptureJs ([IO.File]::ReadAllText((Join-Path $captureRoot 'scripts/gameplay-takes.js')))|Out-Null
  foreach($name in $Takes.Split(',')) {
    $nameJson=$name|ConvertTo-Json -Compress
    $info=Invoke-CaptureJs "window.__gameplayCapture.prepare($nameJson)"
    $takeSeconds=if($Seconds -gt 0){$Seconds}else{[double]$info.seconds}
    if($Probe) {
      $result=Invoke-CaptureJs '(()=>{const g=window.__game,gl=g.renderer.getContext(),ext=gl.getExtension("WEBGL_debug_renderer_info");const frames=[];for(let i=0;i<3;i++){const start=performance.now(),r=window.__gameplayCapture.frame(1/30);frames.push({milliseconds:performance.now()-start,characters:r.jpeg.length,state:r.state});}return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),frames};})()'
      $result|ConvertTo-Json -Depth 15
      continue
    }
    $framesPath=Join-Path $captureOutput ($name+'-frames');New-Item -ItemType Directory -Path $framesPath -Force|Out-Null
    $states=@()
    for($i=0;$i -lt [Math]::Round($takeSeconds*$Fps);$i++) {
      $result=Invoke-CaptureJs "window.__gameplayCapture.frame(1/$Fps)"
      $data=$result.jpeg.Substring($result.jpeg.IndexOf(',')+1)
      [IO.File]::WriteAllBytes((Join-Path $framesPath ($i.ToString('00000')+'.jpg')),[Convert]::FromBase64String($data))
      $states+=$result.state
      if($i % $Fps -eq 0){Write-Output "$name frame $i / $($takeSeconds*$Fps)"}
      if(-not $result.state.alive){break}
    }
    $manifest=@{name=$name;fps=$Fps;width=1920;height=1080;states=$states;events=(Invoke-CaptureJs 'window.__gameplayCapture.events()')}
    [IO.File]::WriteAllText((Join-Path $captureOutput ($name+'-telemetry.json')),($manifest|ConvertTo-Json -Depth 20))
    if($Ffmpeg){& $Ffmpeg -hide_banner -loglevel error -y -framerate $Fps -i (Join-Path $framesPath '%05d.jpg') -c:v libx264 -crf 16 -pix_fmt yuv420p -movflags +faststart (Join-Path $captureOutput ($name+'.mp4'));if($LASTEXITCODE -ne 0){throw 'Encoding failed.'}}
  }
} finally {
  try {Invoke-CaptureCdp 'Browser.close'|Out-Null}catch{}
  $socket.Dispose()
  if($captureBrowser -and -not $captureBrowser.HasExited){Stop-Process -Id $captureBrowser.Id -ErrorAction SilentlyContinue}
}
