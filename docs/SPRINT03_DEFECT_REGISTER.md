# Sprint 03 defect register — PR #3 security hardening

| ID | Severity | Disposition | Evidence / remaining condition |
| --- | --- | --- | --- |
| HIGH-03 | High | CLOSED at `28fa14a` | Hosted PR #3 CI 4/4 was reported passing; PostgreSQL regression proves a student-heavy directory does not hide eligible teachers or employees. |
| HIGH-04 | High | CLOSED at `28fa14a` | Hosted CI includes the external hyperlink and formula-policy regressions. |
| HIGH-05 | High | CLOSED at `28fa14a` | Hosted PostgreSQL trigger-failure regression proves membership creation/status and audit roll back together. |
| HIGH-06 | High | code fixed; hosted CI pending | Actual ZIP decompression is capped at 10 MiB before ExcelJS; every entry’s actual and declared size is checked, and cumulative actual output is capped. Local regression rejects falsified small metadata for an entry that expands past the cap. |
| HIGH-07 | High | code fixed; hosted CI pending | A bounded SAX parser examines every `.rels` part, including `_rels/.rels`, decodes attributes, rejects `TargetMode=External`, `DOCTYPE`, malformed XML, excess relationships, and oversized relationship XML. |
| MED-01 | Medium | OPEN | A scheduled retention purge for expired structured preview payloads is mandatory before any production use with personal data. Raw XLSX bytes are already not persisted. |
| MED-02 | Medium | CLOSED at `28fa14a` | Template has no importable demo rows; synthetic examples live only in `Instructions`. |
| MED-03 | Medium | CLOSED at `28fa14a` | SIMS-managed activation state is rejected from the manual API. |
| FR-003-D | Low | documented | Soft deactivation is the Sprint 03 delete operation; hard delete would break business history. |

The passing 4/4 GitHub Actions result belongs to `28fa14a`; it does not verify the uncommitted HIGH-06/HIGH-07 hardening. No requirement status is promoted to `verified` from this register alone.
