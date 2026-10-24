param(
  [string]$In,
  [string]$Out,
  [int]$X,
  [int]$Y,
  [int]$W,
  [int]$H,
  [int]$Scale = 1
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $In))
$rect = New-Object System.Drawing.Rectangle($X, $Y, $W, $H)
$crop = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $W, $H)), $rect, [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
if ($Scale -gt 1) {
  $big = New-Object System.Drawing.Bitmap(($W * $Scale), ($H * $Scale))
  $g2 = [System.Drawing.Graphics]::FromImage($big)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g2.DrawImage($crop, 0, 0, $big.Width, $big.Height)
  $g2.Dispose()
  $crop.Dispose()
  $crop = $big
}
$full = [System.IO.Path]::GetFullPath($Out)
$crop.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()
$src.Dispose()
Write-Output "CROPPED $full"
