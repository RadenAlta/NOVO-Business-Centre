# Sprint 04 — CP4-D2-R1 SKU migration atomicity checkpoint

- Branch: `codex/sprint-04-store-pos-inventory`; baseline independently reported by owner: `eb169c7` (CI 40491042299 success).
- HIGH-01 remains CLOSED by the owner-reported re-audit. HIGH-02A is **code/test pending CI**: the unmerged forward migration preflights invalid/colliding Product SKU records, takes `SHARE ROW EXCLUSIVE` on Product in one explicit transaction, canonicalizes only clean valid legacy ASCII values, and adds a database CHECK boundary. No legacy product is deleted, merged, suffixed, or silently selected as a winner.
- `pnpm --filter @novo/api preflight:store-sku` is read-only and reports tenant ID, product ID and original SKU for invalid values/collisions. Production deployment must run it and manually resolve every finding before `prisma migrate deploy`; record backup, maintenance window, migration status, and logs. The release owner must first verify that no persistent environment has applied the earlier migration checksum. Never use `migrate reset` in production.
- `pnpm --filter @novo/api test:legacy-sku-migration` is wired as an explicit GitHub Actions stage before ordinary migration deploy and uses isolated CI/test fixture databases. Local PostgreSQL integration remains BLOCKED until a disposable `novo_test` database is available. HIGH-02B (outer-whitespace policy mismatch) remains OPEN and is not changed in R1.
- FR-006 remains **partial**. MED-01 structured-preview retention purge remains **OPEN** and mandatory before production personal-data processing. All 86 requirement IDs, including 42 Side Quests, remain tracked; none is promoted by this checkpoint.
# CODEX Handoff — Sprint 03 PR #3 final XLSX hardening

## Git state

- Repository: `RadenAlta/NOVO-Business-Centre` (private).
- Branch: `codex/sprint-03-master-data-import`; base `main`: `671f049`; existing PR: #3.
- Latest pushed baseline: `28fa14a`, with PR #3 GitHub Actions reported **4/4 PASS** by the review request.
- Current tree changes HIGH-06 and HIGH-07 only. They are not committed or pushed from this environment because Git cannot create `.git/index.lock`.

## Sprint 03 review and hardening state

| Finding | State | Evidence / boundary |
| --- | --- | --- |
| HIGH-03 eligible membership picker | CLOSED at `28fa14a` | Server filters active same-tenant teachers/employees before search/paging; PostgreSQL regression covers 150 students. |
| HIGH-04 XLSX formulas/external content | CLOSED at `28fa14a` | Hosted baseline tests reject external worksheet links and formulas outside the import region. |
| HIGH-05 membership/audit atomicity | CLOSED at `28fa14a` | Hosted trigger-failure regression proves creation/status and audit roll back together. |
| HIGH-06 ZIP inflation | code fixed; hosted CI pending | Decompression output is bounded; actual entry size must equal central-directory size; actual aggregate output is capped before ExcelJS. |
| HIGH-07 relationship XML bypass | code fixed; hosted CI pending | Bounded SAX parser checks every `.rels`, including `_rels/.rels`; it decodes attributes, rejects external mode/DTD/malformed or oversized XML, and limits relationship count. |
| MED-01 preview retention purge | **OPEN** | Required before production processing of personal data; raw XLSX bytes are not persisted. |
| MED-02 template examples | CLOSED at `28fa14a` | Examples are in `Instructions`, never in importable data rows. |
| MED-03 SIMS activation ownership | CLOSED at `28fa14a` | Manual activation changes for SIMS-owned identities are denied. |
| FR-003 delete | documented | Soft deactivation is the non-destructive Sprint 03 delete operation, preserving history. |

## Validation record for current working set

| Check | Status | Observed result |
| --- | --- | --- |
| Contracts/API/Web TypeScript checks | PASS | Direct TypeScript checks for contracts, API and Web completed without errors. |
| Production Web build | PASS | Vite completed production build (1,735 modules transformed). |
| API unit/security parser tests | PASS | `lib.test.ts` + `master-data-import.test.ts`: 14/14 tests passed. Parser coverage includes metadata falsification, bounded relationship XML, encoded root external mode, DTD rejection, safe internal relation, external hyperlink and formula. |
| Contracts/Web tests | PASS | 16/16 tests passed across contracts and Web. |
| Prisma schema validation | PASS | `prisma validate --schema apps/api/prisma/schema.prisma` passed with a local disposable URL supplied only for schema validation. |
| `pnpm build`, `pnpm lint`, full workspace `pnpm test` | BLOCKED locally | pnpm attempts to register the workspace using a project-store symlink; this managed environment rejects it with `EPERM`. Direct equivalent non-database checks above passed. |
| Local PostgreSQL integration | BLOCKED locally | Docker and a disposable PostgreSQL runtime are unavailable. |
| New hosted GitHub Actions | pending | The reported 4/4 pass belongs to `28fa14a`, before HIGH-06/HIGH-07. |

## Traceability and next action

All 86 IDs remain tracked: 14 FR, 10 NFR, 20 Main Quest and 42 Side Quest. No status is promoted to `verified` from these local checks. The next safe action is to commit/push this exact hardening set and wait for all four PR #3 checks, including migration and PostgreSQL integration.

**Recommendation: REQUEST CHANGES** until that CI run succeeds. Do not merge or start Sprint 04.
