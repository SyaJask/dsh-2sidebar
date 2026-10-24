param(
  [string]$Out = "shot.png",
  [string]$TitleLike = "DeepSeek Harness",
  [int]$DelayMs = 700
)
Add-Type -AssemblyName System.Drawing
$sig = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinCap3 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type -TypeDefinition $sig
[void][WinCap3]::SetProcessDPIAware()
$script:found = [IntPtr]::Zero
$cb = [WinCap3+EnumWindowsProc]{ param($h, $l)
  if ([WinCap3]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [WinCap3]::GetWindowText($h, $sb, 512) | Out-Null
    if ($sb.ToString() -like "*$TitleLike*") { $script:found = $h; $script:foundTitle = $sb.ToString(); return $false }
  }
  return $true
}
[void][WinCap3]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:found -eq [IntPtr]::Zero) { Write-Output "NO_WINDOW"; exit 1 }
$h = $script:found
if ([WinCap3]::IsIconic($h)) { [WinCap3]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 400 }
[WinCap3]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds $DelayMs
$r = New-Object WinCap3+RECT
[WinCap3]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $ht)))
$g.Dispose()
$full = [System.IO.Path]::GetFullPath($Out)
$dir = [System.IO.Path]::GetDirectoryName($full)
if (![System.IO.Directory]::Exists($dir)) { [System.IO.Directory]::CreateDirectory($dir) | Out-Null }
$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "SAVED $full ($w x $ht) at $($r.Left),$($r.Top)"
