# CP6-AI-DS-02D — F4 Windows Runtime Acceptance

Date: 6 November 2026. This evidence is for the uncommitted CP6 working tree. It does not make F4 production-ready and does not change the status of unrelated Sprint 05 work.

## Scope and safety boundary

The checkpoint validates the F4 activity-category **suggestion** path only. It neither starts a migration nor modifies Shuttle, financial, inventory, or operational records. The expected runtime uses the approved synthetic-data artifact:

- model version: `activity-category-v0.2-39098d6f4f26`;
- serving mode: `activity_only`;
- endpoint: `POST /v1/activity-category/predict`;
- labels: `INVENTORY`, `SALES`, `SERVICE`, `ADMINISTRATION`.

`activity_only` is intentionally separate from legacy intent, demand, and RAG capabilities. Its health is `ok` when the approved F4 artifact is loaded, while `models: unavailable` accurately represents that the legacy capability is intentionally disabled.

## Preflight observed in this Codex session

| Check | Result | Evidence |
| --- | --- | --- |
| Branch / HEAD | PASS | `codex/sprint-05-planning` / `a9479c8d6f257e54a74e78affb09b884d5f946ba`. |
| Git WIP | PRESERVED | Existing tracked and untracked Sprint 05/CP6 changes remained unstaged; no Git write operation was performed. |
| Approved artifact | PASS | Artifact and evaluated metadata load in `activity_only`; version matches the configured expected value. |
| Legacy retraining guard | PASS | `load_model_state(activity_only)` returned no legacy model and a loaded F4 artifact. |
| Docker PostgreSQL gate | DATABASE_GATE_BLOCKED | Docker context is `desktop-linux`, but Docker Desktop named-pipe access was denied before container identity could be inspected. No database test ran. |

## Quality gates actually executed

| Command / layer | Result | Observed result |
| --- | --- | --- |
| `python -m compileall -q app` in `services/ml` | PASS | Completed successfully. |
| Focused ML dataset/training/serving tests | PASS | 26 passed. Warnings: FastAPI `on_event` deprecation and an inaccessible pytest cache; neither failed the suite. |
| Activity-only artifact load | PASS | Final artifact loaded; legacy model remained absent; expected version matched. |
| API TypeScript build / lint | PASS | Both completed successfully. |
| Web production build | PASS | Completed successfully. |
| Web unit tests | PASS | 22 tests in 6 files passed. |
| Playwright discovery | PASS | 6 tests in 4 specs, including 3 F4 mocked journeys. |
| `git diff --check` | PASS | No whitespace error; Git emitted pre-existing LF/CRLF conversion warnings for unrelated WIP. |
| In-process FastAPI route attempt | BLOCKED_ENVIRONMENT | An `activity_only` FastAPI `TestClient` attempt produced no request result before this session's process boundary. It is not counted as HTTP verification. |

## Browser evidence

The three F4 mock journeys were invoked with a bounded 10-second test timeout. They did not enter browser navigation because this Codex session lacks the Playwright Chromium executable. The runner reported the missing browser path before the application was exercised.

| Browser layer | Status | Reason |
| --- | --- | --- |
| Mocked F4 Playwright execution | BLOCKED_ENVIRONMENT | Playwright browser executable is absent in the Codex application sandbox. This is not an application assertion failure. |
| Mocked F4 test discovery | PASS | All three designed journeys are discovered. |
| Real-service browser E2E | NOT RUN | Requires Chromium, loopback listeners, verified disposable PostgreSQL, Express, and F4 FastAPI. |

The mock test coverage remains: explicit suggestion acceptance and manual correction as non-persistent draft; unavailable-model manual fallback; and `VIEWER` least-privilege denial.

## FastAPI listener status

The local artifact and FastAPI/Uvicorn imports are available, but this Codex session cannot use loopback sockets: requests to `127.0.0.1:5173` and a prior F4 test port were rejected by the session environment. An in-process FastAPI `TestClient` route attempt also yielded no result before the session process boundary. Therefore no real FastAPI HTTP response is claimed here.

`scripts/test-f4-activity-runtime.ps1` is a Windows-owner launcher for this gap. It uses only `127.0.0.1`, starts one owned Uvicorn process, waits at most 60 seconds, validates health, a real synthetic prediction, invalid-input rejection, and explicit legacy `503`, writes sanitized evidence under `work/`, then stops only its own PID and restores process environment variables. It does not use a database or `.env` fallback.

## Database and security-integration gate

No PostgreSQL-backed test was run. The required read-only Docker preflight could not reach Docker Desktop's named pipe, so the identity of `novo-cp5-pg17-test` / `127.0.0.1:55433` / `novo_test` was not established. In accordance with the safety gate, no fallback to `novo`, port 5432, Supabase, Render, staging, or production was attempted.

The focused security test is ready but remains `NOT RUN`: `apps/api/src/security.integration.test.ts`, describe block `F4 activity-classification suggestion proxy`. It covers authenticated role delegation, CSRF/origin, client tenant override rejection, validation, provider timeout/unavailability/malformed responses, metadata-only audit, replay rejection, and non-mutation of financial/inventory records. Its ML transport is mocked; it is not a real FastAPI proof.

## Owner-side execution order

1. Restore access to Docker Desktop, then use the existing `scripts/test-shuttle-e2e.ps1` preflight conventions to inspect the disposable container read-only. Do not start, create, reset, migrate, seed, or use any other database target.
2. Install the already locked Playwright browser in a normal Windows owner session if it is absent: `pnpm exec playwright install chromium`.
3. Run `pwsh -File .\scripts\test-f4-activity-runtime.ps1`. Review its sanitized `work/f4-runtime-evidence.json` only after it exits successfully.
4. With the verified `novo_test` URL scoped to the disposable database, run the focused F4 security suite; then start the real F4/Express/Web services through a dedicated verified launcher and run a minimal real-service browser test. Do not interpret the mocked journey as this step.

## Readiness decision

| Evidence class | Status |
| --- | --- |
| CODE_IMPLEMENTED | YES |
| UNIT_VERIFIED | YES |
| MOCK_E2E_VERIFIED | NO — browser executable unavailable in this session |
| HTTP_VERIFIED | NO — loopback binding unavailable in this session |
| SECURITY_INTEGRATION_VERIFIED | NO — DATABASE_GATE_BLOCKED |
| REAL_E2E_VERIFIED | NO |
| READY_FOR_CONTROLLED_DEMO | NO |

F4 remains `PARTIAL`; it is a human-reviewable synthetic-data suggestion only. MED-01 remains `OPEN`. The next permitted checkpoint is a Windows owner execution of the runtime script, then the disposable-database security and real-service E2E gates. It must not begin F1/F2 persistence, dashboard analytics, generative summaries, or deployment automatically.
