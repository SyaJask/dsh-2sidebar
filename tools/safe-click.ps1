param(
  [string]$TitleLike = "DeepSeek Harness",
  [int]$X,
  [int]$Y,
  [int]$DelayMs = 900
)
$sig = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class SafeClick {
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
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
Add-Type -TypeDefinition $sig
[void][SafeClick]::SetProcessDPIAware()
$script:found = [IntPtr]::Zero
$cb = [SafeClick+EnumWindowsProc]{ param($h, $l)
  if ([SafeClick]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [SafeClick]::GetWindowText($h, $sb, 512) | Out-Null
    if ($sb.ToString() -like "*$TitleLike*") { $script:found = $h; $script:ftitle = $sb.ToString(); return $false }
  }
  return $true
}
[void][SafeClick]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:found -eq [IntPtr]::Zero) { Write-Output "NO_WINDOW"; exit 1 }
$target = $script:found
if ([SafeClick]::IsIconic($target)) { [void][SafeClick]::ShowWindow($target, 9); Start-Sleep -Milliseconds 400 }

$fg = [SafeClick]::GetForegroundWindow()
if ($fg -ne $target) {
  $fgPid = 0
  $null = [SafeClick]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $myThread = [SafeClick]::GetCurrentThreadId()
  $fgThread = [SafeClick]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  [void][SafeClick]::AttachThreadInput($myThread, $fgThread, $true)
  [void][SafeClick]::BringWindowToTop($target)
  [void][SafeClick]::SetForegroundWindow($target)
  [void][SafeClick]::AttachThreadInput($myThread, $fgThread, $false)
  Start-Sleep -Milliseconds 350
}
if ([SafeClick]::GetForegroundWindow() -ne $target) {
  Write-Output "FOREGROUND_FAILED (refusing to click: the click would land on another window)"
  exit 2
}
Write-Output ("TITLE " + $script:ftitle)
[void][SafeClick]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 120
# Chromium hit-tests the last mouse-move position; deliver a real move before
# the click or the event can land on whatever was under the cursor before.
[SafeClick]::mouse_event(0x0001, 1, 0, 0, [UIntPtr]::Zero)
[SafeClick]::mouse_event(0x0001, [uint32]4294967295, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
[SafeClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[SafeClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds $DelayMs
Write-Output "CLICKED $X,$Y"
