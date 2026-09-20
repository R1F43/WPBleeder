<#
.SYNOPSIS
    Build WPBleeder extension for Chrome or Firefox (no Node.js required)
.USAGE
    .\build.ps1 chrome
    .\build.ps1 firefox
#>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('chrome','firefox')]
    [string]$Target
)

Write-Host "Building WPBleeder for $Target..." -ForegroundColor Cyan

$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$srcDir = Join-Path $rootDir "src"
$distDir = Join-Path (Join-Path $rootDir "dist") $Target

# 1. Clean/create dist
if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
New-Item -ItemType Directory -Path $distDir -Force | Out-Null

# 2. Merge manifests
Write-Host "Merging manifests..."
$commonManifest = Get-Content (Join-Path $srcDir "manifest\manifest.common.json") -Raw | ConvertFrom-Json
$targetManifest = Get-Content (Join-Path $srcDir "manifest\manifest.$Target.json") -Raw | ConvertFrom-Json

function Merge-Object($base, $overlay) {
    $result = $base.PSObject.Copy()
    foreach ($prop in $overlay.PSObject.Properties) {
        $existing = $result.PSObject.Properties[$prop.Name]
        if ($existing -and $existing.Value -is [PSCustomObject] -and $prop.Value -is [PSCustomObject]) {
            $result.($prop.Name) = Merge-Object $existing.Value $prop.Value
        } elseif ($existing -and ($existing.Value -is [System.Array] -or $existing.Value -is [System.Collections.ArrayList]) -and ($prop.Value -is [System.Array] -or $prop.Value -is [System.Collections.ArrayList])) {
            $result.($prop.Name) = @($existing.Value + $prop.Value | Select-Object -Unique)
        } else {
            if ($existing) {
                $result.($prop.Name) = $prop.Value
            } else {
                $result | Add-Member -NotePropertyName $prop.Name -NotePropertyValue $prop.Value
            }
        }
    }
    return $result
}

$merged = Merge-Object $commonManifest $targetManifest
$merged | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $distDir "manifest.json") -Encoding UTF8
Write-Host "  manifest.json written"

# 3. Copy directories
$dirs = @(
    @{ Src="src\background"; Dest="background" },
    @{ Src="src\content"; Dest="content" },
    @{ Src="src\panel"; Dest="panel" },
    @{ Src="src\options"; Dest="options" },
    @{ Src="src\platform"; Dest="platform" },
    @{ Src="src\lib"; Dest="lib" },
    @{ Src="data"; Dest="data" },
    @{ Src="icons"; Dest="icons" }
)

Write-Host "Copying files..."
foreach ($d in $dirs) {
    $source = Join-Path $rootDir $d.Src
    $destination = Join-Path $distDir $d.Dest
    if (Test-Path $source) {
        Copy-Item -Recurse -Force $source $destination
        $count = (Get-ChildItem -Recurse -File $destination).Count
        Write-Host "  $($d.Dest)/ ($count files)"
    }
}

Write-Host ""
Write-Host "Build complete! Load extension from:" -ForegroundColor Green
Write-Host "  $distDir" -ForegroundColor Yellow
Write-Host ""
if ($Target -eq "chrome") {
    Write-Host "Chrome: chrome://extensions -> Developer mode -> Load unpacked -> select dist\chrome"
} else {
    Write-Host "Firefox: about:debugging -> This Firefox -> Load Temporary Add-on -> select dist\firefox\manifest.json"
}
