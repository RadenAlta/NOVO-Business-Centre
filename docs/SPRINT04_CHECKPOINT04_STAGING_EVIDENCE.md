# Sprint 04 - Checkpoint 4 Staging Evidence

Date: 2026-10-29
Project: NOVO Business Centre
Environment: Staging
Result: TECHNICAL INTEGRATION PASS

## 1. Source Control

- Repository: RadenAlta/NOVO-Business-Centre
- Branch: codex/sprint-04-store-pos-inventory
- Verified GitHub HEAD: 6adafa2dd21ce3990d4f12d016616c911eec2d88
- Local and remote HEAD matched.
- Working tree was clean before evidence documentation.

## 2. Render API

- Service: novo-api-staging
- Region: Singapore
- Runtime: Docker
- Plan: Free
- Auto deploy: Disabled
- Deployed commit: 6adafa2dd21ce3990d4f12d016616c911eec2d88
- Deployment ID: dep-dbhlf6oae00c73e32p1g
- Deployment status: LIVE
- URL: https://novo-api-staging.onrender.com
- GET /healthz returned HTTP 200 with {"status":"ok"}.

## 3. Supabase PostgreSQL

- Project: novo-staging
- Project ID: mhgahdvltwrpdortltjw
- Region: Singapore, ap-southeast-1
- PostgreSQL version: 17.11
- Database: postgres
- Successful Prisma migrations: 6
- Incomplete migrations: 0 in prior migration verification.

Applied migrations:
1. 202610240001_init
2. 202610250002_server_sessions
3. 202610250003_stable_csrf_token
4. 202610260004_master_data_import_preview
5. 202610270005_store_pos_hardening
6. 202610280006_store_sku_integrity

## 4. MED-01 Import Preview Retention

- Scheduler: novo-med01-import-preview-purge
- Schedule: */5 * * * *
- Active: true
- E2E evidence: expired previews deleted, valid preview retained.
- Successful E2E Cron execution: DELETE 2.
- Synthetic test data cleaned up.
- Final synthetic Tenant, User and Import Preview counts: 0.
- Original SQL setup and verification queries retained in Supabase SQL Editor.

## 5. Render-to-Database Prisma Verification

- Endpoint: POST /api/v1/auth/login
- Input: Nonexistent synthetic tenant and user
- HTTP response: 401
- API error code: INVALID_CREDENTIALS
- Handler performs prisma.user.findFirst() before rejection.
- Supabase pg_stat_statements observed the matching User/Tenant query.
- Observed query calls: 1
- Returned user rows: 0
- Conclusion: Strong corroborating evidence of successful Prisma
  connectivity from Render to the intended Supabase staging project.
- Limitation: pg_stat_statements aggregates queries and does not expose
  an individual HTTP request identifier.

## 6. Saved Supabase SQL Evidence

- NOVO_01_Security_RLS_Function_Hardening
- NOVO_02_MED01_Cron_Setup
- NOVO_03_MED01_Cron_Execution_Verification
- NOVO_04_MED01_Retention_E2E_Setup
- NOVO_05_MED01_Retention_E2E_Verification
- NOVO_06_MED01_Retention_E2E_Cleanup
- NOVO_07_Render_Supabase_Prisma_Connection_Verification

## 7. Scope and Remaining Checks

Completed:
- Remote commit synchronization
- Render Docker deployment
- HTTP health check
- Six Prisma migrations
- MED-01 scheduled cleanup E2E
- Database-backed synthetic login rejection
- Corroborating Supabase query evidence

Not established by this checkpoint:
- Full authenticated user journey
- End-to-end POS, inventory and tenant-isolation acceptance
- Backup and disaster-recovery validation
- Production readiness or real school-data readiness

Operational notes:
- Do not expose DATABASE_URL or database passwords.
- Retain the previous Render PostgreSQL until decommissioning is approved.
- Plan backups and availability monitoring for Supabase Free.
- Review RLS policies, API authorization and tenant isolation separately.

## 8. Conclusion

Checkpoint 4 staging deployment, database integration and MED-01
retention verification are supported by the recorded evidence.

This document does not represent full Sprint 04 functional acceptance
or authorization to deploy real school data.
