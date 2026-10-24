param(
  [string]$TitleLike = "DeepSeek Harness",
  [string]$Keys = "^%b",
  [int]$DelayMs = 900
)
Add-Type -AssemblyName System.Windows.Forms
$sig = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class HotKeyWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
Add-Type -TypeDefinition $sig
[void][HotKeyWin]::SetProcessDPIAware()
$script:found = [IntPtr]::Zero
$cb = [HotKeyWin+EnumWindowsProc]{ param($h, $l)
  if ([HotKeyWin]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [HotKeyWin]::GetWindowText($h, $sb, 512) | Out-Null
    if ($sb.ToString() -like "*$TitleLike*") { $script:found = $h; $script:ftitle = $sb.ToString(); return $false }
  }
  return $true
}
[void][HotKeyWin]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:found -eq [IntPtr]::Zero) { Write-Output "NO_WINDOW"; exit 1 }
$h = $script:found
if ([HotKeyWin]::IsIconic($h)) { [void][HotKeyWin]::ShowWindow($h, 9); Start-Sleep -Milliseconds 400 }
[void][HotKeyWin]::ShowWindow($h, 5)
[void][HotKeyWin]::BringWindowToTop($h)
[void][HotKeyWin]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 500
Write-Output ("TITLE " + $script:ftitle)
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Start-Sleep -Milliseconds $DelayMs
Write-Output ("SENT " + $Keys)
