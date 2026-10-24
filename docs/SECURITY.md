# Security notes

- Set a randomly generated `JWT_SECRET` of at least 32 characters outside local development; keep it only in server-side environment configuration.
- Passwords are stored only as bcrypt hashes. The bootstrap endpoint permanently disables itself after the first tenant exists.
- The API derives the tenant from verified authentication claims and checks roles on protected business routes. It never accepts a client-supplied tenant id.
- Login also sets an `HttpOnly`, `SameSite=Lax` session cookie. The current React client continues to use its returned bearer token; this is a transitional compatibility path, **not** a database-backed revocable-session system. Logout clears the cookie; a copied bearer token remains valid until its eight-hour expiry. Replace it with server-side session storage/revocation before production.
- Validate request bodies with Zod. Do not place service-provider keys in the browser.
- Attachment uploads are size-limited, filename-sanitised, type allow-listed, checked against PDF/JPEG/PNG/WEBP binary signatures, and SHA-256 recorded. The local filesystem is for development only. Production still needs private object storage, malware scanning, per-entity authorization, signed download URLs, retention policy, and key rotation.
- Run TLS at the ingress, restrict CORS to the deployed web origin, use secure cookies, rotate secrets, and review audit events regularly.
- Financial records are append-only ledgers. Corrections should be compensating entries, not database edits.