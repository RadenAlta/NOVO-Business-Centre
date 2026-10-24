export const userRoles = [
  "OWNER",
  "ADMIN",
  "CASHIER",
  "FLEET_MANAGER",
  "CATERING_MANAGER",
  "FINANCE_OFFICER",
  "PROCUREMENT_OFFICER",
  "ANALYST",
  "VIEWER",
  "SUPER_ADMIN",
  "CHAIRMAN",
  "TREASURER",
  "BUSINESS_DEVELOPMENT",
  "ADMIN_STAFF",
  "AUDITOR",
] as const;

export type UserRole = (typeof userRoles)[number];
