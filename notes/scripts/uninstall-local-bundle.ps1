# uninstall-local-bundle.ps1 - clean rollback of install-local-bundle.ps1.
#
# Default mode is -DryRun: prints what would be removed.
# -Apply performs:
#   1. remove <profile>\node_modules\<name> only when it is a junction/symlink
#      pointing at -PluginDir (a real directory is never touched)
#   2. drop <name> from dsh.profile.bundles and drop the dependency entry only
#      when its recorded value is a link:/file: spec
# A backup of package.json / pnpm-lock.yaml / cordis.patch.yml is written to
# %TEMP% before the edit. If a previous install backup directory is known, use
# -RestoreFrom to put package.json back verbatim instead of editing it.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\uninstall-local-bundle.ps1 -Name "@local/my-sidebar"
#   ... -Name "@local/my-sidebar" -PluginDir D:\ai2all\projects\personal\dsh-2sider\plugin -Apply
#   ... -Name "@local/my-sidebar" -RestoreFrom "C:\Users\me\AppData\Local\Temp\dsh-profile-backup-20261024-161500" -Apply
#
# ASCII only (Windows PowerShell 5.1).
param(
  [Parameter(Mandatory=$true)][string]$Name,
  [string]$PluginDir = '',
  [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
  [string]$RestoreFrom = '',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $cmd) { return $cmd.Source }
  $bundled = 'D:\apps\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path $bundled) { return $bundled }
  throw 'node.exe not found (PATH or the Desktop bundled runtime)'
}

$profile = (Resolve-Path -LiteralPath $ProfileDir).Path
$manifestPath = Join-Path $profile 'package.json'
if (-not (Test-Path $manifestPath)) { throw "no profile package.json in $profile" }
$linkPath = Join-Path (Join-Path $profile 'node_modules') $Name

$linkType = ''
$linkTarget = ''
if (Test-Path -LiteralPath $linkPath) {
  $item = Get-Item -LiteralPath $linkPath -Force
  $linkType = $item.LinkType
  try { $linkTarget = @($item.Target)[0] } catch { $linkTarget = '' }
}

Write-Output '=== plan ==='
Write-Output "  profile      : $profile"
Write-Output "  name         : $Name"
Write-Output "  node_modules : $(if (Test-Path -LiteralPath $linkPath) { "$linkType -> $linkTarget" } else { '(absent)' })"
if ($RestoreFrom -ne '') { Write-Output "  restore      : package.json from $RestoreFrom" }

$removeLink = $false
if (Test-Path -LiteralPath $linkPath) {
  if ($linkType -eq 'Junction' -or $linkType -eq 'SymbolicLink') {
    if ($PluginDir -ne '') {
      $resolved = (Resolve-Path -LiteralPath $PluginDir).Path
      if ($linkTarget -ne $resolved) { throw "node_modules\$Name points at $linkTarget, not $resolved; pass the matching -PluginDir or remove it manually" }
    }
    $removeLink = $true
  } else {
    throw "node_modules\$Name is a real directory (not a link); refusing to delete it. Use 'dsh plugin --profile desktop remove $Name' instead."
  }
}

if (-not $Apply) {
  Write-Output ''
  Write-Output '=== DRY RUN (nothing written) ==='
  Write-Output ("would remove link: {0}" -f $removeLink)
  Write-Output 'Re-run with -Apply to roll back.'
  exit 0
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:TEMP ("dsh-profile-backup-" + $stamp)
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($f in 'package.json', 'pnpm-lock.yaml', 'cordis.patch.yml') {
  $src = Join-Path $profile $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $backup $f) }
}
Write-Output "backup: $backup"

if ($removeLink) {
  # cmd rmdir removes the reparse point only; it never recurses into the target.
  & cmd.exe /c rmdir "$linkPath" | Out-Null
  if (Test-Path -LiteralPath $linkPath) { throw "could not remove junction $linkPath" }
  Write-Output "removed junction: $linkPath"
}

$restoredPath = Join-Path $RestoreFrom 'package.json'
if ($RestoreFrom -ne '' -and (Test-Path $restoredPath)) {
  Copy-Item $restoredPath $manifestPath -Force
  Write-Output "restored package.json from $restoredPath"
} else {
  $node = Find-Node
  $editor = Join-Path $PSScriptRoot 'profile-manifest.mjs'
  & $node $editor remove-bundle $profile $Name
  if ($LASTEXITCODE -ne 0) { throw 'profile-manifest.mjs failed; restore package.json from ' + $backup }
}

Start-Sleep -Seconds 3
Write-Output 'Verifying the live client plugin graph...'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-profile-state.ps1') -ProfileDir $profile -PluginId $Name
Write-Output "Backup: $backup"
