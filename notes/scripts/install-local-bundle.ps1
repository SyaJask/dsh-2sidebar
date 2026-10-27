# install-local-bundle.ps1 - put a local bundle directory into the live DSH
# desktop profile WITHOUT running pnpm, then let DSH HMR activate it.
#
# Default mode is -DryRun: it only reads and prints the exact plan.
# -Apply performs three writes (all under the profile; none in the plugin dir):
#   1. backup profile package.json / pnpm-lock.yaml / cordis.patch.yml to %TEMP%
#   2. create <profile>\node_modules\<name> as a directory junction to the plugin
#      directory (equivalent to what `pnpm add link:<dir>` links, but it does not
#      re-resolve or prune the existing node_modules tree)
#   3. add dependencies[<name>] = "link:<dir>" and append <name> to
#      dsh.profile.bundles (this is what triggers the Host HMR reload)
#
# Everything here needs the user's approval: the DSH file policy confines agent
# processes to the workspace, and C:\Users\<me>\.dsh is outside it.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\install-local-bundle.ps1 -PluginDir D:\ai2all\projects\personal\dsh-2sidebar\plugin
#   ... -PluginDir <dir> -Apply
#   ... -PluginDir <dir> -Apply -ProfileDir "C:\Users\k\.dsh\profiles\desktop"
#
# ASCII only (Windows PowerShell 5.1).
param(
  [Parameter(Mandatory=$true)][string]$PluginDir,
  [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
  [string]$Name = '',
  [string]$LinkSpec = '',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $cmd) { return $cmd.Source }
  $bundled = 'D:\apps\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path $bundled) { return $bundled }
  throw 'node.exe not found (PATH or the Desktop bundled runtime); needed to edit profile package.json'
}

$plugin = (Resolve-Path -LiteralPath $PluginDir).Path
$profile = (Resolve-Path -LiteralPath $ProfileDir).Path
$manifestPath = Join-Path $plugin 'package.json'
if (-not (Test-Path $manifestPath)) { throw "no package.json in $plugin" }
$pkg = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($pkg.name)) { throw 'plugin package.json has no name' }
$pkgName = $pkg.name
if ([string]::IsNullOrWhiteSpace($Name)) { $Name = $pkgName }
if ($Name -ne $pkgName) { Write-Output ("NOTE: -Name $Name differs from package name $pkgName; the bundle row must use the package name") }

if ([string]::IsNullOrWhiteSpace($LinkSpec)) {
  $LinkSpec = 'link:' + ($plugin -replace '\\', '/')
}

Write-Output "=== plan ==="
Write-Output "  plugin dir   : $plugin"
Write-Output "  package      : $pkgName $($pkg.version)"
Write-Output "  profile dir  : $profile"
Write-Output "  dependency   : $Name = $LinkSpec"
Write-Output "  bundle rows  : append $Name to dsh.profile.bundles"

# --- static checks -----------------------------------------------------------
$bundlePatch = $null
if ($null -ne $pkg.dsh -and $null -ne $pkg.dsh.bundle) { $bundlePatch = $pkg.dsh.bundle.patch }
if ($null -eq $bundlePatch) {
  throw "package has no dsh.bundle.patch -> DSH will treat it as a plain dependency, not a profile layer (see ref\preset-skills\cordis-plugin-development\references\host-plugin.md:5)"
}
$patchFiles = @()
if ($bundlePatch -is [string]) { $patchFiles = @($bundlePatch) } else { $patchFiles = @($bundlePatch) }
foreach ($rel in $patchFiles) {
  $full = Join-Path $plugin $rel
  if (-not (Test-Path -LiteralPath $full)) { throw "dsh.bundle.patch points at a missing file: $rel" }
  Write-Output "  patch file   : $full OK"
}

$hasClient = $false
if ($null -ne $pkg.dsh -and $null -ne $pkg.dsh.client) { $hasClient = $true }
if ($hasClient) {
  $platform = $pkg.dsh.client.platform
  Write-Output "  dsh.client   : platform=$platform immediately=$($pkg.dsh.client.immediately)"
  if ($platform -ne 'web') { Write-Output '  WARN: only platform "web" is served to this Desktop window' }
  if ($null -eq $pkg.exports -or $null -eq $pkg.exports.'./client') {
    Write-Output '  WARN: no exports["./client"] entry -> the browser half may not load'
  }
  $iconOk = $false
  if ($null -ne $pkg.icon) { $iconOk = $true }
  if ($null -ne $pkg.exports -and $null -ne $pkg.exports.'./icon') { $iconOk = $true }
  if (-not $iconOk) { Write-Output '  WARN: no icon (package.json icon or exports["./icon"]); Plugin Manager shows default artwork' }
  $localeOk = $false
  if ($null -ne $pkg.exports) {
    foreach ($p in $pkg.exports.PSObject.Properties) { if ($p.Name -like './locale/*.json') { $localeOk = $true } }
  }
  if (-not $localeOk) { Write-Output '  WARN: no exports["./locale/*.json"]; meta.title/meta.description will fall back to package name/description' }
}
if ($null -ne $pkg.peerDependencies) {
  $dshPeers = @($pkg.peerDependencies.PSObject.Properties | Where-Object { $_.Name -like '@deepseek-ai/dsh*' })
  if ($dshPeers.Count -gt 0) {
    Write-Output '  WARN: dsh peerDependencies are subject to the compatibility gate; a local bundle normally needs none'
  }
}
if ($null -ne $pkg.dependencies -and @($pkg.dependencies.PSObject.Properties).Count -gt 0) {
  Write-Output '  WARN: the junction route does not install the plugin''s own dependencies; only its existing dependencies resolve'
}

$linkPath = Join-Path (Join-Path $profile 'node_modules') $Name
if (Test-Path -LiteralPath $linkPath) {
  $item = Get-Item -LiteralPath $linkPath -Force
  $target = ''
  try { $target = @($item.Target)[0] } catch { $target = '?' }
  Write-Output "  node_modules : exists ($($item.LinkType) -> $target)"
  if ($target -ne $plugin) { throw "node_modules\$Name already exists and does not point at $plugin; refusing to overwrite" }
} else {
  Write-Output '  node_modules : (will be created as a junction)'
}

if (-not (Test-Path (Join-Path $profile 'package.json'))) { throw "no profile package.json in $profile" }

if (-not $Apply) {
  Write-Output ''
  Write-Output '=== DRY RUN (nothing written) ==='
  Write-Output 'Re-run with -Apply to create the junction and update the profile manifest.'
  Write-Output ''
  Write-Output 'Equivalent official command (runs pnpm in the profile, rewrites node_modules/lockfile):'
  Write-Output ("  & ""D:\apps\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd"" plugin --profile desktop add ""{0}""" -f $LinkSpec)
  exit 0
}

# --- apply -------------------------------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:TEMP ("dsh-profile-backup-" + $stamp)
New-Item -ItemType Directory -Path $backup | Out-Null
foreach ($f in 'package.json', 'pnpm-lock.yaml', 'cordis.patch.yml') {
  $src = Join-Path $profile $f
  if (Test-Path $src) { Copy-Item $src (Join-Path $backup $f); Write-Output "backup: $(Join-Path $backup $f)" }
}
@{ pluginDir = $plugin; name = $Name; linkSpec = $LinkSpec; profileDir = $profile } |
  ConvertTo-Json | Set-Content -Path (Join-Path $backup 'install-state.json') -Encoding ASCII

if (-not (Test-Path -LiteralPath $linkPath)) {
  $parent = Split-Path $linkPath -Parent
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  New-Item -ItemType Junction -Path $linkPath -Target $plugin | Out-Null
  Write-Output "created junction: $linkPath -> $plugin"
}

$node = Find-Node
$editor = Join-Path $PSScriptRoot 'profile-manifest.mjs'
& $node $editor add-bundle $profile $Name $LinkSpec
if ($LASTEXITCODE -ne 0) { throw 'profile-manifest.mjs failed; restore package.json from ' + $backup }

Write-Output ''
Write-Output 'Applied. The Host HMR watches the profile manifest: a changed dsh.profile.bundles list reloads the profile in place.'
Start-Sleep -Seconds 3
Write-Output 'Verifying the live client plugin graph...'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-profile-state.ps1') -ProfileDir $profile -PluginId $Name
Write-Output ''
Write-Output "Backup: $backup"
Write-Output 'Undo with: powershell -NoProfile -ExecutionPolicy Bypass -File notes\scripts\uninstall-local-bundle.ps1 -Name ' + $Name + ' -Apply'
