param(
  [int]$X,
  [int]$Y,
  [int]$DelayMs = 600
)
$sig = @"
using System;
using System.Runtime.InteropServices;
public class MouseClick {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
Add-Type -TypeDefinition $sig
[void][MouseClick]::SetProcessDPIAware()
[void][MouseClick]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 150
[MouseClick]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)  # LEFTDOWN
Start-Sleep -Milliseconds 60
[MouseClick]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)  # LEFTUP
Start-Sleep -Milliseconds $DelayMs
Write-Output "CLICKED $X,$Y"
