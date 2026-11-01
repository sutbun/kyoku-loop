param(
    [ValidateSet('Launch','Stop','Backup','Status')][string]$Action = 'Launch',
    [string]$InstallRoot = $PSScriptRoot,
    [switch]$NoBrowser,
    [switch]$NoUI
)
$ErrorActionPreference = 'Stop'
$taskDataRoot = 'D:\dev-data\kyoku-loop\private\app'
$taskControlFile = Join-Path $taskDataRoot 'runtime-control.json'
$taskAppURL = 'http://127.0.0.1:1460/'
function Request-Local([string]$Path, $Body) {
    $request = [System.Net.HttpWebRequest]::Create($taskAppURL.TrimEnd('/') + $Path)
    $request.Proxy = $null; $request.Timeout = 5000; $request.ReadWriteTimeout = 5000
    if ($null -ne $Body) {
        $request.Method = 'POST'; $request.ContentType = 'application/json'
        $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
        $request.ContentLength = $bytes.Length
        $stream = $request.GetRequestStream(); $stream.Write($bytes,0,$bytes.Length); $stream.Dispose()
    }
    $response = $request.GetResponse()
    try { $reader = New-Object IO.StreamReader($response.GetResponseStream()); try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() } }
    finally { $response.Dispose() }
}
function Read-Health {
    try { $health = Request-Local '/api/health' $null; if ($health.app -eq 'kyoku-loop') { return $health } } catch {}
    return $null
}
function Read-Release {
    $pointer = Get-Content -LiteralPath (Join-Path $InstallRoot 'current.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($pointer.app -ne 'kyoku-loop' -or $pointer.release -notmatch '^[0-9]{2}\.[0-9]{2}-[0-9]+-[a-f0-9]{12}$') { throw 'Invalid installed release.' }
    $folder = Join-Path (Join-Path $InstallRoot 'releases') $pointer.release
    $release = Get-Content -LiteralPath (Join-Path $folder 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($release.sourceSha -ne $pointer.sourceSha -or $release.sourceSha -notmatch '^[a-f0-9]{40}$') { throw 'Release identity mismatch.' }
    foreach ($entry in $release.files.PSObject.Properties) {
        $file = [IO.Path]::GetFullPath((Join-Path $folder $entry.Name))
        if (-not $file.StartsWith([IO.Path]::GetFullPath($folder) + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid release file.' }
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw 'Installed file validation failed.' }
    }
    return @{ Folder=$folder; Meta=$release }
}
function Save-Backup($Release) {
    $request = '{"action":"backup_create"}'
    $oldEncoding = $env:PYTHONIOENCODING
    $oldDatabase = $env:KYOKULOOP_DB
    try {
        $env:PYTHONIOENCODING = 'utf-8'
        $env:KYOKULOOP_DB = Join-Path $taskDataRoot 'kyokuloop.sqlite3'
        $result = $request | & $Release.Meta.python (Join-Path $Release.Folder 'tools\p2_store.py')
        if ($LASTEXITCODE -ne 0) { throw 'Backup process failed.' }
        $parsed = ($result -join "`n") | ConvertFrom-Json
        if (-not $parsed.ok) { throw 'Backup could not be saved. Existing data is retained.' }
        return $parsed.data
    } finally { $env:PYTHONIOENCODING = $oldEncoding; $env:KYOKULOOP_DB = $oldDatabase }
}
$taskMutex = New-Object Threading.Mutex($false,'Local\KyokuLoop-Daily-Launcher')
$taskLocked = $false
try {
    $taskLocked = $taskMutex.WaitOne(30000)
    if (-not $taskLocked) { throw '別の起動またはバックアップが処理中です。完了後にやり直してください。' }
    $health = Read-Health
    if ($Action -eq 'Status') {
        @{running=($null -ne $health); runtime=$health} | ConvertTo-Json -Depth 5 -Compress
        exit 0
    }
    if ($Action -eq 'Stop') {
        if ($null -eq $health) { @{stopped=$false;running=$false} | ConvertTo-Json -Compress; exit 0 }
        $control = Get-Content -LiteralPath $taskControlFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($control.pid -ne $health.pid -or $control.role -ne $health.role -or $control.source_sha -ne $health.source_sha) { throw '起動中のアプリを確認できないため終了していません。' }
        if ($health.active_requests -ne 0 -or $health.active_children -ne 0) { throw '処理中のため終了できません。操作の完了後にやり直してください。' }
        $null = Request-Local '/api/runtime' @{action='stop';token=$control.token}
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do { Start-Sleep -Milliseconds 200; $health = Read-Health } while ($null -ne $health -and [DateTime]::UtcNow -lt $deadline)
        if ($null -ne $health) { throw '終了処理が完了していません。強制終了は行っていません。' }
        @{stopped=$true} | ConvertTo-Json -Compress
        exit 0
    }
    $release = Read-Release
    if ($Action -eq 'Backup') {
        $saved = Save-Backup $release
        $saved | ConvertTo-Json -Depth 5 -Compress
        if ($saved.mirror.state -ne 'saved') { throw '元のバックアップは保存済みですが、追加コピーは完了していません。コピー先の接続と空き容量を確認してください。' }
        if (-not $NoUI) {
            Add-Type -AssemblyName System.Windows.Forms
            $null = [Windows.Forms.MessageBox]::Show(('バックアップを保存し、追加コピーも確認しました。' + "`r`n" + $saved.mirror.folder),'KyokuLoop')
        }
        exit 0
    }
    if ($null -ne $health) {
        if ($health.role -ne 'daily' -or $health.source_sha -ne $release.Meta.sourceSha) { throw '別の版のKyokuLoopが起動しています。終了してから普段使い版を起動してください。' }
    } else {
        if (@(Get-NetTCPConnection -LocalPort 1460 -State Listen -ErrorAction SilentlyContinue | Where-Object LocalAddress -in @('127.0.0.1','0.0.0.0','::')).Count) { throw '起動用の接続先が使用中です。他のアプリは終了していません。' }
        $null = Save-Backup $release
        $oldValues = @{}
        foreach ($name in @('KYOKULOOP_DAILY','KYOKULOOP_SOURCE_SHA','KYOKULOOP_PYTHON','KYOKULOOP_CONTROL_FILE','KYOKULOOP_DB')) { $oldValues[$name] = [Environment]::GetEnvironmentVariable($name,'Process') }
        try {
            $env:KYOKULOOP_DAILY='1'; $env:KYOKULOOP_SOURCE_SHA=$release.Meta.sourceSha
            $env:KYOKULOOP_DB = Join-Path $taskDataRoot 'kyokuloop.sqlite3'
            $env:KYOKULOOP_PYTHON=$release.Meta.python; $env:KYOKULOOP_CONTROL_FILE=$taskControlFile
            $vite = Join-Path $release.Folder 'node_modules\vite\bin\vite.js'
            $log = Join-Path $taskDataRoot 'daily-output.log'; $errorLog = Join-Path $taskDataRoot 'daily-errors.log'
            $null = Start-Process -FilePath $release.Meta.node -ArgumentList @(('"'+$vite+'"'),'preview') -WorkingDirectory $release.Folder -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errorLog -PassThru
        } finally { foreach ($name in $oldValues.Keys) { [Environment]::SetEnvironmentVariable($name,$oldValues[$name],'Process') } }
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        do { Start-Sleep -Milliseconds 300; $health = Read-Health } while ($null -eq $health -and [DateTime]::UtcNow -lt $deadline)
        if ($null -eq $health -or $health.role -ne 'daily' -or $health.source_sha -ne $release.Meta.sourceSha) { throw '普段使い版を起動できませんでした。保存データと前の版は保持しています。' }
    }
    if (-not $NoBrowser) { Start-Process $taskAppURL }
    @{running=$true;version=$health.version;source_sha=$health.source_sha;pid=$health.pid} | ConvertTo-Json -Compress
} catch {
    if (-not $NoUI) {
        Add-Type -AssemblyName System.Windows.Forms
        $null = [Windows.Forms.MessageBox]::Show($_.Exception.Message,'KyokuLoop')
    }
    Write-Error $_.Exception.Message
    exit 1
} finally {
    if ($taskLocked) { $taskMutex.ReleaseMutex() }; $taskMutex.Dispose()
}
