[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl
)

# CP6 F4 real-service acceptance. This launcher accepts only the pre-existing
# disposable CP6 database and never deploys migrations, resets data, or seeds.
$ErrorActionPreference = 'Stop'
$expectedBranch = 'codex/sprint-05-planning'
$expectedHead = 'a9479c8d6f257e54a74e78affb09b884d5f946ba'
$workspace = Split-Path $PSScriptRoot -Parent
$container = 'novo-cp6-pg17-test'
$expectedModelVersion = 'activity-category-v0.2-39098d6f4f26'
$mlDirectory = Join-Path $workspace 'services\ml'
$python = Join-Path $mlDirectory '.venv\Scripts\python.exe'
$artifactDirectory = Join-Path $mlDirectory 'models\activity_category_v02_final'
$workDirectory = Join-Path $workspace 'work'

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

function Assert-ChildIsRunning([System.Diagnostics.Process]$Process, [string]$Name, [string]$LogPath) {
  $Process.Refresh()
  if ($Process.HasExited) {
    throw "$Name process exited before readiness (PID $($Process.Id), exit code $($Process.ExitCode)). Log tail:`n$(Get-SafeLogTail $LogPath)"
  }
}

function Invoke-DisposablePsql([string]$Description, [string]$Query) {
  $output = & docker exec `
    --env 'PGOPTIONS=-c default_transaction_read_only=on' `
    $container psql -X -v ON_ERROR_STOP=1 `
    -U novo_cp5 -d novo_test -Atq -c $Query 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Disposable PostgreSQL $Description query failed (exit code $LASTEXITCODE): $(($output | Out-String).Trim())"
  }
  return ($output | Out-String).Trim()
}

function Get-HttpReadiness([string]$Name, [string]$Uri, [int]$ExpectedStatus) {
  try {
    $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -eq $ExpectedStatus) { return [PSCustomObject]@{ Ready = $true; Response = $response; Detail = "HTTP $($response.StatusCode)" } }
    return [PSCustomObject]@{ Ready = $false; Response = $null; Detail = "HTTP $($response.StatusCode), expected $ExpectedStatus" }
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($null -ne $statusCode) { return [PSCustomObject]@{ Ready = $false; Response = $null; Detail = "HTTP $statusCode" } }
    return [PSCustomObject]@{ Ready = $false; Response = $null; Detail = $_.Exception.Message }
  }
}

Set-Location $workspace
if ((git branch --show-current) -ne $expectedBranch) { throw "Refusing run: expected branch $expectedBranch." }
if ((git rev-parse HEAD) -ne $expectedHead) { throw "Refusing run: expected HEAD $expectedHead." }
if (-not (Test-Path $python)) { throw 'F4 Python virtual environment is unavailable.' }
if (-not (Test-Path (Join-Path $artifactDirectory 'activity_category_v02.joblib')) -or -not (Test-Path (Join-Path $artifactDirectory 'activity_category_v02_evaluation.json'))) {
  throw 'Approved final F4 artifact is incomplete; refusing a fallback or retraining path.'
}

$uri = [Uri]$DatabaseUrl
if ($uri.Scheme -notin @('postgresql', 'postgres') -or $uri.Host -notin @('localhost', '127.0.0.1', '::1') -or $uri.Port -ne 55433 -or $uri.AbsolutePath.Trim('/') -ne 'novo_test') {
  throw 'Refusing run: DatabaseUrl must target local disposable PostgreSQL novo_test on port 55433.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is unavailable.' }
if ((docker inspect --format '{{.State.Running}}' $container 2>$null) -ne 'true') { throw "Disposable container $container is not running." }
if ((docker inspect --format '{{.Config.Image}}' $container) -ne 'postgres:17-alpine') { throw 'Unexpected PostgreSQL image.' }
if ((docker inspect --format '{{range .Mounts}}{{.Name}} {{end}}' $container) -notmatch 'novo-cp6-pg17-data') { throw 'Unexpected disposable PostgreSQL volume.' }
if ((docker inspect --format '{{range .NetworkSettings.Ports}}{{range .}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' $container) -notmatch '127\.0\.0\.1:55433') { throw 'Unexpected disposable PostgreSQL port binding.' }
if ((Invoke-DisposablePsql 'database-identity' 'SELECT current_database() || ''|'' || current_user') -ne 'novo_test|novo_cp5') { throw 'Disposable database identity does not match novo_test / novo_cp5.' }
if ((Invoke-DisposablePsql 'migration-count' 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL') -ne '9') { throw 'Expected exactly nine applied Prisma migrations.' }
if ((Invoke-DisposablePsql 'failed-migration-count' 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL') -ne '0') { throw 'Disposable database has a failed or rolled-back migration.' }
if ((Invoke-DisposablePsql 'ShuttleSubscription-partial-unique-index-count' "SELECT count(*) FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'ShuttleSubscription' AND indexname IN ('ShuttleSubscription_active_member_unique_idx', 'ShuttleSubscription_active_student_unique_idx') AND indexdef ILIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '% WHERE %'") -ne '2') { throw 'Expected both ShuttleSubscription partial unique indexes.' }

foreach ($port in 4000, 5173, 8016) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use. The launcher will not replace an unrelated listener." }
}

$previous = @{}
foreach ($name in @('NODE_ENV', 'DATABASE_URL', 'E2E_DATABASE_URL', 'WEB_ORIGIN', 'PORT', 'UPLOAD_DIR', 'ML_SERVICE_URL', 'VITE_API_URL', 'NOVO_E2E_WEB_URL', 'NOVO_ML_SERVING_MODE', 'NOVO_ACTIVITY_MODEL_DIR', 'NOVO_ACTIVITY_MODEL_VERSION')) {
  $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$fastApi = $null
$api = $null
$web = $null

try {
  New-Item -ItemType Directory -Force -Path $workDirectory | Out-Null
  $env:NODE_ENV = 'test'
  $env:DATABASE_URL = $DatabaseUrl
  $env:E2E_DATABASE_URL = $DatabaseUrl
  $env:WEB_ORIGIN = 'http://localhost:5173'
  $env:PORT = '4000'
  $env:UPLOAD_DIR = Join-Path $workDirectory 'cp6-f4-e2e-uploads'
  $env:ML_SERVICE_URL = 'http://127.0.0.1:8016'
  $env:VITE_API_URL = 'http://localhost:4000/api/v1'
  $env:NOVO_E2E_WEB_URL = 'http://localhost:5173'
  $env:NOVO_ML_SERVING_MODE = 'activity_only'
  $env:NOVO_ACTIVITY_MODEL_DIR = $artifactDirectory
  $env:NOVO_ACTIVITY_MODEL_VERSION = $expectedModelVersion

  $fastApiLog = Join-Path $workDirectory 'cp6-f4-fastapi.log'
  $fastApiErrorLog = Join-Path $workDirectory 'cp6-f4-fastapi.err'
  $apiLog = Join-Path $workDirectory 'cp6-f4-api.log'
  $apiErrorLog = Join-Path $workDirectory 'cp6-f4-api.err'
  $webLog = Join-Path $workDirectory 'cp6-f4-web.log'
  $webErrorLog = Join-Path $workDirectory 'cp6-f4-web.err'

  $fastApi = Start-Process -FilePath $python -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8016') -WorkingDirectory $mlDirectory -NoNewWindow -PassThru -RedirectStandardOutput $fastApiLog -RedirectStandardError $fastApiErrorLog
  Write-Host "Started F4-only FastAPI child PID $($fastApi.Id) on 127.0.0.1:8016."
  $deadline = (Get-Date).AddSeconds(60)
  $f4Ready = $null
  do {
    Assert-ChildIsRunning $fastApi 'FastAPI' $fastApiErrorLog
    $candidate = Get-HttpReadiness 'FastAPI' 'http://127.0.0.1:8016/healthz' 200
    if ($candidate.Ready) { $f4Ready = $candidate; break }
    Start-Sleep -Milliseconds 400
  } until ((Get-Date) -gt $deadline)
  if ($null -eq $f4Ready) { throw "Timed out waiting for FastAPI readiness. Log tail:`n$(Get-SafeLogTail $fastApiErrorLog)" }
  $f4Health = $f4Ready.Response.Content | ConvertFrom-Json
  if ($f4Health.status -ne 'ok' -or $f4Health.serving_mode -ne 'activity_only' -or $f4Health.activity_model -ne 'loaded' -or $f4Health.models -ne 'unavailable') { throw 'FastAPI health does not confirm activity-only F4 readiness.' }
  $directPrediction = Invoke-WebRequest -UseBasicParsing -Method Post -Uri 'http://127.0.0.1:8016/v1/activity-category/predict' -ContentType 'application/json' -Body (@{ note_deidentified = 'Petugas gudang memeriksa stok minuman sintetis sebelum toko dibuka.' } | ConvertTo-Json -Compress) -TimeoutSec 10
  $directBody = $directPrediction.Content | ConvertFrom-Json
  if ($directPrediction.StatusCode -ne 200 -or $directBody.model_version -ne $expectedModelVersion -or $directBody.predicted_category -notin @('INVENTORY', 'SALES', 'SERVICE', 'ADMINISTRATION')) { throw 'Real FastAPI prediction did not match the approved F4 contract.' }

  $api = Start-Process -FilePath 'pnpm.cmd' -ArgumentList '--filter', '@novo/api', 'exec', 'tsx', 'src/server.ts' -WorkingDirectory $workspace -NoNewWindow -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrorLog
  $web = Start-Process -FilePath 'pnpm.cmd' -ArgumentList '--filter', '@novo/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort' -WorkingDirectory $workspace -NoNewWindow -PassThru -RedirectStandardOutput $webLog -RedirectStandardError $webErrorLog
  Write-Host "Started Express child PID $($api.Id) and Vite child PID $($web.Id)."
  $deadline = (Get-Date).AddSeconds(60)
  $apiReady = $null
  $webReady = $null
  do {
    Assert-ChildIsRunning $api 'Express API' $apiErrorLog
    Assert-ChildIsRunning $web 'Vite Web' $webErrorLog
    $apiReady = Get-HttpReadiness 'Express API' 'http://127.0.0.1:4000/api/v1/healthz' 200
    $webReady = Get-HttpReadiness 'Vite Web' 'http://127.0.0.1:5173' 200
    if ($apiReady.Ready -and $webReady.Ready) { break }
    Start-Sleep -Milliseconds 400
  } until ((Get-Date) -gt $deadline)
  if (-not ($apiReady.Ready -and $webReady.Ready)) { throw "Timed out waiting for Express/Vite. API: $($apiReady.Detail). Web: $($webReady.Detail)." }

  pnpm exec playwright test e2e/activity-classification.real.spec.ts --reporter=list
  if ($LASTEXITCODE -ne 0) { throw "F4 real Playwright failed (exit code $LASTEXITCODE)." }
} finally {
  Stop-OwnedProcess $web
  Stop-OwnedProcess $api
  Stop-OwnedProcess $fastApi
  foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
