# Asah checklist traceability

Status reflects source implementation at this revision, not a claim of assessment completion. **Implemented** means source code is present; **Partial** means a bounded implementation has a named operational or verification gap; **Gap** means it is deliberately not claimed. Test status is updated only after commands actually pass.

## Main Quest (20)

| Track | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| Full-stack | Specific UMKM problem | Implemented | `README.md`, `docs/DATA-PROBLEM.md` |
| Full-stack | At least two core features | Implemented | Store, shuttle, catering, funding, financing modules |
| Full-stack | Input causes matching result | Implemented | Express mutations and responsive React forms |
| Full-stack | Clear success/failure/loading state | Partial | Most UI mutations have messages; formal browser E2E pending |
| Full-stack | Usable with clear guide | Partial | README and screen labels; usability review pending |
| Full-stack | Public browser/mobile access | Gap | Responsive build exists, but no deployment is configured |
| Gen AI | Custom data-suited AI model | Implemented | Original TF-IDF intent-training pipeline |
| Gen AI | Preprocessing before model | Implemented | TF-IDF pipeline and validated input |
| Gen AI | Dataset/source documented | Implemented | Synthetic corpus and caveat in ML README |
| Gen AI | Additional proprietary GenAI feature | Partial | Server-side OpenAI Responses integration needs user-owned key |
| Gen AI | Compare two model configurations | Implemented | Logistic Regression vs LinearSVC, endpoint report |
| Gen AI | FastAPI/Flask online serving | Implemented | FastAPI service with OpenAPI docs |
| Data Science | Business problem/data role | Implemented | `docs/DATA-PROBLEM.md` |
| Data Science | Business questions | Implemented | Revenue, category, product, low-stock and demand questions |
| Data Science | Data wrangling | Implemented | CSV schema/type validation and filters in Streamlit |
| Data Science | Analyze data for business question | Implemented | Interactive dashboard computations |
| Data Science | Understandable findings/recommendation | Partial | Direct indicators/exception queue; no real-data finding claimed |
| Data Science | Share usable data/results | Implemented | CSV upload/filter/export + data dictionary |
| Data Science | Verify data/results | Partial | Input validation and source disclosure; production DQ checks pending |
| Data Science | Model prediction in feature | Implemented | Demand web card calls the backend ML proxy and presents its caveat |

## Side Quest (42)

| # | Track | Requirement | Status | Evidence / gap |
| ---: | --- | --- | --- | --- |
| 1 | FS | Decoupled front-end/back-end | Implemented | Vite web + Express API networking |
| 2 | FS | Module bundler | Implemented | Vite |
| 3 | FS | Express + versioned API URL | Implemented | `apps/api`, `/api/v1` |
| 4 | FS | CSS framework + modern UI components | Partial | Tailwind + responsive component design; no dedicated UI-component package |
| 5 | FS | Axios networking | Gap | Uses native Fetch; not equivalent to Axios checklist wording |
| 6 | FS | Persistent data | Implemented | PostgreSQL Prisma schema/migrations target |
| 7 | FS | GenAI through backend | Implemented | `/ai/assist` server-only provider call |
| 8 | FS | Data Science result in relevant feature | Implemented | Demand card calls tenant-protected backend ML proxy |
| 9 | FS | GenAI history in database | Implemented | `AiInteraction` model writes requests/responses |
| 10 | FS | Backend schema validation | Implemented | Zod (explicitly allowed by “such as Joi”) |
| 11 | FS | Failures clearly handled | Implemented | Error envelope, UI messages, provider/ML unavailable states |
| 12 | FS | Mockup before development | Gap | No pre-development mockup is asserted |
| 13 | FS | Responsive design decisions | Implemented | Mobile sidebar/grid breakpoints |
| 14 | FS | Git + hosted Git history | Partial | Local Git repo initialised; remote/PR history not created |
| 15 | FS | API/data contract agreed across tracks | Partial | Written contract exists; no team agreement evidence |
| 16 | FS | Free-tier deployment | Gap | Deployment-ready notes only; not deployed |
| 17 | Gen AI | Class-balance check/remediation | Implemented | Four synthetic classes have equal count; documented corpus |
| 18 | Gen AI | Tuning/performance improvement | Gap | No tuning experiment is claimed |
| 19 | Gen AI | Held-out evaluation with metric | Implemented | Macro F1 / RMSE in `/v1/evaluations` |
| 20 | Gen AI | Additional complementary model | Implemented | Demand regressor complements intent classifier |
| 21 | Gen AI | RAG: embed + vector DB + generation | Partial | Chroma + sentence-transformer + optional provider generation; provider/local model runtime required |
| 22 | Gen AI | Intent routing at least four intents | Implemented | PRODUCT, BOOKING, COMPLAINT, PAYMENT; complaint escalates |
| 23 | Gen AI | Structured prompt | Implemented | Server system instructions with context restriction |
| 24 | Gen AI | Test 10 out-of-scope questions/refusal | Gap | Dedicated OOD guardrail suite not built |
| 25 | Gen AI | API contract agreed across tracks | Partial | Written contract exists; no team agreement evidence |
| 26 | Gen AI | Invalid input/AI quota failure | Implemented | Zod and explicit 502/503 handling |
| 27 | Gen AI | WhatsApp/Telegram channel | Gap | No external channel integration |
| 28 | Gen AI | Testable API documentation | Implemented | FastAPI `/docs` OpenAPI |
| 29 | DS | Interactive dashboard | Implemented | Streamlit app |
| 30 | DS | Relevant indicators and filters | Implemented | Date/category controls and KPI/exception views |
| 31 | DS | File/source refresh | Implemented | CSV upload path |
| 32 | DS | Primary-data priority/dummy labelling | Implemented | Source selector and visible synthetic label |
| 33 | DS | Dashboard embedded/integrated in web | Partial | Web link opens dashboard; no authenticated embed |
| 34 | DS | Data needs agreed with GenAI | Partial | Contract/data dictionary exist; no team agreement evidence |
| 35 | DS | Label/transformation/feature engineering | Implemented | Intent labels; demand features; validated parsing |
| 36 | DS | Data dictionary | Implemented | `apps/dashboard/DATA_DICTIONARY.md` |
| 37 | DS | Train/test split and leakage prevention | Implemented | Stratified intent split; separate demand holdout |
| 38 | DS | Appropriate prediction model | Implemented | Intent classifier and demand regressor |
| 39 | DS | Feature engineering + performance effect | Partial | Features/evaluation exist; no ablation study |
| 40 | DS | Unseen-test evaluation | Implemented | Held-out F1 and RMSE |
| 41 | DS | Compare models/limitations | Implemented | Two candidate reports + explicit caveat |
| 42 | DS | Prediction integrated in web | Implemented | Demand card in web overview calls the backend proxy |

## Honest current total

Source coverage is **not 62/62**. At this point, 42 checklist rows have an implementation basis, 13 are partial, and 7 are gaps. These counts are informational traceability, not a course score. Deployment, formal browser tests, real-data governance, a committed Git remote, OOD guardrails, and a human review of the demand UI remain the biggest unfinished items.
## Verification completed in this workspace

- The latest Prisma schema validation and Prisma Client generation with `--no-engine` completed using a local development connection string.
- The latest changed API and web modules passed TypeScript syntax transpilation.
- Focused strict TypeScript checks passed for the latest API entrypoint, authentication middleware, synthetic seed, and the complete web project.
- API unit tests previously passed: 2 tests in `apps/api/src/lib.test.ts`.
- Python syntax compilation previously passed for all ML service modules and its test module.

## Verification not claimed

- A full API TypeScript run did not complete inside this session's command window after the latest schema changes; it requires a normal local/CI run before release.
- The ML test suite was not run because the bundled Python runtime does not include `pytest` or `scikit-learn`.
- No PostgreSQL container, migration application, browser end-to-end test, production deployment, or external messaging channel was available in this workspace.
- `pnpm --filter @novo/web build` is blocked in this desktop sandbox because pnpm cannot create its project-store symlink. A direct Vite build began transforming the app but reached the command time limit before its final exit status. Run the normal build in a non-sandboxed local/CI environment.
