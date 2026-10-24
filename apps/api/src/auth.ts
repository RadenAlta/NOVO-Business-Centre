import { userRoles, type UserRole } from "./roles.js";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { HttpError } from "./lib.js";
import type { AuthContext, AuthenticatedRequest } from "./types.js";

const delegatedRoles: Partial<Record<UserRole, readonly UserRole[]>> = {
  SUPER_ADMIN: userRoles,
  CHAIRMAN: ["OWNER", "ADMIN", "FLEET_MANAGER", "CATERING_MANAGER", "FINANCE_OFFICER", "PROCUREMENT_OFFICER", "ANALYST"],
  TREASURER: ["FINANCE_OFFICER", "ANALYST"],
  BUSINESS_DEVELOPMENT: ["FLEET_MANAGER", "CATERING_MANAGER", "PROCUREMENT_OFFICER", "ANALYST"],
  ADMIN_STAFF: ["ADMIN", "FLEET_MANAGER", "CATERING_MANAGER", "PROCUREMENT_OFFICER", "ANALYST"],
  AUDITOR: ["ANALYST"],
};

export function signToken(user: AuthContext): string {
  return jwt.sign(user, env.JWT_SECRET, { expiresIn: "8h", issuer: "novo-api", audience: "novo-web" });
}

export function setSessionCookie(response: Response, token: string): void {
  response.cookie("novo_session", token, { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000, path: "/api/v1" });
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie("novo_session", { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/api/v1" });
}

function tokenFrom(request: Request): string | undefined {
  const bearer = request.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  return request.header("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("novo_session="))?.slice("novo_session=".length);
}

export async function authenticate(request: Request, _response: Response, next: NextFunction): Promise<void> {
  const token = tokenFrom(request);
  if (!token) { next(new HttpError(401, "UNAUTHENTICATED", "A valid session is required.")); return; }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: "novo-api", audience: "novo-web" });
    if (typeof payload !== "object" || !payload || !("id" in payload) || !("tenantId" in payload)) throw new Error("Malformed token.");
    const claims = payload as AuthContext;
    const user = await prisma.user.findFirst({
      where: { id: claims.id, tenantId: claims.tenantId, active: true },
      select: { id: true, tenantId: true, email: true, name: true, role: true },
    });
    if (!user) { next(new HttpError(401, "ACCOUNT_INACTIVE", "This account is unavailable.")); return; }
    (request as AuthenticatedRequest).auth = user;
    next();
  } catch (error) {
    if (error instanceof HttpError) { next(error); return; }
    next(new HttpError(401, "UNAUTHENTICATED", "Your session is invalid or expired."));
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const user = (request as AuthenticatedRequest).auth;
    const permitted = user && (roles.includes(user.role) || (delegatedRoles[user.role] ?? []).some((role) => roles.includes(role)));
    if (!permitted) return next(new HttpError(403, "FORBIDDEN", "You do not have access to this action."));
    next();
  };
}