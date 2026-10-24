param(
  [string]$TitleLike = "DeepSeek Harness",
  [int]$MaxDepth = 40,
  [string]$Filter = ""
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class UiaWin {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$script:hwnd = [IntPtr]::Zero
$cb = [UiaWin+EnumWindowsProc]{ param($h, $l)
  if ([UiaWin]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 512
    [UiaWin]::GetWindowText($h, $sb, 512) | Out-Null
    if ($sb.ToString() -like "*$TitleLike*") { $script:hwnd = $h; $script:title = $sb.ToString(); return $false }
  }
  return $true
}
[void][UiaWin]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:hwnd -eq [IntPtr]::Zero) { Write-Output "NO_WINDOW"; exit 1 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($script:hwnd)
if ($null -eq $root) { Write-Output "NO_UIA_ROOT"; exit 1 }
Write-Output "WINDOW $($script:title)"

$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$lines = New-Object System.Collections.ArrayList
function Walk($el, $depth) {
  if ($depth -gt $MaxDepth) { return }
  try {
    $info = $el.Current
    $name = ($info.Name -replace "`r?`n", " ")
    if ($name.Length -gt 100) { $name = $name.Substring(0, 100) }
    $type = $info.ControlType.ProgrammaticName
    $type = $type -replace 'ControlType\.', ''
    $auto = $info.AutomationId
    $pad = ' ' * ($depth * 2)
    $line = $pad + $type + ' enabled=' + $info.IsEnabled + ' id=[' + $auto + '] name=[' + $name + ']'
    if ($Filter -eq "" -or $line -match $Filter) { [void]$lines.Add($line) }
    $child = $walker.GetFirstChild($el)
    while ($null -ne $child) {
      Walk $child ($depth + 1)
      $child = $walker.GetNextSibling($child)
    }
  } catch { }
}
Walk $root 0
$lines | ForEach-Object { $_ }
Write-Output ("# lines=" + $lines.Count)
