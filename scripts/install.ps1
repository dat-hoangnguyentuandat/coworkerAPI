$ErrorActionPreference = 'Stop'

$repo = 'dat-hoangnguyentuandat/coworkerAPI'
$releaseRef = if ($env:COWORKERAPI_REF) { $env:COWORKERAPI_REF } else { 'main' }
$configRoot = if ($env:COWORKERAPI_CONFIG_DIR) { $env:COWORKERAPI_CONFIG_DIR } else { Join-Path $env:LOCALAPPDATA 'coworkerapi' }
$appRoot = Join-Path $configRoot 'app'
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ("coworkerapi-install-" + [guid]::NewGuid().ToString('N'))
$archive = Join-Path $stagingRoot 'source.zip'

function Fail([string]$Message) { throw "CoworkerAPI installation failed: $Message" }

try {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Node.js 22.14 or newer is required. Install it from https://nodejs.org/.' }
  $nodeVersion = (node --version).Trim().TrimStart('v')
  $parts = $nodeVersion.Split('.')
  $nodeMajor = [int]$parts[0]; $nodeMinor = [int]$parts[1]
  if ($nodeMajor -lt 22 -or ($nodeMajor -eq 22 -and $nodeMinor -lt 14)) { Fail "Node.js 22.14 or newer is required; found $nodeVersion." }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail 'npm was not found in PATH.' }

  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  $downloadUrl = "https://codeload.github.com/$repo/zip/refs/heads/$releaseRef"
  Write-Host "Downloading CoworkerAPI ($releaseRef)..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $archive -UseBasicParsing
  Expand-Archive -LiteralPath $archive -DestinationPath $stagingRoot -Force
  $dashboard = Get-ChildItem -LiteralPath $stagingRoot -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'coworkerAPI-dashboard/package.json') } | Select-Object -First 1
  if (-not $dashboard) { Fail 'The downloaded archive does not contain coworkerAPI-dashboard.' }
  $source = Join-Path $dashboard.FullName 'coworkerAPI-dashboard'

  New-Item -ItemType Directory -Path $configRoot -Force | Out-Null
  $deploy = Join-Path $stagingRoot 'deploy'
  New-Item -ItemType Directory -Path $deploy -Force | Out-Null
  Copy-Item -Path (Join-Path $source '*') -Destination $deploy -Recurse -Force
  New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $appRoot -Force | Where-Object { $_.Name -notin @('.env','data') } | Remove-Item -Recurse -Force
  Copy-Item -Path (Join-Path $deploy '*') -Destination $appRoot -Recurse -Force

  Push-Location $appRoot
  try { npm ci; npm run build } finally { Pop-Location }

  $globalPrefix = (npm prefix -g).Trim()
  if (-not $globalPrefix) { Fail 'Could not locate the global npm command directory.' }
  $nodeScript = Join-Path $appRoot 'bin/coworkerapi.mjs'
  Set-Content -LiteralPath (Join-Path $globalPrefix 'coworkerapi.cmd') -Encoding ASCII -Value "@echo off`r`nnode `"$nodeScript`" %*`r`n"
  Set-Content -LiteralPath (Join-Path $globalPrefix 'coworkerapi.ps1') -Encoding UTF8 -Value "& node `"$nodeScript`" `$args`r`n"
  Write-Host "CoworkerAPI installed to $appRoot"
  Write-Host 'Run: coworkerapi'
} finally {
  if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
