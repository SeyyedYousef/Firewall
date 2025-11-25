# PowerShell script to fix ALL Avatar acronym errors in the project

Write-Host "Starting Avatar acronym fixes..." -ForegroundColor Cyan

# Find all .tsx files that contain Avatar components with acronym props
$files = Get-ChildItem -Path "src" -Filter "*.tsx" -Recurse | Where-Object { 
    $content = Get-Content $_.FullName -Raw
    $content -match 'acronym=\{[^}]*\?\s*undefined\s*:\s*[^}]*\}' -and $content -notmatch 'acronym=\{[^}]*\?\s*undefined\s*:\s*\([^}]*\?\?\s*undefined\)'
}

$fixedCount = 0
$totalFiles = $files.Count

Write-Host "Found $totalFiles files to fix" -ForegroundColor Yellow

foreach ($file in $files) {
    Write-Host "`nProcessing: $($file.FullName)" -ForegroundColor White
    
    $content = Get-Content $file.FullName -Raw
    $originalContent = $content
    
    # Pattern 1: acronym={something ? undefined : initialsFromTitle(something)}
    $content = $content -replace 'acronym=\{([^?]+)\?\s*undefined\s*:\s*initialsFromTitle\(([^)]+)\)\}', 'acronym={$1? undefined : (initialsFromTitle($2) ?? undefined)}'
    
    # Pattern 2: acronym={photoUrl ? undefined : acronym}
    $content = $content -replace 'acronym=\{([^?]+)\?\s*undefined\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)\}', 'acronym={$1? undefined : ($2 ?? undefined)}'
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $fixedCount++
        Write-Host "  Fixed!" -ForegroundColor Green
    } else {
        Write-Host "  - No changes needed" -ForegroundColor Gray
    }
}

Write-Host "`nFixed $fixedCount out of $totalFiles files" -ForegroundColor Green
