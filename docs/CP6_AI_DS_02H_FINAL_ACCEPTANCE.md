# CP6-AI-DS-02H — Final Acceptance Evidence: F4 Activity Classification

This document reconciles the latest owner-executed Windows acceptance evidence for the uncommitted CP6 working tree. It is an evidence record for the protected F4 **suggestion** path only. It does not make the model production-ready, does not close MED-01, and does not change the status of unrelated Sprint 05 work.

## 1. Scope and checkpoint

CP6-AI-DS-02H validates the real, local path:

```text
React browser -> Express /api/v1 proxy -> FastAPI activity-only service -> approved F4 artifact
```

The supported output is a human-reviewable category suggestion with one of `INVENTORY`, `SALES`, `SERVICE`, or `ADMINISTRATION`. The browser may accept or manually correct its local draft. It does not persist an operational activity, alter Shuttle, finance, inventory, membership, or any other NOVO transaction.

## 2. Evidence source and chronology

| Evidence | Status | Notes |
| --- | --- | --- |
| CP6-AI-DS-02B/02C/02D records | Historical | These documents correctly record earlier Codex-environment limitations, including unavailable Docker/Chromium/loopback access. They are not retroactively rewritten. |
| Owner Windows PowerShell execution | Executed | The owner subsequently ran the disposable PostgreSQL, FastAPI, Express, Vite, and Chromium acceptance gates described below. No credential, cookie, database URL, or raw runtime log is reproduced here. |
| Local source/artifact inspection | Static | The committed-pending working tree contains the described scripts, tests, model metadata, and fail-closed serving controls. |

The earlier `BLOCKED_ENVIRONMENT` entries therefore describe their own checkpoints, while the owner-run results below supersede only the corresponding runtime gates. The exact wall-clock timestamps of the later owner executions were not supplied to this document and are intentionally not invented.

## 3. Dataset provenance and frozen evaluation boundary

| Property | Evidence |
| --- | --- |
| Dataset | `activity-dataset-v0.2` |
| Dataset SHA-256 | `39098d6f4f26848ab85f938450686d254f613a734e4e67b3ebf4d23cbf865b47` |
| Provenance | Synthetic generator v2, seed `20261105`, no personal data |
| Final artifact version | `activity-category-v0.2-39098d6f4f26` |
| Final artifact integrity | SHA-256 `70652cb7c5a09879296043fc1e9cef236253e088b9ba67d5038f284d2e767a16`; 81,132 bytes |
| Final hold-out policy | Frozen hold-out was evaluated once after internal annotation review; it must not be reopened for tuning. |
| Final macro-F1 | `0.916409` on the small synthetic frozen hold-out |

The metric demonstrates reproducibility of this limited synthetic task only. It is not an operational-quality, fairness, calibration, or real-school-data claim.

## 4. Model artifact and serving boundary

The approved artifact is loaded only in `activity_only` mode. The FastAPI service fails closed if the artifact, approved version, or final-evaluation metadata is unavailable or malformed. In that mode the legacy intent, demand, and RAG capability is intentionally unavailable; it is not silently retrained or used as a fallback.

The expected fresh-clone serving inputs are the approved final joblib artifact, its evaluated metadata JSON, the Python dependencies, and the `activity_only` configuration. Development and legacy artifacts are not part of this acceptance evidence.

## 5. Executed quality gates

| Gate | Result | Evidence boundary |
| --- | --- | --- |
| Final F4 frozen hold-out | PASS | Macro-F1 `0.916409`; no retraining or second final evaluation in this checkpoint. |
| Focused ML tests | PASS — 26 | Dataset, artifact loading, serving contract, and activity-only behavior. |
| FastAPI real HTTP runtime | PASS | Health, real approved-artifact inference, invalid-input behavior, and intentional legacy-capability unavailability were checked through HTTP. |
| Web unit tests | PASS — 22/22 | React/UI behavior. |
| Mocked F4 Playwright | PASS — 3/3 | Mock-specific browser journeys; not real-service evidence. |
| Focused Express security integration | PASS — 3/3 | 58 unrelated integration scenarios were skipped by the focused selection. |
| Disposable PostgreSQL migrations | PASS — 9/9 | Verified only on the disposable local target. |
| Shuttle partial unique indexes | PASS — 2/2 | Verified on the disposable local target; this is supporting infrastructure, not a claim that Shuttle acceptance is complete. |
| Real React -> Express -> FastAPI Chromium E2E | PASS — 1/1 | Real approved-model inference; observed duration 9.6 seconds. |
| `git diff --check` | PASS | Existing LF/CRLF warnings were emitted; no whitespace error was reported. |

## 6. Database and security boundary

The owner-run database target was the verified disposable PostgreSQL 17 instance at loopback `127.0.0.1:55433`, database `novo_test`. The checkpoint did not use the development `novo` database, Supabase, Render, staging, or production.

The Express F4 proxy is protected by the established cookie session, CSRF, trusted-origin handling, server-derived tenant context, and role checks. Its request schema accepts only de-identified note input and rejects client tenant overrides. Provider responses are validated, time-bounded, and fail closed. The audit entry records metadata such as outcome/model version rather than the note text.

The real-service E2E additionally asserted that the F4 request did not create an `AiInteraction`, financial, inventory, invoice, or settlement mutation. Browser acceptance/correction remains local draft state and disappears after reload; there is no activity-persistence feature in this checkpoint.

## 7. Browser and runtime cleanup evidence

The mock suite and real-service suite are distinct. Only the latter is evidence of actual FastAPI inference through Express and the browser.

After the real-service test completed:

- loopback ports `4000`, `5173`, and `8016` had no remaining listeners;
- the disposable PostgreSQL container remained healthy; and
- launcher cleanup was limited to processes it started.

## 8. Failure history and corrections

Earlier checkpoint documents recorded unavailable Docker access, unavailable Chromium, and unavailable loopback runtime in the Codex environment. Those were environment gates, not a basis for application PASS. The later owner Windows execution satisfied the required disposable-database, runtime, and Chromium gates.

The final acceptance execution also keeps two important corrections explicit:

1. `activity_only` serving avoids the legacy automatic-training path and treats legacy capability unavailability as an explicit condition rather than a retraining fallback.
2. Mocked Playwright journeys remain labeled as mocked; the one real-service Chromium journey is the separate evidence for browser-to-Express-to-FastAPI integration.

## 9. Readiness assessment

| Capability | Status |
| --- | --- |
| F4 protected synthetic suggestion flow | VERIFIED for the owner-run controlled local acceptance path |
| F4 production readiness | NOT VERIFIED |
| F1 activity input/persistence/history | NOT STARTED in this checkpoint |
| F2 persistent activity history/filtering | NOT STARTED in this checkpoint |
| F3 operational dashboard/analysis | NOT STARTED in this checkpoint |
| F5 aggregate-constrained generative summary | NOT STARTED in this checkpoint |
| FR-007 Shuttle | PARTIAL; not promoted by CP6 evidence |
| MED-01 retention purge | OPEN |

## 10. Remaining limitations and next checkpoints

- The corpus is synthetic, small, and unsuitable as evidence for production prediction quality.
- There is no activity persistence, human feedback storage, operational dashboard, aggregate-only generative summary, model monitoring, or real-data governance approval.
- Broader API/ML/browser suites remain outside the focused CP6 result unless separately executed and recorded.
- The model binary must be approved for repository tracking or supplied through an approved internal artifact mechanism before a fresh clone can serve F4 reproducibly.
- MED-01 remains `OPEN`; it is outside the F4 scope and requires its own verified retention-purge acceptance evidence.

The next permitted checkpoint is CP6-CLOSE-03: obtain owner approval for the binary-artifact policy and the proposed WIP commit separation, then stage only the approved logical commit scope. No production deployment or broader F1–F5 implementation follows automatically.
