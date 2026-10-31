[CmdletBinding()]
param(
    [string]$InstallDir = 'C:\LaosanApps\fuckseats'
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallDir)
$exe = Join-Path $root 'FuckSeats.exe'
if (!(Test-Path -LiteralPath $exe -PathType Leaf)) {
    throw "FuckSeats.exe not found in: $root"
}

# Only stop this installation, never an unrelated application or another copy.
Get-Process -Name FuckSeats -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Path -and [string]::Equals($_.Path, $exe, [StringComparison]::OrdinalIgnoreCase)) {
        Stop-Process -Id $_.Id
        if (!$_.WaitForExit(10000)) { throw 'Please exit FuckSeats and run this script again.' }
    }
}

$count = 0
$backupRoot = Join-Path $root ('repair-backups\' + [guid]::NewGuid().ToString('N'))
foreach ($layout in @('_internal\django', 'django')) {
    $tags = Join-Path $root "$layout\contrib\admin\templatetags"
    $source = Join-Path $tags 'admin_filters.py'
    # This retired module is the specific source of the EMPTY_VALUE_STRING error.
    # Leave unknown files and all databases/plugins untouched.
    if (!(Test-Path -LiteralPath $source -PathType Leaf)) { continue }
    if ((Get-Content -LiteralPath $source -Raw) -notmatch 'from\s+django\.contrib\.admin\.options\s+import\s+EMPTY_VALUE_STRING') {
        continue
    }
    $files = @($source)
    $legacyBytecode = Join-Path $tags 'admin_filters.pyc'
    if (Test-Path -LiteralPath $legacyBytecode -PathType Leaf) { $files += $legacyBytecode }
    $cache = Join-Path $tags '__pycache__'
    if (Test-Path -LiteralPath $cache -PathType Container) {
        $files += @(Get-ChildItem -LiteralPath $cache -Filter 'admin_filters.*.pyc' -File | ForEach-Object { $_.FullName })
    }
    foreach ($file in $files) {
        $relative = $file.Substring($root.TrimEnd('\').Length).TrimStart('\')
        $backup = Join-Path $backupRoot $relative
        New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
        Move-Item -LiteralPath $file -Destination $backup
        $count++
    }
}
if ($count -gt 0) {
    Write-Host "Repaired $count stale Django files. Backup: $backupRoot"
    Write-Host 'You can now start FuckSeats. Your databases and plugins were not modified.'
} else {
    Write-Host 'No matching stale Django files found. If the error persists, reinstall the latest installer.'
}
