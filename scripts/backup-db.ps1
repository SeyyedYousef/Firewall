$ErrorActionPreference = "Stop"

param(
  [string]$OutputDir = "backups"
)

if (-not $Env:DATABASE_URL) {
  Write-Error "DATABASE_URL environment variable is required."
}

$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
if (-not (Test-Path -Path $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$outputPath = Join-Path $OutputDir ("tgfirewall-{0}.sql" -f $timestamp)
Write-Host "Creating database backup at $outputPath"

& pg_dump --no-owner --file="$outputPath" $Env:DATABASE_URL

Write-Host "Backup complete."
