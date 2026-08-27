$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$healthUrl = "http://127.0.0.1:8787/health"
$pidFile = Join-Path $projectRoot ".workdeck-api.pid"
$serverEntry = Join-Path $projectRoot "dist-server\index.js"

function Test-ApiHealth {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

$apiHealthy = Test-ApiHealth

# Se o backend foi recompilado depois que o processo local iniciou, reinicie
# somente o processo registrado por este projeto. Isso aplica atualizações sem
# interromper qualquer outro servidor Node do computador.
if ($apiHealthy -and (Test-Path -LiteralPath $pidFile) -and (Test-Path -LiteralPath $serverEntry)) {
    $savedProcessId = [int](Get-Content -LiteralPath $pidFile -Raw)
    $savedProcess = Get-Process -Id $savedProcessId -ErrorAction SilentlyContinue
    $serverUpdatedAt = (Get-Item -LiteralPath $serverEntry).LastWriteTimeUtc
    if ($savedProcess -and $savedProcess.ProcessName -eq "node" -and $serverUpdatedAt -gt $savedProcess.StartTime.ToUniversalTime()) {
        Stop-Process -Id $savedProcessId -ErrorAction Stop
        Remove-Item -LiteralPath $pidFile -Force
        $apiHealthy = $false
        Start-Sleep -Milliseconds 350
    }
}

if (-not $apiHealthy) {
    if (-not (Test-Path $serverEntry)) {
        Write-Host "Preparando o backend do Workdeck pela primeira vez..." -ForegroundColor Cyan
        $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
        & $npm run build:api
        if ($LASTEXITCODE -ne 0) {
            throw "Nao foi possivel preparar o backend."
        }
    }

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $apiProcess = Start-Process -FilePath $node -ArgumentList $serverEntry -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
    Set-Content -LiteralPath $pidFile -Value $apiProcess.Id

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 500
        if (Test-ApiHealth) {
            $ready = $true
            break
        }
    }

    if (-not $ready) {
        throw "O backend nao iniciou. Confira o MySQL e o arquivo .env."
    }
}

$appCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Workdeck\workdeck.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Workdeck\workdeck.exe"),
    (Join-Path $env:ProgramFiles "Workdeck\workdeck.exe")
)
$workdeck = $appCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if ($workdeck) {
    Start-Process -FilePath $workdeck
    Write-Host "Workdeck iniciado com o backend local." -ForegroundColor Green
}
else {
    Write-Host "Backend iniciado em http://127.0.0.1:8787" -ForegroundColor Green
    Write-Host "Instale o Workdeck para o aplicativo abrir automaticamente." -ForegroundColor Yellow
}
