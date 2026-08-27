$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $projectRoot ".workdeck-api.pid"

if (-not (Test-Path -LiteralPath $pidFile)) {
    Write-Host "O backend local nao foi iniciado por este atalho." -ForegroundColor Yellow
    exit 0
}

$processId = [int](Get-Content -LiteralPath $pidFile -Raw)
$process = Get-Process -Id $processId -ErrorAction SilentlyContinue

if ($process -and $process.ProcessName -eq "node") {
    try {
        Stop-Process -Id $processId -ErrorAction Stop
        Write-Host "Backend local encerrado." -ForegroundColor Green
    }
    catch {
        Write-Host "O Windows bloqueou o encerramento. Execute este atalho como administrador." -ForegroundColor Red
        exit 1
    }
}
else {
    Write-Host "O processo salvo nao era mais o backend do Workdeck." -ForegroundColor Yellow
}

Remove-Item -LiteralPath $pidFile -Force
