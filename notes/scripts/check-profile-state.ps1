# check-profile-state.ps1 - READ-ONLY snapshot of the live DSH desktop profile.
#
# Prints, and never writes:
#   * profile files and their timestamps
#   * package.json dependencies + dsh.profile.bundles
#   * whether node_modules\<name> exists and where it points (junction/symlink)
#   * the live Web Host port (found by probing /plugins/events), its release
#     identity, the number of active browser-plugin rows, and whether a given
#     plugin id is among them
#   * the tail of hub.log and the newest .plugin-manager pnpm log
#
# The /plugins/events SSE channel is served by the DSH Web Host on loopback and
# is a read-only window into the live client module graph, so this script can
# confirm "the bundle is active" without using UI Automation.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\check-profile-state.ps1
#   ... -PluginId "@local/my-sidebar"
#   ... -ProfileDir "C:\Users\me\.dsh\profiles\desktop" -Port 25039
#
# Exit code: 0 when PluginId is omitted or present, 1 when PluginId is absent.
param(
  [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
  [string]$PluginId = '',
  [int]$Port = 0
)
$ErrorActionPreference = 'Continue'

function Get-SseProbe([int]$p, [int]$maxBytes = 200000, [int]$timeoutMs = 2000) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', $p)
    $stream = $client.GetStream()
    $stream.ReadTimeout = $timeoutMs
    $request = "GET /plugins/events HTTP/1.1`r`nHost: 127.0.0.1`r`nAccept: text/event-stream`r`nConnection: close`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
    $buffer = New-Object byte[] 8192
    $sb = New-Object System.Text.StringBuilder
    $deadline = (Get-Date).AddMilliseconds($timeoutMs)
    $idle = 0
    while ($sb.Length -lt $maxBytes -and (Get-Date) -lt $deadline) {
      # After the first bytes, a short idle bound ends the snapshot without
      # depending on the stream ever closing (SSE keeps it open).
      if ($sb.Length -gt 0) { $stream.ReadTimeout = 400 }
      try { $read = $stream.Read($buffer, 0, $buffer.Length) } catch { break }
      if ($read -le 0) { $idle++; if ($idle -ge 2) { break } else { continue } }
      $idle = 0
      [void]$sb.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $read))
      if ($sb.ToString() -match 'data: \{"type":"graph".*\}\}') { break }
    }
    return $sb.ToString()
  } catch {
    return ''
  } finally {
    $client.Close()
  }
}

function Find-HostPort {
  # The Desktop Host binds 127.0.0.1 with an ephemeral port (--port 0), and on
  # this machine its LISTENING row is not visible from the agent's netstat
  # (only ESTABLISHED rows of both endpoints are), so collect every loopback
  # port seen in either netstat column and probe each one for the SSE channel.
  $candidates = New-Object System.Collections.ArrayList
  foreach ($line in (netstat -ano)) {
    foreach ($m in [regex]::Matches([string]$line, '127\.0\.0\.1:(\d+)')) {
      $p = [int]$m.Groups[1].Value
      if ($p -le 1024) { continue }
      if (-not $candidates.Contains($p)) { [void]$candidates.Add($p) }
    }
  }
  foreach ($p in $candidates) {
    $text = Get-SseProbe $p
    if ($text -match 'data: \{"type":"graph"') { return @{ port = $p; body = $text } }
  }
  return $null
}

Write-Output "=== profile: $ProfileDir ==="
if (-not (Test-Path $ProfileDir)) { Write-Output 'RESULT: PROFILE_MISSING'; exit 1 }
Get-ChildItem $ProfileDir -Force -File | Sort-Object LastWriteTime |
  Select-Object LastWriteTime, Length, Name | Format-Table -AutoSize | Out-String -Width 200 | Write-Output

$manifestPath = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path $manifestPath)) { Write-Output 'RESULT: MANIFEST_MISSING'; exit 1 }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$bundles = @()
if ($null -ne $manifest.dsh -and $null -ne $manifest.dsh.profile -and $null -ne $manifest.dsh.profile.bundles) {
  $bundles = @($manifest.dsh.profile.bundles)
}

Write-Output '=== package.json dependencies ==='
if ($null -ne $manifest.dependencies) {
  $manifest.dependencies.PSObject.Properties | ForEach-Object { '  {0} = {1}' -f $_.Name, $_.Value }
} else { '  (none)' }

Write-Output "=== dsh.profile.bundles ($($bundles.Count)) ==="
$i = 0
foreach ($b in $bundles) { '  [{0,2}] {1}' -f $i, $b; $i++ }

if ($PluginId -ne '') {
  Write-Output "=== installed package check: $PluginId ==="
  $depValue = ''
  if ($null -ne $manifest.dependencies) {
    $prop = $manifest.dependencies.PSObject.Properties | Where-Object { $_.Name -eq $PluginId }
    if ($null -ne $prop) { $depValue = $prop.Value }
  }
  '  dependency value : {0}' -f $(if ($depValue -eq '') { '(absent)' } else { $depValue })
  '  in bundles list  : {0}' -f ($bundles -contains $PluginId)
  $linkPath = Join-Path (Join-Path $ProfileDir 'node_modules') $PluginId
  if (Test-Path -LiteralPath $linkPath) {
    $item = Get-Item -LiteralPath $linkPath -Force
    $target = ''
    try { $target = @($item.Target)[0] } catch { $target = '?' }
    '  node_modules     : {0} -> {1}' -f $item.LinkType, $target
    if ($item.LinkType -eq '') { '  WARN: node_modules entry is a real directory, not a link' }
  } else {
    '  node_modules     : (absent)'
  }
  $pkgJson = Join-Path $linkPath 'package.json'
  if (Test-Path -LiteralPath $pkgJson) {
    try {
      $plugin = Get-Content -LiteralPath $pkgJson -Raw | ConvertFrom-Json
      '  package name/ver : {0} {1}' -f $plugin.name, $plugin.version
      if ($null -ne $plugin.dsh -and $null -ne $plugin.dsh.bundle) {
        '  dsh.bundle.patch : {0}' -f ($plugin.dsh.bundle.patch -join ', ')
      } else {
        '  WARN: package has no dsh.bundle.patch -> it is not a bundle'
      }
      if ($null -ne $plugin.dsh -and $null -ne $plugin.dsh.client) {
        '  dsh.client       : platform={0} immediately={1}' -f $plugin.dsh.client.platform, $plugin.dsh.client.immediately
      } else {
        '  dsh.client       : (none; host-only plugin)'
      }
    } catch { '  WARN: cannot parse plugin package.json' }
  }
}

Write-Output '=== live Web Host ==='
$found = $null
if ($Port -gt 0) {
  $text = Get-SseProbe $Port
  if ($text -match 'data: \{"type":"graph"') { $found = @{ port = $Port; body = $text } }
} else {
  $found = Find-HostPort
}
if ($null -eq $found) {
  '  no /plugins/events responder found on 127.0.0.1 listening ports'
  '  (the Desktop Host port is random per launch; it is passed to the window as streamBaseUrl)'
} else {
  '  port             : {0}' -f $found.port
  $body = $found.body
  $release = [regex]::Match($body, '"release":\{"version":"([^"]+)","commit":"([^"]+)"')
  if ($release.Success) { '  release          : {0} commit {1}' -f $release.Groups[1].Value, $release.Groups[2].Value }
  $ids = @([regex]::Matches($body, '"id":"([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
  '  active client rows: {0}' -f $ids.Count
  if ($PluginId -ne '') {
    if ($ids -contains $PluginId) {
      '  PLUGIN_ACTIVE    : YES ({0})' -f $PluginId
    } else {
      '  PLUGIN_ACTIVE    : NO ({0} not in the graph)' -f $PluginId
    }
  }
  $sample = $ids | Select-Object -First 8
  '  sample ids       : {0}' -f ($sample -join ', ')
}

Write-Output '=== hub.log (last 2 lines; Plugin Hub, not the DSH plugin manager) ==='
$hub = Join-Path $ProfileDir 'hub.log'
if (Test-Path $hub) { Get-Content $hub -Tail 2 -Encoding UTF8 | ForEach-Object { '  ' + $_ } } else { '  (absent)' }

Write-Output '=== newest .plugin-manager pnpm log ==='
$logRoot = Join-Path $ProfileDir '.plugin-manager\logs'
if (Test-Path $logRoot) {
  $latest = Get-ChildItem $logRoot -Recurse -Filter 'pnpm.log' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -ne $latest) { '  {0} ({1} bytes)' -f $latest.FullName, $latest.Length }
} else { '  (absent)' }

if ($PluginId -ne '') {
  if ($null -eq $found) { Write-Output 'RESULT: PLUGIN_STATE_UNKNOWN (host SSE channel not found)'; exit 2 }
  $ids = @([regex]::Matches($found.body, '"id":"([^"]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
  if ($ids -contains $PluginId) { Write-Output 'RESULT: PLUGIN_ACTIVE'; exit 0 }
  Write-Output 'RESULT: PLUGIN_NOT_ACTIVE'; exit 1
}
Write-Output 'RESULT: OK'
exit 0
