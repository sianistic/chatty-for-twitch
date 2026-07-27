$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot "assets\chatty-logo.png"
$outputDirectory = Join-Path $projectRoot "assets\icons"
$sizes = @(16, 32, 48, 128)

if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Missing canonical logo: $sourcePath"
}

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$source = [System.Drawing.Image]::FromFile($sourcePath)

try {
    foreach ($size in $sizes) {
        $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $bitmap.SetResolution(96, 96)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
                $drawWidth = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
                $drawHeight = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
                $drawX = [int][Math]::Floor(($size - $drawWidth) / 2)
                $drawY = [int][Math]::Floor(($size - $drawHeight) / 2)
                $graphics.DrawImage($source, $drawX, $drawY, $drawWidth, $drawHeight)
            }
            finally {
                $graphics.Dispose()
            }

            $outputPath = Join-Path $outputDirectory "chatty-$size.png"
            $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output $outputPath
        }
        finally {
            $bitmap.Dispose()
        }
    }
}
finally {
    $source.Dispose()
}
