-- Preserve a stable, session-bound CSRF value so concurrent /me reads do not invalidate each other.
-- Raw browser session tokens remain SHA-256-hashed only; this field is not an authentication credential.
ALTER TABLE "UserSession" ADD COLUMN "csrfToken" TEXT;