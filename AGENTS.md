# NOVO Business Centre — Codex rules (Windows + GitHub)

## Local workspace and remote
- **Canonical local workspace:** `C:\Users\raden\dev\projects\NOVO-Business-Centre` (Windows absolute path). Do not create another project directory, do not silently use a temp/Linux workspace, and do not re-extract over existing source.
- **GitHub:** new PRIVATE repository created under the account authenticated with `gh`. The existing `novobusinesscenter/novo_business` repository is not the target. Never force-push or change an existing `origin` silently.
- If running in a cloud/Linux container without access to the Windows path, work only through the newly created GitHub repository after it exists, using a clean clone in the cloud; say clearly that Windows files are not accessible. Do not pretend to have modified `C:\...`.
- On bootstrap: one initial `main` commit and push are authorized for creating the new private repository. On all later phases, create `codex/sprint-NN-topic` branches, push the branch, and submit a PR; never merge without owner approval.

## Ground truth
- Product PRD original retains all requirements; Asah PRD v4 adds requirements without replacing modules.
- 86 tracked entries: 14 functional, 10 non-functional, 20 Main Quest, 42 Side Quest. Main Quest mandatory in the program; all Side Quest are requested targets, but optional according to the official rules. Source: `docs/codex/NOVO_CODEX_REQUIREMENTS_86.json` and `docs/codex/NOVO_CODEX_MASTER_BACKLOG_v2.md`.
- Local reference documents under `_local_refs/` are intentionally gitignored. Preserve them locally; do not upload to GitHub without specific approval.
- Do not claim `verified` unless a working behavior and a real automated/manual test are documented with observed results.
- Never alter historic commits or falsify authorship, test output, feedback from PIC, or team approvals.

## Security and engineering
- Protect tenant isolation, role permissions, payments, funds, attachments, identities, immutable ledgers, and audit trails at API/database level. Never rely on UI-only permissions.
- Use synthetic data and fake names. Never commit real student, guardian, employee, financial, or customer records, `.env` secrets, model API keys, or access tokens.
- Preserve all NOVO modules: Store, Shuttle, Catering, Funding, Financing, master data, membership, reporting, SIMS sync, backup; Purchasing is separate extension.
- Work in small independently testable phases; preserve existing migrations and modules unless changes are proven necessary.
- Keep `docs/IMPLEMENTATION_STATUS.md`, `docs/QUEST-TRACEABILITY.md`, `docs/NOVO-PRD-COVERAGE.md`, and `docs/CODEX_HANDOFF.md` current after each phase. Log exact command/exit status and requirement IDs; mark infrastructure-dependent work blocked honestly.
- Keep PRs focused; before push run available tests, lint, typecheck, build, check staged files for secrets, and explain blocked checks.
- At context or quota limits: commit safe work on sprint branch, push if authenticated/authorized, write a complete handoff (last commit/branch, changed paths, failed tests, uncompleted step), and stop. Never start over.
