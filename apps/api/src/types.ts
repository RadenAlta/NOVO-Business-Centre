import type { UserRole } from "./roles.js";
import type { Request } from "express";

export type AuthContext = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
};

export type AuthenticatedRequest = Request & { auth: AuthContext };
