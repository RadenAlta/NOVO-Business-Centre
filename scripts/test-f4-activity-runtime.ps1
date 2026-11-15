[CmdletBinding()]
param(
  [ValidateRange(1025, 65535)]
  [int]$Port = 8016
)

# Runs only the local F4 FastAPI capability. It neither reads DATABASE_URL nor
# starts a database, migration, seed, or legacy-model training job.
$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$mlDirectory = Join-Path $workspace 'services\ml'
$python = Join-Path $mlDirectory '.venv\Scripts\python.exe'
$artifactDirectory = Join-Path $mlDirectory 'models\activity_category_v02_final'
$expectedVersion = 'activity-category-v0.2-39098d6f4f26'
$baseUri = "http://127.0.0.1:$Port"
$logDirectory = Join-Path $workspace 'work'
$stdoutLog = Join-Path $logDirectory 'f4-runtime-api.log'
$stderrLog = Join-Path $logDirectory 'f4-runtime-api.err'

function Stop-OwnedProcess([System.Diagnostics.Process]$Process) {
  if ($null -ne $Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -ErrorAction SilentlyContinue
    $Process.WaitForExit(5000) | Out-Null
  }
}

function Get-SafeLogTail([string]$Path) {
  if (-not (Test-Path $Path)) { return 'No startup log was written.' }
  $tail = Get-Content -Path $Path -Tail 20 -ErrorAction SilentlyContinue
  if (-not $tail) { return 'Startup log is empty.' }
  return (($tail | ForEach-Object {
    $_ -replace '(?i)(postgres(?:ql)?://)[^@\s]+@', '$1<redacted>@' -replace '(?i)(DATABASE_URL|PGPASSWORD|POSTGRES_PASSWORD)\s*=\s*\S+', '$1=<redacted>'
  }) -join [Environment]::NewLine)
}

function Assert-ProcessRunning([System.Diagnostics.Process]$Process) {
  $Process.Refresh()
  if ($Process.HasExited) {
    throw "F4 FastAPI process exited before readiness (PID $($Process.Id), exit code $($Process.ExitCode)). Log tail:`n$(Get-SafeLogTail $stderrLog)"
  }
}

function Invoke-LocalRequest([string]$Method, [string]$Path, [object]$Body = $null) {
  $parameters = @{
    Method = $Method
    Uri = "$baseUri$Path"
    UseBasicParsing = $true
    TimeoutSec = 5
    SkipHttpErrorCheck = $true
  }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json'
    $parameters.Body = $Body | ConvertTo-Json -Compress
  }
  return Invoke-WebRequest @parameters
}

if (-not (Test-Path $workspace)) { throw "Workspace not found: $workspace" }
if (-not (Test-Path $python)) { throw "Python virtual environment not found at services/ml/.venv." }
if (-not (Test-Path (Join-Path $artifactDirectory 'activity_category_v02.joblib')) -or -not (Test-Path (Join-Path $artifactDirectory 'activity_category_v02_evaluation.json'))) {
  throw 'Approved final F4 artifact is incomplete; refusing to start a fallback or training process.'
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Port $Port is already listening. Refusing to replace an unrelated process."
}

$previousMode = $env:NOVO_ML_SERVING_MODE
$previousArtifactDirectory = $env:NOVO_ACTIVITY_MODEL_DIR
$previousVersion = $env:NOVO_ACTIVITY_MODEL_VERSION
$process = $null

try {
  New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
  $env:NOVO_ML_SERVING_MODE = 'activity_only'
  $env:NOVO_ACTIVITY_MODEL_DIR = $artifactDirectory
  $env:NOVO_ACTIVITY_MODEL_VERSION = $expectedVersion

  $process = Start-Process -FilePath $python -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port") -WorkingDirectory $mlDirectory -NoNewWindow -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog
  Write-Host "Started F4-only FastAPI child PID $($process.Id) on 127.0.0.1:$Port."

  $deadline = (Get-Date).AddSeconds(60)
  $health = $null
  do {
    Assert-ProcessRunning $process
    try {
      $candidate = Invoke-LocalRequest 'GET' '/healthz'
      if ($candidate.StatusCode -eq 200) { $health = $candidate; break }
    } catch {
      # A connection refusal during bounded startup is expected; process state
      # is checked again on the next iteration.
    }
    Start-Sleep -Milliseconds 400
  } until ((Get-Date) -gt $deadline)
  if ($null -eq $health) {
    throw "Timed out after 60 seconds waiting for F4 readiness. Log tail:`n$(Get-SafeLogTail $stderrLog)"
  }

  $healthBody = $health.Content | ConvertFrom-Json
  if ($healthBody.status -ne 'ok' -or $healthBody.serving_mode -ne 'activity_only' -or $healthBody.activity_model -ne 'loaded' -or $healthBody.models -ne 'unavailable') {
    throw 'F4 readiness response does not confirm the required activity-only capability state.'
  }

  $prediction = Invoke-LocalRequest 'POST' '/v1/activity-category/predict' @{ note_deidentified = 'Petugas gudang memeriksa stok minuman sintetis sebelum toko dibuka.' }
  if ($prediction.StatusCode -ne 200) { throw "F4 prediction returned HTTP $($prediction.StatusCode)." }
  $predictionBody = $prediction.Content | ConvertFrom-Json
  if ($predictionBody.predicted_category -notin @('INVENTORY', 'SALES', 'SERVICE', 'ADMINISTRATION') -or $predictionBody.model_version -ne $expectedVersion -or $predictionBody.inference_status -ne 'ok') {
    throw 'F4 prediction response did not match the approved model contract.'
  }

  $invalid = Invoke-LocalRequest 'POST' '/v1/activity-category/predict' @{ note_deidentified = '  ' }
  if ($invalid.StatusCode -ne 422) { throw "Invalid activity note returned HTTP $($invalid.StatusCode), expected 422." }

  $legacy = Invoke-LocalRequest 'GET' '/v1/evaluations'
  if ($legacy.StatusCode -ne 503) { throw "Legacy endpoint returned HTTP $($legacy.StatusCode), expected explicit 503 in activity-only mode." }

  [PSCustomObject]@{
    health = 'PASS'
    f4Prediction = 'PASS'
    invalidInput = 'PASS'
    legacyCapability = 'PASS (explicit 503)'
    modelVersion = $predictionBody.model_version
    predictedCategory = $predictionBody.predicted_category
  } | ConvertTo-Json -Compress | Set-Content -Path (Join-Path $logDirectory 'f4-runtime-evidence.json') -Encoding utf8
  Write-Host 'F4 activity-only runtime acceptance passed. Sanitized evidence: work/f4-runtime-evidence.json'
} finally {
  Stop-OwnedProcess $process
  $env:NOVO_ML_SERVING_MODE = $previousMode
  $env:NOVO_ACTIVITY_MODEL_DIR = $previousArtifactDirectory
  $env:NOVO_ACTIVITY_MODEL_VERSION = $previousVersion
}
