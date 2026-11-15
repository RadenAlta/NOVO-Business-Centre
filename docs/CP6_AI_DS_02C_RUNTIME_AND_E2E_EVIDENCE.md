# CP6-AI-DS-02C — F4 Runtime and E2E Evidence

Date: 6 November 2026. This report covers the uncommitted CP6 working tree only and does not promote F4 to `VERIFIED`.

## Root cause and serving design

The former FastAPI startup always called `ensure_models(MODEL_DIR)`. In the existing training module, absent `intent.joblib`, `demand.joblib`, or `evaluations.json` makes that function call `train_all()`. That coupled final F4 serving to legacy artifact availability and could retrain unrelated models on startup.

`NOVO_ML_SERVING_MODE` now accepts `full` (existing default behavior) or `activity_only`.

- `activity_only` loads only `NOVO_ACTIVITY_MODEL_DIR` and requires `NOVO_ACTIVITY_MODEL_VERSION` to match approved final metadata.
- It does not call `ensure_models()` and never creates, overwrites, or retrains legacy artifacts.
- Legacy intent/demand/evaluation/RAG capabilities report `503` as unavailable in this mode.
- F4 loading is fail-closed for missing, mismatched, malformed, or non-final metadata. Health reports `activity_model` and returns `degraded` when its required capability is unavailable.

## Evidence

| Layer | Result | Evidence |
| --- | --- | --- |
| Offline FastAPI serving tests | PASS | 26 focused ML tests, including activity-only no-training, approved/mismatched/malformed artifact, readiness, contract, and legacy-unavailable cases. |
| Python compile | PASS | `compileall` over `services/ml/app`. |
| API build/lint | PASS | TypeScript checks passed. |
| Web build | PASS | Production Vite build passed. |
| Web unit tests | PASS | 22 tests in 6 files. |
| Playwright F4 discovery | PASS | 3 new mocked F4 UI journeys discovered; total browser inventory is 6 tests in 4 files. |
| Mocked F4 browser execution | NOT RUN | This session cannot bind loopback listeners needed for Vite. |
| FastAPI HTTP smoke | BLOCKED | The process-launch attempt was denied by session policy; a foreground attempt could not access `127.0.0.1:8016` due socket permission. No endpoint pass is claimed. |
| PostgreSQL F4 security suite | BLOCKED | Docker Desktop named-pipe access returned permission denied before database identity could be verified. |
| Real Express → FastAPI | NOT RUN | Requires both verified PostgreSQL and FastAPI loopback runtime. |
| Real-service F4 browser E2E | NOT RUN | Requires the preceding runtime gates. |

Warnings observed: FastAPI `on_event` deprecation and inaccessible pytest cache. Neither changed test outcomes.

## Browser inventory

`e2e/activity-classification.mock.spec.ts` contains controlled-mock UI journeys for:

1. Valid suggestion, explicit acceptance, manual correction, and reload proving draft-only state.
2. Whitespace input disabled in the browser plus unavailable-service fallback to manual draft.
3. Least-privilege denial for a `VIEWER` role.

These are intentionally distinct from real-service E2E and are not runtime evidence until Vite/Chromium can execute them. No test uses or creates operational data.

## Security boundary

Static/compiled evidence confirms no F1/F2 persistence, no financial mutation, no direct browser model-service call, strict Express request validation, server-derived tenant context, cookie/CSRF/RBAC controls, response-schema validation, and metadata-only audit. PostgreSQL-backed proof of these properties is still outstanding.

## Reproduction prerequisites

Use a normal Windows PowerShell session with Docker Desktop access. Verify the existing `novo-cp5-pg17-test` container read-only before any test fixture writes. Use only `127.0.0.1:55433` / `novo_test` / `novo_cp5`, nine applied migrations, and the two confirmed Shuttle partial indexes. Do not run reset, seed, migration, or use `novo`, staging, cloud, or production.

Before real FastAPI smoke, set:

```powershell
$env:NOVO_ML_SERVING_MODE = 'activity_only'
$env:NOVO_ACTIVITY_MODEL_DIR = "$PWD\services\ml\models\activity_category_v02_final"
$env:NOVO_ACTIVITY_MODEL_VERSION = 'activity-category-v0.2-39098d6f4f26'
```

Then start only a loopback Uvicorn child from `services/ml`, verify `/healthz` reports `activity_only`, `activity_model=loaded`, `models=unavailable`, and exercise the synthetic F4 endpoint. Start Express only with the verified disposable test URL, then run the focused F4 API test and real-service browser journey.

## Readiness conclusion

F4 is `PARTIAL`. `UNIT_VERIFIED` is supported by actual offline tests; `API_SECURITY_VERIFIED`, `FASTAPI_HTTP_VERIFIED`, `EXPRESS_ML_VERIFIED`, and `BROWSER_E2E_VERIFIED` are not. `READY_FOR_CONTROLLED_DEMO` is therefore `NO`. MED-01 remains OPEN.
