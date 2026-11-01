param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$ExpectedSha,
    [string]$InstallRoot = 'E:\Apps\KyokuLoop',
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskInstall = [IO.Path]::GetFullPath($InstallRoot)
if (-not $taskInstall.StartsWith('E:\',[StringComparison]::OrdinalIgnoreCase) -or $taskInstall.StartsWith([IO.Path]::GetFullPath($taskRepo),[StringComparison]::OrdinalIgnoreCase)) { throw 'Use an independent installation on E:.' }
$taskMutex = New-Object Threading.Mutex($false,'Local\KyokuLoop-Daily-Deploy')
$taskLocked = $false
try {
    $taskLocked = $taskMutex.WaitOne(0)
    if (-not $taskLocked) { throw 'Another deployment is running.' }
    $remote = git -C $taskRepo ls-remote origin refs/heads/main
    if ($LASTEXITCODE -ne 0 -or (($remote -split '\s+')[0] -ne $ExpectedSha)) { throw 'GitHub main does not match the expected SHA.' }
    git -C $taskRepo fetch origin main
    if ($LASTEXITCODE -ne 0) { throw 'Fetch failed.' }
    $actual = git -C $taskRepo rev-parse origin/main
    if ($LASTEXITCODE -ne 0 -or $actual.Trim() -ne $ExpectedSha) { throw 'Fetched main changed.' }
    $sourceVersion = git -C $taskRepo show ($ExpectedSha+':src/version.ts')
    if ($LASTEXITCODE -ne 0 -or ($sourceVersion -join "`n") -notmatch 'DEVELOPMENT_VERSION = "DEV-([0-9]{2}\.[0-9]{2}-[0-9]+)"') { throw 'Missing version.' }
    $version = $Matches[1]; $releaseName = $version+'-'+$ExpectedSha.Substring(0,12)
    $releaseFolder = Join-Path (Join-Path $taskInstall 'releases') $releaseName
    $owner = Join-Path $taskInstall 'installation.json'
    if (Test-Path -LiteralPath $taskInstall) {
        if (-not (Test-Path -LiteralPath $owner) -or (Get-Content -LiteralPath $owner -Raw | ConvertFrom-Json).app -ne 'kyoku-loop') { throw 'Unknown installation directory; existing files were retained.' }
    } else {
        $null = New-Item -ItemType Directory -Path $taskInstall
        @{app='kyoku-loop';schema=1} | ConvertTo-Json | Set-Content -LiteralPath $owner -Encoding UTF8
    }
    if (Test-Path -LiteralPath $releaseFolder) { throw 'This release directory already exists. It was not overwritten.' }
    $null = New-Item -ItemType Directory -Path $releaseFolder -Force
    $archive = Join-Path $taskInstall ('source-'+[Guid]::NewGuid().ToString('N')+'.zip')
    try {
        git -C $taskRepo archive --format=zip ('--output='+$archive) $ExpectedSha
        if ($LASTEXITCODE -ne 0) { throw 'Source archive failed.' }
        Expand-Archive -LiteralPath $archive -DestinationPath $releaseFolder
    } finally { if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive } }
    $node = (Get-Command node.exe).Source
    $python = ((& python -c 'import sys; print(sys.executable)') -join '').Trim()
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $python)) { throw 'Python is unavailable.' }
    $npm = (Get-Command npm.cmd).Source
    $oldDaily = $env:VITE_KYOKULOOP_DAILY
    Push-Location $releaseFolder
    try {
        & $npm ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        $env:VITE_KYOKULOOP_DAILY='1'
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    } finally { $env:VITE_KYOKULOOP_DAILY=$oldDaily; Pop-Location }
    $files = @{}
    foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $releaseFolder 'dist') -File -Recurse) + @(Get-ChildItem -LiteralPath (Join-Path $releaseFolder 'tools') -File)) {
        $relative = $file.FullName.Substring($releaseFolder.Length+1)
        $files[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    foreach ($name in @('vite.config.ts','src\version.ts','package.json','package-lock.json','public\phone\icon.ico')) { $files[$name]=(Get-FileHash -LiteralPath (Join-Path $releaseFolder $name) -Algorithm SHA256).Hash.ToLowerInvariant() }
    @{app='kyoku-loop';sourceSha=$ExpectedSha;version=$version;node=$node;python=$python;files=$files} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releaseFolder 'release.json') -Encoding UTF8
    $launcher = Join-Path $taskInstall 'KyokuLoop.ps1'
    $pointer = Join-Path $taskInstall 'current.json'
    $stamp = [Guid]::NewGuid().ToString('N')
    if (Test-Path -LiteralPath $launcher) { Copy-Item -LiteralPath $launcher -Destination (Join-Path $taskInstall ('launcher-previous-'+$stamp+'.ps1')) }
    if (Test-Path -LiteralPath $pointer) { Copy-Item -LiteralPath $pointer -Destination (Join-Path $taskInstall ('current-previous-'+$stamp+'.json')) }
    try {
        Copy-Item -LiteralPath (Join-Path $releaseFolder 'scripts\KyokuLoop.ps1') -Destination $launcher
        $staged = Join-Path $taskInstall ('current-'+$stamp+'.tmp')
        @{app='kyoku-loop';release=$releaseName;sourceSha=$ExpectedSha} | ConvertTo-Json | Set-Content -LiteralPath $staged -Encoding UTF8
        if (-not $NoShortcut) {
            $linkFolder = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\#My Dev Apps'
            $null = New-Item -ItemType Directory -Path $linkFolder -Force
            $shell = New-Object -ComObject WScript.Shell
            foreach ($item in @(@('KyokuLoop','Launch'),@('KyokuLoop を終了','Stop'),@('KyokuLoop バックアップ','Backup'))) {
                $path = Join-Path $linkFolder ($item[0]+'.lnk')
                if (Test-Path -LiteralPath $path) {
                    $existing = $shell.CreateShortcut($path)
                    if (-not $existing.Arguments.Contains(('"'+$launcher+'"'))) { throw 'An unrelated shortcut already exists; it was not overwritten.' }
                    Copy-Item -LiteralPath $path -Destination (Join-Path $taskInstall ('shortcut-previous-'+[Guid]::NewGuid().ToString('N')+'.lnk'))
                }
                $link = $shell.CreateShortcut($path)
                $link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
                $link.Arguments = '-NoProfile -STA -WindowStyle Hidden -File "'+$launcher+'" -Action '+$item[1]
                $link.WorkingDirectory = $taskInstall; $link.WindowStyle = 7
                $link.IconLocation = Join-Path $releaseFolder 'public\phone\icon.ico'
                $link.Save()
            }
        }
        & (Join-Path $releaseFolder 'scripts\Switch-KyokuLoopRelease.ps1') -StagedPath $staged -PointerPath $pointer -BackupPath (Join-Path $taskInstall ('current-replaced-'+$stamp+'.json'))
    } catch {
        $previousLauncher = Join-Path $taskInstall ('launcher-previous-'+$stamp+'.ps1')
        if (Test-Path -LiteralPath $previousLauncher) { Copy-Item -LiteralPath $previousLauncher -Destination $launcher -Force }
        throw
    }
    @{result='DEPLOYED';sourceSha=$ExpectedSha;version=$version;directory=$releaseFolder;running_version_unchanged=$true} | ConvertTo-Json -Compress
} finally { if ($taskLocked) { $taskMutex.ReleaseMutex() }; $taskMutex.Dispose() }
