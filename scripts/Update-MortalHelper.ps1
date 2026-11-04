param(
    [Parameter(Mandatory=$true)][string]$PackageDirectory,
    [string]$HelperRoot = 'E:\Apps\KyokuLoopMortalHelper',
    [string]$InstalledDirectory
)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($HelperRoot).TrimEnd('\','/')
function OwnedPath([string]$Path) {
    $full=[IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Path is outside helper root.' }
    $probe=$full
    while ($probe) {
        if (Test-Path -LiteralPath $probe) {
            if (((Get-Item -LiteralPath $probe).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse paths are not supported.' }
        }
        $parent=Split-Path $probe -Parent
        if ($parent -eq $probe) { break }; $probe=$parent
    }
    return $full
}
$package=OwnedPath $PackageDirectory
$next=Get-Content -LiteralPath (Join-Path $package 'package-info.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($next.version -notmatch '^DEV-[0-9]{2}\.[0-9]{2}-[0-9]+$' -or $next.sourceSha -notmatch '^[a-f0-9]{40}$') { throw 'Invalid package metadata.' }
$record=OwnedPath (Join-Path $root 'installed.json')
if ($InstalledDirectory) {
    $target=OwnedPath $InstalledDirectory
    $primary=if (Test-Path -LiteralPath $record) { Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    if ($primary -and (OwnedPath $primary.directory) -eq $target) { $old=$primary }
    else {
        $record=OwnedPath (Join-Path (Split-Path $target -Parent) 'installed-extension.json')
        if (Test-Path -LiteralPath $record) { $old=Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json }
        else { $old=Get-Content -LiteralPath (OwnedPath (Join-Path (Split-Path $target -Parent) 'package-info.json')) -Raw -Encoding UTF8 | ConvertFrom-Json }
    }
} elseif (Test-Path -LiteralPath $record) {
    $old=Get-Content -LiteralPath $record -Raw -Encoding UTF8 | ConvertFrom-Json
    $target=OwnedPath $old.directory
} else {
    $target=OwnedPath (Join-Path $root 'DEV-11.04-20\extension')
    $old=Get-Content -LiteralPath (Join-Path (Split-Path $target -Parent) 'package-info.json') -Raw -Encoding UTF8 | ConvertFrom-Json
}
if ((Split-Path $target -Leaf) -ne 'extension' -or (Split-Path (Split-Path $target -Parent) -Leaf) -notmatch '^DEV-[0-9]{2}\.[0-9]{2}-[0-9]+$') { throw 'Invalid installed extension path.' }
if ($target -eq (Join-Path $package 'extension')) { throw 'The immutable package cannot be its own update target.' }
$names=@('manifest.json','core.js','background.js','inspector.js','content.js','popup.html','popup.js','popup.css','batch.js','payloads.js','app-content.js','diagnostics.js')
if (@($next.files.PSObject.Properties).Count -ne $names.Count -or @($next.files.PSObject.Properties.Name | Where-Object { $_ -notin $names }).Count) { throw 'Unexpected package files.' }
foreach ($name in $names) {
    $hash=$next.files.$name
    if ($hash -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath (Join-Path $package ('extension\'+$name)) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Package hash mismatch.' }
}
$oldNames=@($old.files.PSObject.Properties.Name)
if (-not $oldNames.Count -or @($oldNames | Where-Object { $_ -notin $names }).Count) { throw 'Invalid installed file inventory.' }
if (@(Get-ChildItem -LiteralPath $target -Force | Where-Object { $_.PSIsContainer -or $_.Name -notin $oldNames }).Count) { throw 'Installed folder has unrecognized files; preserving it.' }
foreach ($name in $oldNames) {
    if ((Get-FileHash -LiteralPath (Join-Path $target $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $old.files.$name) { throw 'Installed files changed; preserving them.' }
}
$before=Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$after=Get-Content -LiteralPath (Join-Path $package 'extension\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($before.name -ne $after.name -or $before.key -ne $after.key) { throw 'Extension identity must stay unchanged.' }
if ($after.version_name -ne $next.version) { throw 'Manifest version and package metadata differ.' }
$tag=(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[guid]::NewGuid().ToString('N')
$backup=OwnedPath (Join-Path $root ('backups\'+$tag))
$stage=OwnedPath (Join-Path (Split-Path $target -Parent) ('extension-stage-'+$tag))
New-Item -ItemType Directory -Path $backup,$stage | Out-Null
foreach ($name in $names) { Copy-Item -LiteralPath (Join-Path $package ('extension\'+$name)) -Destination (Join-Path $stage $name) }
foreach ($name in $names) { if ((Get-FileHash -LiteralPath (Join-Path $stage $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $next.files.$name) { throw 'Staged file hash mismatch.' } }
$oldExtension=OwnedPath (Join-Path $backup 'extension')
$savedOld=$false; $switched=$false
try {
    if (Test-Path -LiteralPath $record) { Copy-Item -LiteralPath $record -Destination (Join-Path $backup 'installed.json') }
    [IO.Directory]::Move((OwnedPath $target),(OwnedPath $oldExtension)); $savedOld=$true
    [IO.Directory]::Move((OwnedPath $stage),(OwnedPath $target)); $switched=$true
    $newRecord=@{directory=$target;version=$next.version;sourceSha=$next.sourceSha;files=$next.files;backup=$backup}
    $temp=Join-Path $root ('installed-'+$tag+'.tmp')
    [IO.File]::WriteAllText($temp,($newRecord | ConvertTo-Json -Depth 6),(New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $record) { [IO.File]::Replace($temp,$record,(Join-Path $backup 'installed-replaced.json')) }
    else { [IO.File]::Move($temp,$record) }
} catch {
    if ($switched -and (Test-Path -LiteralPath $target)) { [IO.Directory]::Move((OwnedPath $target),(OwnedPath (Join-Path $backup 'failed-new-extension'))) }
    if ($savedOld -and -not (Test-Path -LiteralPath $target)) { [IO.Directory]::Move((OwnedPath $oldExtension),(OwnedPath $target)) }
    throw
}
@{result='UPDATED_RELOAD_REQUIRED';version=$next.version;sourceSha=$next.sourceSha;directory=$target;backup=$backup;extension_id_path_unchanged=$true} | ConvertTo-Json -Compress
