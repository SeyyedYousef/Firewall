# PowerShell script to fix all Avatar acronym errors

$files = @(
    "src\pages\GroupDashboard\GroupDashboardPage.tsx",
    "src\pages\GroupAnalytics\GroupAnalyticsPage.tsx",
    "src\pages\GroupSettings\GeneralSettingsPage.tsx",
    "src\pages\GroupSettings\GroupBanSettingsPage.tsx",
    "src\pages\GroupSettings\GroupCountLimitSettingsPage.tsx",
    "src\pages\GroupSettings\GroupCustomTextsPage.tsx",
    "src\pages\GroupSettings\GroupMandatoryMembershipPage.tsx",
    "src\pages\GroupSettings\GroupSilenceSettingsPage.tsx"
)

$pattern = 'acronym=\{([^?]+)\?\s*undefined\s*:\s*([^}]+)\}'
$replacement = 'acronym={$1? undefined : ($2 ?? undefined)}'

foreach ($file in $files) {
    $fullPath = Join-Path $PSScriptRoot $file
    if (Test-Path $fullPath) {
        Write-Host "Processing: $file"
        $content = Get-Content $fullPath -Raw
        $newContent = $content -replace $pattern, $replacement
        Set-Content $fullPath -Value $newContent -NoNewline
        Write-Host "Fixed: $file"
    } else {
        Write-Host "Not found: $file" -ForegroundColor Yellow
    }
}

Write-Host "`nAll files processed!" -ForegroundColor Green
