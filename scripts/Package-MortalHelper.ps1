param([string]$DestinationRoot = 'E:\Apps\KyokuLoopMortalHelper')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $repo 'extensions\mortal-helper'
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version_name
if ($version -notmatch '^DEV-[0-9]{2}\.[0-9]{2}-[0-9]+$') { throw 'Invalid helper version.' }
$sha = (git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify source commit.' }
$dirty = git -C $repo status --porcelain --untracked-files=all -- extensions/mortal-helper scripts/Package-MortalHelper.ps1 scripts/Update-MortalHelper.ps1
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit the helper and packaging script before exporting.' }
$target = [IO.Path]::GetFullPath((Join-Path $DestinationRoot $version))
if (Test-Path -LiteralPath $target) { throw "Package already exists; refusing to overwrite: $target" }
$extension = Join-Path $target 'extension'
New-Item -ItemType Directory -Path $extension -Force | Out-Null
$names = @('manifest.json','core.js','background.js','inspector.js','content.js','popup.html','popup.js','popup.css','batch.js','payloads.js','app-content.js')
$hashes = @{}
foreach ($name in $names) {
    $from = Join-Path $source $name; $to = Join-Path $extension $name
    Copy-Item -LiteralPath $from -Destination $to
    $hash = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash.ToLowerInvariant()
    if ((Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Package hash mismatch.' }
    $hashes[$name] = $hash
}
$guide = (Get-Content -LiteralPath (Join-Path $source 'README.html') -Raw -Encoding UTF8).Replace('{{EXTENSION_DIRECTORY}}', [Net.WebUtility]::HtmlEncode($extension))
[IO.File]::WriteAllText((Join-Path $target 'README.html'), $guide, (New-Object Text.UTF8Encoding($false)))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Update-MortalHelper.ps1') -Destination (Join-Path $target 'Update-MortalHelper.ps1')
@{version=$version;sourceSha=$sha;files=$hashes;status='SYNTHETIC_VERIFIED_REAL_SITE_PENDING'} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'package-info.json') -Encoding UTF8
$archive = Join-Path $target ('KyokuLoop-Mortal-Helper-' + $version + '.zip')
Compress-Archive -LiteralPath @($extension,(Join-Path $target 'README.html'),(Join-Path $target 'package-info.json'),(Join-Path $target 'Update-MortalHelper.ps1')) -DestinationPath $archive
@{result='PACKAGED';version=$version;sourceSha=$sha;directory=$target;extension=$extension;archive=$archive} | ConvertTo-Json -Compress
