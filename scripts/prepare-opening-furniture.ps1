$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
foreach ($asset in @('old_couch', 'bed__bedside_table')) {
  $source = Join-Path 'Zombie_Kit' $asset
  $destination = Join-Path 'public/assets/models/opening' $asset
  New-Item -ItemType Directory -Force -Path (Join-Path $destination 'textures') | Out-Null
  foreach ($name in @('scene.gltf', 'scene.bin', 'license.txt')) {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $destination $name)
  }
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $source 'textures') -File) {
    $image = [System.Drawing.Image]::FromFile($file.FullName)
    try {
      # Use the double overload: Min(1, fractionalRatio) rounds to an integer in PowerShell.
      $ratio = [Math]::Min(1.0, 1024.0 / [Math]::Max($image.Width, $image.Height))
      $bitmap = New-Object System.Drawing.Bitmap([Math]::Max(1, [int]($image.Width * $ratio)), [Math]::Max(1, [int]($image.Height * $ratio)))
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($image, 0, 0, $bitmap.Width, $bitmap.Height)
        $format = if ($file.Extension -eq '.png') { [System.Drawing.Imaging.ImageFormat]::Png } else { [System.Drawing.Imaging.ImageFormat]::Jpeg }
        $bitmap.Save((Join-Path (Resolve-Path -LiteralPath (Join-Path $destination 'textures')) $file.Name), $format)
      } finally { $graphics.Dispose(); $bitmap.Dispose() }
    } finally { $image.Dispose() }
  }
}
