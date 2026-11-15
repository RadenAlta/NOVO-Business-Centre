param([Parameter(Mandatory = $true)][string]$DatabaseUrl)

$ErrorActionPreference = 'Stop'
$uri = [Uri]$DatabaseUrl
if ($uri.Scheme -notin @('postgresql', 'postgres')) { throw 'DatabaseUrl must use PostgreSQL.' }
if ($uri.Host -notin @('localhost', '127.0.0.1', '::1')) { throw 'Only a local PostgreSQL host is permitted.' }
if ($uri.Port -ne 5432) { throw 'Only local PostgreSQL port 5432 is permitted.' }
if ($uri.AbsolutePath.Trim('/') -ne 'novo_test') { throw 'Only the isolated novo_test database is permitted.' }
if (-not (Test-NetConnection -ComputerName $uri.Host -Port $uri.Port -InformationLevel Quiet)) { throw 'Local PostgreSQL is not reachable.' }

$env:NODE_ENV = 'test'
$env:DATABASE_URL = $DatabaseUrl
Set-Location (Split-Path $PSScriptRoot -Parent)
pnpm --filter '@novo/api' exec prisma migrate deploy --schema prisma/schema.prisma
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
pnpm --filter '@novo/api' test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
