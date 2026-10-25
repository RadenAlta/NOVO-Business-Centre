# Security notes

## Sprint 02 session model

- Browser authentication uses a cryptographically random 256-bit opaque value in the `novo_session` **HttpOnly** cookie. The API stores only its SHA-256 hash in PostgreSQL `UserSession`; the raw session value is never returned in JSON or written to browser storage.
- A session binds `userId`, `tenantId`, creation time, expiry, and revocation time. Every protected request resolves the session, then reads the current active user and role from the database. A revoked, expired, altered, bearer-only, inactive-user, or tenant-mismatched session is rejected.
- Logout revokes the current session before clearing the cookie. A subsequent replay of its captured cookie is rejected. Repeating logout after the cookie is gone is an idempotent `204` response.
- Login, bootstrap, and logout require the configured web origin. For cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` routes, the API additionally requires an `X-Novo-Csrf` token bound to that server-side session. `GET`, `HEAD`, and `OPTIONS` remain safe methods.
- The CSRF token is held only in the React application's memory. `GET /me` returns one stable session-bound value and never rotates it just because it was read, so overlapping tab/StrictMode restores cannot invalidate each other. For legacy rows without that value, the API atomically issues one replacement. The raw CSRF value is not an authentication credential; the raw browser session remains SHA-256-hashed only. No bearer token or session object is saved to `sessionStorage` or `localStorage`.
- Session cookies use `SameSite=Lax`, path `/api/v1`, and `Secure` in production. Deploy behind TLS and configure `WEB_ORIGIN` as the exact HTTPS browser origin. Cross-site cookie use is not supported by this release.

## Additional controls and operating requirements

- Passwords are stored as bcrypt hashes. The bootstrap endpoint permanently disables itself after the first tenant exists.
- Tenant IDs are never accepted from browser authentication input. Protected routes derive tenant scope from the database session, and role checks run after the current user lookup.
- Request bodies use Zod validation. Provider keys remain server-only.
- Attachment uploads are size-limited, filename-sanitised, allow-listed, checked against PDF/JPEG/PNG/WEBP signatures, and recorded with a SHA-256 file digest. Production still needs private object storage, malware scanning, per-entity authorization, signed download URLs, retention policy, and key rotation.
- Financial records use append-only ledger routes. Correct a financial mistake with a compensating entry, not a database edit.

## Verification boundary — 25 October 2026

`apps/api/src/security.integration.test.ts` defines a disposable-PostgreSQL test suite for bootstrap/session hashing, `/me` restoration, logout replay rejection, altered/expired/bearer-only credentials, CSRF/origin rejection, multipart uploads, current role changes, inactive accounts, cross-tenant access, and overlapping `/me` CSRF restoration followed by writes from both responses. Web regression tests cover per-principal React Query cache keys/cache eviction and confirmed versus unconfirmed logout. `.github/workflows/ci.yml` now starts PostgreSQL, applies Prisma migrations, then runs build, tests, and lint. The React Query cache is scoped by tenant, user ID and current role, cancelled/removed during account changes and unauthentication, and query fetches receive the cancellation signal. A failed logout retains the local session and offers retry; only a confirmed `204` or already-invalid `401` clears it.

These controls remain **unverified locally** in the Codex sandbox because pnpm cannot create project-store symlinks and no Docker/PostgreSQL runtime is available. Hosted GitHub Actions on PR head `91b0a23` completed successfully: 4/4 API/Web and ML checks (push `40196407790`, PR `40196411378`), including the disposable PostgreSQL migration and security integration test workflow. This is **not a production security certification**: browser E2E, deployed TLS/proxy/cookie behavior, rate limiting, and a live penetration/threat review remain outside this CI evidence.