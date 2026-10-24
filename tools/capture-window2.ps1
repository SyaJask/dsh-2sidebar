param(
  [string]$Out = "shot.png",
  [string]$TitleLike = "DeepSeek Harness",
  [switch]$Bring
)
Add-Type -AssemblyName System.Drawing
$sig = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinCap2 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type -TypeDefinition $sig
$found = [IntPtr]::Zero
$cb = [WinCap2+EnumWindowsProc]{ param($h, $l)
  if ([WinCap2]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [WinCap2]::GetWindowText($h, $sb, 512) | Out-Null
    if ($sb.ToString() -like "*$TitleLike*") {
      $script:found = $h
      $script:foundTitle = $sb.ToString()
      return $false
    }
  }
  return $true
}
[void][WinCap2]::EnumWindows($cb, [IntPtr]::Zero)
if ($found -eq [IntPtr]::Zero) { Write-Output "NO_WINDOW title~$TitleLike"; exit 1 }
Write-Output "TITLE $foundTitle"
if ($Bring) {
  [WinCap2]::ShowWindow($found, 9) | Out-Null
  Start-Sleep -Milliseconds 300
  [WinCap2]::SetForegroundWindow($found) | Out-Null
  Start-Sleep -Milliseconds 500
}
$r = New-Object WinCap2+RECT
[WinCap2]::GetWindowRect($found, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [WinCap2]::PrintWindow($found, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$full = [System.IO.Path]::GetFullPath($Out)
$dir = [System.IO.Path]::GetDirectoryName($full)
if (![System.IO.Directory]::Exists($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "SAVED $full ($w x $h) ok=$ok"
