[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
$expectedBranch = 'codex/sprint-05-planning'
$expectedHead = 'a9479c8d6f257e54a74e78affb09b884d5f946ba'
$workspace = Split-Path $PSScriptRoot -Parent

function Stop-OwnedProcess([System.Diagnostics.Process]$Process) {
  if ($null -ne $Process -and -not $Process.HasExited) {
    Stop-Process -Id $Process.Id -ErrorAction SilentlyContinue
    $Process.WaitForExit(5000) | Out-Null
  }
}

function Invoke-DisposablePsql([string]$Container, [string]$Description, [string]$Query) {
  # $1 is an argument to sh, not interpolated shell text. The database password
  # remains inside the disposable container and is never written to output.
  $psqlCommand = 'PGPASSWORD="$POSTGRES_PASSWORD" PGOPTIONS="-c default_transaction_read_only=on" exec psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atq -c "$1"'
  $output = & docker exec $Container sh -c $psqlCommand 'novo-e2e-read-only' $Query 2>&1
  if ($LASTEXITCODE -ne 0) {
    $details = ($output | Out-String).Trim()
    throw "Disposable PostgreSQL $Description query failed (exit code $LASTEXITCODE): $details"
  }
  return ($output | Out-String).Trim()
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

function Get-HttpReadiness([string]$Name, [string]$Uri, [int]$ExpectedStatus) {
  try {
    $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -eq $ExpectedStatus) {
      return [PSCustomObject]@{ Ready = $true; Detail = "HTTP $($response.StatusCode)" }
    }
    return [PSCustomObject]@{ Ready = $false; Detail = "HTTP $($response.StatusCode), expected $ExpectedStatus" }
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($null -ne $statusCode) {
      return [PSCustomObject]@{ Ready = $false; Detail = "HTTP $statusCode" }
    }
    $message = $_.Exception.Message
    if ($message -match '(?i)actively refused|connection refused') {
      return [PSCustomObject]@{ Ready = $false; Detail = 'connection refused (server is still starting or unavailable)' }
    }
    if ($message -match '(?i)timed out|timeout') {
      return [PSCustomObject]@{ Ready = $false; Detail = 'request timed out' }
    }
    return [PSCustomObject]@{ Ready = $false; Detail = "$Name readiness request failed: $message" }
  }
}

Set-Location $workspace
if ((git branch --show-current) -ne $expectedBranch) { throw "Refusing E2E run: expected branch $expectedBranch." }
if ((git rev-parse HEAD) -ne $expectedHead) { throw "Refusing E2E run: expected HEAD $expectedHead." }

$uri = [Uri]$DatabaseUrl
$databaseName = $uri.AbsolutePath.Trim('/')
if ($uri.Scheme -notin @('postgresql', 'postgres') -or $uri.Host -notin @('localhost', '127.0.0.1', '::1') -or $uri.Port -ne 55433 -or $databaseName -ne 'novo_test') {
  throw 'Refusing E2E run: DATABASE_URL must target local disposable PostgreSQL novo_test on port 55433.'
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker CLI is unavailable.' }
$container = 'novo-cp5-pg17-test'
if ((docker inspect --format '{{.State.Running}}' $container 2>$null) -ne 'true') { throw "Disposable container $container is not running." }
if ((docker inspect --format '{{.Config.Image}}' $container) -ne 'postgres:17-alpine') { throw 'Unexpected PostgreSQL image.' }
$binding = docker inspect --format '{{range .NetworkSettings.Ports}}{{range .}}{{.HostIp}}:{{.HostPort}}{{end}}{{end}}' $container
if ($binding -notmatch '127\.0\.0\.1:55433') { throw 'Disposable container is not bound to 127.0.0.1:55433.' }
$identity = & docker exec $container sh -c 'printf "%s|%s" "$POSTGRES_USER" "$POSTGRES_DB"' 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Unable to read disposable container database identity (exit code $LASTEXITCODE)."
}
$identityParts = (($identity | Out-String).Trim() -split '\|', 2)
if ($identityParts.Count -ne 2 -or $identityParts[0] -ne 'novo_cp5' -or $identityParts[1] -ne 'novo_test') {
  throw 'Disposable container database identity does not match the approved novo_cp5 / novo_test target.'
}
$serverVersion = Invoke-DisposablePsql $container 'server-version' 'SHOW server_version_num'
if ($serverVersion -notmatch '^17') { throw 'Disposable container is not PostgreSQL 17.' }
$migrationCount = Invoke-DisposablePsql $container 'applied-migration-count' 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL'
if ($migrationCount -ne '9') { throw 'Expected exactly nine applied Prisma migrations.' }
$failedMigrationCount = Invoke-DisposablePsql $container 'failed-migration-count' 'SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL'
if ($failedMigrationCount -ne '0') { throw 'Disposable database has a failed or rolled-back Prisma migration.' }
$partialUniqueIndexCount = Invoke-DisposablePsql $container 'ShuttleSubscription-partial-unique-index-count' "SELECT count(*) FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'ShuttleSubscription' AND indexname IN ('ShuttleSubscription_active_member_unique_idx', 'ShuttleSubscription_active_student_unique_idx') AND indexdef ILIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '% WHERE %'"
if ($partialUniqueIndexCount -ne '2') { throw 'Expected both ShuttleSubscription partial unique indexes.' }

foreach ($port in 4000, 5173) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use. The launcher will not replace an existing listener."
  }
}

$previousNodeEnv = $env:NODE_ENV
$previousDatabaseUrl = $env:DATABASE_URL
$previousE2eDatabaseUrl = $env:E2E_DATABASE_URL
$previousWebOrigin = $env:WEB_ORIGIN
$previousPort = $env:PORT
$previousUploadDir = $env:UPLOAD_DIR
$env:NODE_ENV = 'test'
$env:DATABASE_URL = $DatabaseUrl
$env:E2E_DATABASE_URL = $DatabaseUrl
$env:WEB_ORIGIN = 'http://localhost:5173'
$env:PORT = '4000'
$env:UPLOAD_DIR = Join-Path $workspace 'work\e2e-uploads'
$api = $null
$web = $null
$apiLog = Join-Path $workspace 'work\e2e-api.log'
$apiErrorLog = Join-Path $workspace 'work\e2e-api.err'
$webLog = Join-Path $workspace 'work\e2e-web.log'
$webErrorLog = Join-Path $workspace 'work\e2e-web.err'

try {
  New-Item -ItemType Directory -Force -Path (Join-Path $workspace 'work') | Out-Null
  $api = Start-Process -FilePath 'pnpm.cmd' -ArgumentList '--filter', '@novo/api', 'exec', 'tsx', 'src/server.ts' -WorkingDirectory $workspace -NoNewWindow -PassThru -RedirectStandardOutput $apiLog -RedirectStandardError $apiErrorLog
  Write-Host "Started API child PID $($api.Id) from $workspace on loopback port 4000."
  $web = Start-Process -FilePath 'pnpm.cmd' -ArgumentList '--filter', '@novo/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort' -WorkingDirectory $workspace -NoNewWindow -PassThru -RedirectStandardOutput $webLog -RedirectStandardError $webErrorLog
  Write-Host "Started Web child PID $($web.Id) from $workspace on loopback port 5173."
  $deadline = (Get-Date).AddSeconds(60)
  $apiReadiness = [PSCustomObject]@{ Ready = $false; Detail = 'not checked' }
  $webReadiness = [PSCustomObject]@{ Ready = $false; Detail = 'not checked' }
  do {
    Assert-ChildIsRunning $api 'API' $apiErrorLog
    Assert-ChildIsRunning $web 'Web' $webErrorLog
    $apiReadiness = Get-HttpReadiness 'API' 'http://127.0.0.1:4000/api/v1/healthz' 200
    $webReadiness = Get-HttpReadiness 'Web' 'http://127.0.0.1:5173' 200
    if ($apiReadiness.Ready -and $webReadiness.Ready) { break }
    Start-Sleep -Milliseconds 400
  } until ((Get-Date) -gt $deadline)
  if (-not ($apiReadiness.Ready -and $webReadiness.Ready)) {
    throw "Timed out after 60 seconds waiting for local servers. API: $($apiReadiness.Detail). Web: $($webReadiness.Detail). API logs: work/e2e-api.err; Web logs: work/e2e-web.err."
  }
  Write-Host 'API and Web readiness checks passed; starting Playwright.'
  pnpm test:e2e
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Stop-OwnedProcess $web
  Stop-OwnedProcess $api
  $env:NODE_ENV = $previousNodeEnv
  $env:DATABASE_URL = $previousDatabaseUrl
  $env:E2E_DATABASE_URL = $previousE2eDatabaseUrl
  $env:WEB_ORIGIN = $previousWebOrigin
  $env:PORT = $previousPort
  $env:UPLOAD_DIR = $previousUploadDir
}
