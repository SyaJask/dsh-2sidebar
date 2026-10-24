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
public class SafeKeys {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
}
"@
Add-Type -TypeDefinition $sig
[void][SafeKeys]::SetProcessDPIAware()
$script:found = [IntPtr]::Zero
$cb = [SafeKeys+EnumWindowsProc]{ param($h, $l)
  if ([SafeKeys]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [SafeKeys]::GetWindowText($h, $sb, 512) | Out-Null
    if ($sb.ToString() -like "*$TitleLike*") { $script:found = $h; $script:ftitle = $sb.ToString(); return $false }
  }
  return $true
}
[void][SafeKeys]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:found -eq [IntPtr]::Zero) { Write-Output "NO_WINDOW"; exit 1 }
$target = $script:found
if ([SafeKeys]::IsIconic($target)) { [void][SafeKeys]::ShowWindow($target, 9); Start-Sleep -Milliseconds 400 }

function Force-Foreground($h) {
  $fg = [SafeKeys]::GetForegroundWindow()
  if ($fg -eq $h) { return $true }
  $fgPid = 0
  $null = [SafeKeys]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $myThread = [SafeKeys]::GetCurrentThreadId()
  $fgThread = [SafeKeys]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  [void][SafeKeys]::AttachThreadInput($myThread, $fgThread, $true)
  [void][SafeKeys]::BringWindowToTop($h)
  [void][SafeKeys]::SetForegroundWindow($h)
  [void][SafeKeys]::AttachThreadInput($myThread, $fgThread, $false)
  Start-Sleep -Milliseconds 400
  return ([SafeKeys]::GetForegroundWindow() -eq $h)
}

$ok = Force-Foreground $target
if (-not $ok) { Write-Output "FOREGROUND_FAILED (refusing to send keys)"; exit 2 }
Write-Output ("TITLE " + $script:ftitle)
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Start-Sleep -Milliseconds $DelayMs
Write-Output ("SENT " + $Keys)
