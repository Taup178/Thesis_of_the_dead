$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$toolsRoot = Join-Path (Get-Location).Path 'production/trailer/tools'
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
$release = Invoke-RestMethod 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest'
$asset = $release.assets | Where-Object name -EQ 'ffmpeg-master-latest-win64-gpl.zip' | Select-Object -First 1
if (-not $asset -or $asset.browser_download_url -notmatch '^https://github\.com/BtbN/FFmpeg-Builds/releases/download/') { throw 'Expected publisher build not found.' }
$archivePath = Join-Path $toolsRoot $asset.name
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath -UseBasicParsing
$expected = if ($asset.digest -match '^sha256:([0-9a-f]{64})$') { $Matches[1] } else { $null }
if (-not $expected) {
  $checksums = $release.assets | Where-Object name -EQ 'checksums.sha256' | Select-Object -First 1
  if (-not $checksums) { throw 'Publisher checksum unavailable; refusing to run the download.' }
  $manifest = (Invoke-WebRequest $checksums.browser_download_url -UseBasicParsing).Content
  foreach ($line in ($manifest -split "`n")) {
    if ($line -match ('^([0-9a-fA-F]{64})\s+\*?' + [Regex]::Escape($asset.name) + '\s*$')) { $expected=$Matches[1];break }
  }
}
if (-not $expected) { throw 'Expected checksum not found.' }
$actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actual -ne $expected) { throw 'FFmpeg checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  foreach ($binary in @('ffmpeg.exe','ffprobe.exe')) {
    $entry=$zip.Entries | Where-Object {$_.FullName.EndsWith('/bin/'+$binary)} | Select-Object -First 1
    if(-not $entry){throw "Missing $binary"}
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $toolsRoot $binary),$true)
  }
} finally {$zip.Dispose()}
Write-Output ('Verified publisher SHA256: '+$actual)
& (Join-Path $toolsRoot 'ffmpeg.exe') -version | Select-Object -First 2
