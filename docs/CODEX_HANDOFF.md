# CODEX Handoff — Sprint 01 Foundation / CI correction

## Current checkpoint

- Branch: `codex/sprint-01-foundation`
- Prior committed checkpoint: `8075828` — `docs: complete Sprint 01 foundation audit`
- Existing pull request to update: [PR #1](https://github.com/RadenAlta/NOVO-Business-Centre/pull/1) (`codex/sprint-01-foundation` → `main`)
- Scope: fix CI configuration and correct Sprint 01 audit evidence only. Sprint 02 and product feature work have not started.

## Confirmed GitHub Actions root causes

The two GitHub Actions logs reviewed from 25 October 2026 show:

1. `api-and-web` stopped in `pnpm/action-setup@v4` because two pnpm versions were declared: workflow `11` and root `packageManager` `pnpm@11.25.0`.
2. `ml` stopped during `pip install -r requirements.txt` with `OSError: [Errno 122] Disk quota exceeded`. `sentence-transformers` caused a normal PyPI PyTorch resolution that downloaded CUDA/NVIDIA/Triton wheels. Pytest did **not** start.

Those failures are CI configuration/resource failures. They do not prove the application build, tests, or ML model behavior passed or failed.

## Changes ready for review

- `.github/workflows/ci.yml`
  - Removed the conflicting `with: version: 11` block. `pnpm/action-setup@v4` now uses the sole root declaration `pnpm@11.25.0`.
  - Added a CPU-only PyTorch installation from `https://download.pytorch.org/whl/cpu` before ML requirements.
  - Asserts `torch.version.cuda is None`; retains `sentence-transformers`, `chromadb`, FastAPI, training tests, and PR-triggered CI.
  - Imports RAG dependencies and runs `python -m pytest -q` after installation.
- `services/ml/Dockerfile`
  - Uses the same CPU-only PyTorch installation and CUDA assertion before application requirements.
- `services/ml/tests/test_rag.py`
  - Adds a no-network test for lexical retrieval and the retrieval-only answer fallback.
- `services/ml/scripts/smoke_rag_embedding.py`
  - Adds an explicit full ChromaDB/sentence-transformer smoke path. It may download the embedding model and has not run in this sandbox.
- `services/ml/README.md`
  - Documents the CPU-only CI behavior, lightweight test boundary and full RAG smoke command.
- `docs/IMPLEMENTATION_STATUS.md`, `docs/QUEST-TRACEABILITY.md`, `docs/NOVO-PRD-COVERAGE.md`
  - Corrects mismatched FR/NFR evidence and records the CI causes/fixes without claiming a green run.

## Actual verification in this session

| Command / check | Result |
| --- | --- |
| Bundled Python `-m compileall services/ml/app services/ml/tests` | **PASS**, exit 0. Includes the new lightweight RAG test and full-smoke script syntax is separately inspected. |
| Bundled Python `-m pytest -q` from `services/ml` | **BLOCKED**, exit 1: `No module named pytest`; the bundled runtime has no project ML dependencies. |
| `pnpm install --frozen-lockfile`, `pnpm db:generate`, `pnpm build`, `pnpm test`, `pnpm lint` | **BLOCKED** in this Codex sandbox by the pre-existing pnpm project-store symlink `EPERM` constraint. |
| Docker Compose / ML container build | **BLOCKED**: Docker is unavailable in this environment. |
| Git staging/commit in Codex | **BLOCKED**, `git add` exit 128: cannot create `.git/index.lock` (`Permission denied`). |
| `gh pr checks 1` and `gh run list` | **BLOCKED**, exit 1: this Codex environment cannot connect to `api.github.com`; no latest remote check status was retrieved. |
| GitHub Actions after the fix | **NOT RUN YET**: requires committing and pushing this branch to update PR #1. |

## Requirement status after evidence correction

The count is unchanged: `verified` 0, `partial` 70, `blocked` 6, `not-started` 10 (total 86). Python syntax compilation is useful evidence but is not a working-behavior test, so no requirement was promoted to `verified`.

Corrected evidence includes FR-003 through FR-011 and FR-013, plus NFR-004, NFR-009 and NFR-010. The tracker still contains each of the 86 official IDs exactly once.

## Remaining review gates

1. Commit/push the prepared changes on the existing branch and confirm PR #1 starts a new Actions run.
2. Confirm the pnpm setup phase no longer reports “Multiple versions of pnpm specified.”
3. Confirm CPU-only PyTorch assertion succeeds, no CUDA/NVIDIA wheel download exhausts disk, then inspect the first real `pytest` result.
4. Run the documented full embedding/Chroma smoke command in a suitable environment before asserting full RAG verification.
5. Do not merge PR #1 and do not begin Sprint 02 before owner review.

## Safe PowerShell completion from the owner workstation

The Codex sandbox may still reject `.git/index.lock`; this does not change the existing PR or branch. From the already-authenticated owner PowerShell, run:

```powershell
Set-Location 'C:\Users\raden\dev\projects\NOVO-Business-Centre'
git switch codex/sprint-01-foundation
git status --short
git add -- .github/workflows/ci.yml services/ml/Dockerfile services/ml/README.md services/ml/tests/test_rag.py services/ml/scripts/smoke_rag_embedding.py docs/IMPLEMENTATION_STATUS.md docs/QUEST-TRACEABILITY.md docs/NOVO-PRD-COVERAGE.md docs/CODEX_HANDOFF.md
git diff --cached --check
git diff --cached
git commit -m "ci: use CPU-only ML dependencies"
git push origin codex/sprint-01-foundation
& "C:\Program Files\GitHub CLI\gh.exe" pr checks 1 --repo RadenAlta/NOVO-Business-Centre
& "C:\Program Files\GitHub CLI\gh.exe" run list --repo RadenAlta/NOVO-Business-Centre --branch codex/sprint-01-foundation --limit 5
```

That push updates PR #1; it does not create a new PR. If the new run fails, collect its failed log with `gh run view <RUN_ID> --repo RadenAlta/NOVO-Business-Centre --log-failed` and continue from the actual failure.
