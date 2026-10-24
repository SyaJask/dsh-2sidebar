param(
  [string]$Out = "shot.png",
  [string]$Match = "DeepSeek"
)
Add-Type -AssemblyName System.Drawing
$sig = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinCap {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type -TypeDefinition $sig

$procs = Get-Process | Where-Object { $_.ProcessName -like "*$Match*" }
$targets = @()
foreach ($p in $procs) {
  $h = $p.MainWindowHandle
  if ($h -ne [IntPtr]::Zero) {
    $t = $p.MainWindowTitle
    $r = New-Object WinCap+RECT
    [WinCap]::GetWindowRect($h, [ref]$r) | Out-Null
    $targets += [pscustomobject]@{ Pid = $p.Id; Hwnd = $h; Title = $t; W = ($r.Right - $r.Left); H = ($r.Bottom - $r.Top) }
  }
}
$targets | Format-Table -AutoSize | Out-String -Width 200
if ($targets.Count -eq 0) { Write-Output "NO_WINDOW"; exit 1 }
$t0 = $targets | Sort-Object { $_.W * $_.H } -Descending | Select-Object -First 1
$hWnd = [IntPtr]$t0.Hwnd
[WinCap]::ShowWindow($hWnd, 9) | Out-Null   # SW_RESTORE
Start-Sleep -Milliseconds 300
[WinCap]::SetForegroundWindow($hWnd) | Out-Null
Start-Sleep -Milliseconds 400
$r = New-Object WinCap+RECT
[WinCap]::GetWindowRect($hWnd, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [WinCap]::PrintWindow($hWnd, $hdc, 2)  # PW_RENDERFULLCONTENT
$g.ReleaseHdc($hdc)
$g.Dispose()
$full = [System.IO.Path]::GetFullPath($Out)
$bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "SAVED $full ($w x $h) ok=$ok"
