import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

import { prisma } from "./db.js";
import { env } from "./env.js";
import { HttpError } from "./lib.js";
import { userRoles, type UserRole } from "./roles.js";
import type { AuthContext, AuthenticatedRequest } from "./types.js";

export const SESSION_COOKIE_NAME = "novo_session";
export const CSRF_HEADER_NAME = "x-novo-csrf";

const delegatedRoles: Partial<Record<UserRole, readonly UserRole[]>> = {
  SUPER_ADMIN: userRoles,
  CHAIRMAN: ["OWNER", "ADMIN", "FLEET_MANAGER", "CATERING_MANAGER", "FINANCE_OFFICER", "PROCUREMENT_OFFICER", "ANALYST"],
  TREASURER: ["FINANCE_OFFICER", "ANALYST"],
  BUSINESS_DEVELOPMENT: ["FLEET_MANAGER", "CATERING_MANAGER", "PROCUREMENT_OFFICER", "ANALYST"],
  ADMIN_STAFF: ["ADMIN", "FLEET_MANAGER", "CATERING_MANAGER", "PROCUREMENT_OFFICER", "ANALYST"],
  AUDITOR: ["ANALYST"],
};

export type BrowserSession = {
  token: string;
  csrfToken: string;
  expiresAt: Date;
};

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
  path: "/api/v1",
};

export const hashSecret = (value: string): string => createHash("sha256").update(value).digest("hex");

function randomSecret(): string {
  return randomBytes(32).toString("base64url");
}

function cookieValue(request: Request, name: string): string | undefined {
  const entry = request.header("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!entry) return undefined;
  try { return decodeURIComponent(entry.slice(`${name}=`.length)); } catch { return undefined; }
}

function sameSecret(provided: string | undefined, expectedHash: string): boolean {
  if (!provided) return false;
  const providedHash = Buffer.from(hashSecret(provided), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return providedHash.length === expected.length && timingSafeEqual(providedHash, expected);
}

export function sessionTokenFrom(request: Request): string | undefined {
  return cookieValue(request, SESSION_COOKIE_NAME);
}

export async function createBrowserSession(user: AuthContext): Promise<BrowserSession> {
  const token = randomSecret();
  const csrfToken = randomSecret();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_SECONDS * 1000);
  await prisma.userSession.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      tokenHash: hashSecret(token),
      csrfTokenHash: hashSecret(csrfToken),
      expiresAt,
    },
  });
  return { token, csrfToken, expiresAt };
}

export async function rotateCsrfToken(sessionId: string): Promise<string> {
  const csrfToken = randomSecret();
  const updated = await prisma.userSession.updateMany({
    where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { csrfTokenHash: hashSecret(csrfToken) },
  });
  if (!updated.count) throw new HttpError(401, "UNAUTHENTICATED", "Your session is invalid or expired.");
  return csrfToken;
}
export function setSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE_NAME, token, { ...cookieOptions, maxAge: env.SESSION_TTL_SECONDS * 1000 });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, cookieOptions);
}

export function requireTrustedOrigin(request: Request, _response: Response, next: NextFunction): void {
  const origin = request.header("origin");
  const referer = request.header("referer");
  if (origin === env.WEB_ORIGIN || (!origin && referer?.startsWith(`${env.WEB_ORIGIN}/`))) { next(); return; }
  next(new HttpError(403, "UNTRUSTED_ORIGIN", "This request did not come from the configured web origin."));
}

export async function authenticate(request: Request, _response: Response, next: NextFunction): Promise<void> {
  const token = sessionTokenFrom(request);
  if (!token) { next(new HttpError(401, "UNAUTHENTICATED", "A valid session is required.")); return; }
  try {
    const session = await prisma.userSession.findFirst({
      where: {
        tokenHash: hashSecret(token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { active: true },
      },
      include: { user: { select: { id: true, tenantId: true, email: true, name: true, role: true, active: true } } },
    });
    if (!session || !session.user.active || session.tenantId !== session.user.tenantId) {
      next(new HttpError(401, "UNAUTHENTICATED", "Your session is invalid or expired.")); return;
    }
    (request as AuthenticatedRequest).auth = session.user;
    (request as AuthenticatedRequest).session = { id: session.id, csrfTokenHash: session.csrfTokenHash };
    next();
  } catch (error) {
    if (error instanceof HttpError) { next(error); return; }
    next(new HttpError(401, "UNAUTHENTICATED", "Your session is invalid or expired."));
  }
}

export function requireCsrf(request: Request, _response: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) { next(); return; }
  const session = (request as AuthenticatedRequest).session;
  if (!session) { next(new HttpError(401, "UNAUTHENTICATED", "A valid session is required.")); return; }
  if (!sameSecret(request.header(CSRF_HEADER_NAME), session.csrfTokenHash)) {
    next(new HttpError(403, "CSRF_INVALID", "A valid CSRF token is required for this request.")); return;
  }
  requireTrustedOrigin(request, _response, next);
}

export async function revokeSessionForLogout(request: Request): Promise<"missing" | "revoked"> {
  const token = sessionTokenFrom(request);
  if (!token) return "missing";
  const session = await prisma.userSession.findFirst({
    where: { tokenHash: hashSecret(token), revokedAt: null, expiresAt: { gt: new Date() }, user: { active: true } },
    select: { id: true, csrfTokenHash: true },
  });
  if (!session) return "missing";
  if (!sameSecret(request.header(CSRF_HEADER_NAME), session.csrfTokenHash)) {
    throw new HttpError(403, "CSRF_INVALID", "A valid CSRF token is required for this request.");
  }
  await prisma.userSession.updateMany({ where: { id: session.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return "revoked";
}

export function requireRoles(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const user = (request as AuthenticatedRequest).auth;
    const permitted = user && (roles.includes(user.role) || (delegatedRoles[user.role] ?? []).some((role) => roles.includes(role)));
    if (!permitted) return next(new HttpError(403, "FORBIDDEN", "You do not have access to this action."));
    next();
  };
}