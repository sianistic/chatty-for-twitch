$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$distDirectory = Join-Path $projectRoot "dist"
$archivePath = Join-Path $distDirectory "chatty-for-twitch.zip"

New-Item -ItemType Directory -Force -Path $distDirectory | Out-Null
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath
}

$items = @(
    (Join-Path $projectRoot "manifest.json"),
    (Join-Path $projectRoot "assets"),
    (Join-Path $projectRoot "src")
)
Compress-Archive -Path $items -DestinationPath $archivePath -CompressionLevel Optimal
Write-Output $archivePath
