# uia-accessibility-probe.ps1 - read-only probe: can we drive the Electron/Chromium
# window with UI Automation, and does a WM_GETOBJECT(OBJID_CLIENT) nudge turn on
# Chromium accessibility without restarting the app?
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\uia-accessibility-probe.ps1
#   ... -TitleLike "DeepSeek Harness" -NoNudge
#
# What it does (nothing is clicked, nothing is written):
#   1. enumerates visible top-level windows and their child window classes
#   2. counts UIA descendants BEFORE any nudge (baseline)
#   3. sends WM_GETOBJECT with lParam=OBJID_CLIENT to the Chromium render widget
#      (and to the top-level window), the documented way to switch Chromium's
#      accessibility on at runtime
#   4. waits, then counts UIA descendants AGAIN and prints the first 40 nodes
# Output is ASCII on purpose (Windows PowerShell 5.1).
param(
  [string]$TitleLike = "DeepSeek Harness",
  [int]$WaitMs = 1500,
  [switch]$NoNudge
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$sig = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class UiaProbe {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  public const uint WM_GETOBJECT = 0x003D;
  public const uint SMTO_ABORTIFHUNG = 0x0002;
  public static IntPtr OBJID_CLIENT = new IntPtr(-4);
}
"@
Add-Type -TypeDefinition $sig

function Get-Class([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][UiaProbe]::GetClassName($h, $sb, 512)
  return $sb.ToString()
}
function Get-Text([IntPtr]$h) {
  $sb = New-Object System.Text.StringBuilder 512
  [void][UiaProbe]::GetWindowText($h, $sb, 512)
  return $sb.ToString()
}

$script:top = [IntPtr]::Zero
$script:topTitle = ''
$cbTop = [UiaProbe+EnumProc]{
  param($h, $l)
  if ([UiaProbe]::IsWindowVisible($h)) {
    $t = Get-Text $h
    if ($t -like "*$TitleLike*") { $script:top = $h; $script:topTitle = $t; return $false }
  }
  return $true
}
[void][UiaProbe]::EnumWindows($cbTop, [IntPtr]::Zero)

"=== visible top-level windows matching '$TitleLike' ==="
$script:all = New-Object System.Collections.ArrayList
$cbAll = [UiaProbe+EnumProc]{
  param($h, $l)
  if ([UiaProbe]::IsWindowVisible($h)) {
    $pid2 = 0
    [void][UiaProbe]::GetWindowThreadProcessId($h, [ref]$pid2)
    [void]$script:all.Add(("0x{0:X} pid={1} class={2} title=[{3}]" -f $h.ToInt64(), $pid2, (Get-Class $h), (Get-Text $h)))
  }
  return $true
}
[void][UiaProbe]::EnumWindows($cbAll, [IntPtr]::Zero)
$script:all | Select-Object -First 30

if ($script:top -eq [IntPtr]::Zero) { "RESULT: NO_WINDOW (title like '$TitleLike')"; exit 1 }
$top = $script:top
""
"=== chosen window 0x{0:X} title=[{1}] ===" -f $top.ToInt64(), $script:topTitle

""
"=== child windows (classes/names) ==="
$widgets = New-Object System.Collections.ArrayList
$cbChild = [UiaProbe+EnumProc]{
  param($h, $l)
  $cls = Get-Class $h
  [void]$script:widgets.Add(("0x{0:X} class={1} name=[{2}]" -f $h.ToInt64(), $cls, (Get-Text $h)))
  return $true
}
[void][UiaProbe]::EnumChildWindows($top, $cbChild, [IntPtr]::Zero)
$script:widgets | Select-Object -First 25

function Measure-Uia([IntPtr]$hwnd, [string]$label) {
  try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
    if ($null -eq $root) { "$label FROMHANDLE_NULL"; return $null }
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $named = 0
    foreach ($el in $all) { try { if ($el.Current.Name -ne '') { $named++ } } catch {} }
    "$label descendants=$($all.Count) named=$named"
    return $all
  } catch {
    "$label UIA_ERROR: $($_.Exception.Message)"
    return $null
  }
}

""
"=== baseline UIA ==="
$before = Measure-Uia $top "before"
if ($before -ne $null) {
  $i = 0
  foreach ($el in $before) {
    if ($i -ge 15) { break }
    try {
      $n = ($el.Current.Name -replace "`r?`n", ' ')
      if ($n.Length -gt 70) { $n = $n.Substring(0, 70) }
      "  [" + $i + "] " + $el.Current.ControlType.ProgrammaticName + " name=[" + $n + "]"
    } catch {}
    $i++
  }
}

if (-not $NoNudge) {
  ""
  "=== nudge: WM_GETOBJECT(OBJID_CLIENT) ==="
  $targets = @($top)
  foreach ($w in $script:widgets) {
    if ($w -match 'Chrome_RenderWidgetHostHWND|Chrome_WidgetWin') {
      $hex = [Convert]::ToInt64(($w -split ' ')[0].Substring(2), 16)
      $targets += [IntPtr]$hex
    }
  }
  $targets = $targets | Select-Object -Unique
  foreach ($h in $targets) {
    $res = [IntPtr]::Zero
    $rc = [UiaProbe]::SendMessageTimeout($h, [UiaProbe]::WM_GETOBJECT, [IntPtr]::Zero, [UiaProbe]::OBJID_CLIENT, [UiaProbe]::SMTO_ABORTIFHUNG, 2000, [ref]$res)
    "  sent to 0x{0:X} -> rc={1} result=0x{2:X}" -f $h.ToInt64(), $rc, $res.ToInt64()
  }
  Start-Sleep -Milliseconds $WaitMs
  ""
  "=== after nudge UIA ==="
  $after = Measure-Uia $top "after"
  if ($after -ne $null) {
    $i = 0
    foreach ($el in $after) {
      if ($i -ge 40) { break }
      try {
        $n = ($el.Current.Name -replace "`r?`n", ' ')
        if ($n.Length -gt 70) { $n = $n.Substring(0, 70) }
        "  [" + $i + "] " + $el.Current.ControlType.ProgrammaticName + " name=[" + $n + "]"
      } catch {}
      $i++
    }
  }
}
""
"RESULT: done"
