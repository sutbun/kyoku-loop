param(
    [Parameter(Mandatory=$true)][string]$StagedPath,
    [Parameter(Mandatory=$true)][string]$PointerPath,
    [Parameter(Mandatory=$true)][string]$BackupPath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $StagedPath -PathType Leaf)) { throw 'The staged release pointer is missing.' }
if (Test-Path -LiteralPath $BackupPath) { throw 'The pointer backup already exists; it was retained.' }
if (Test-Path -LiteralPath $PointerPath -PathType Leaf) {
    # Windows PowerShell 5 converts a null string argument to an empty path.
    # A named backup works on both PS5/.NET Framework and modern PowerShell.
    [IO.File]::Replace($StagedPath,$PointerPath,$BackupPath)
} else {
    [IO.File]::Move($StagedPath,$PointerPath)
}
