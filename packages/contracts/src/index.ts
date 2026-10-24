export const API_PREFIX = "/api/v1" as const;

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
] as const;

export type UserRole = (typeof userRoles)[number];

export type ApiError = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: UserRole;
};

export type ProductInput = {
  sku: string;
  name: string;
  unitPrice: number;
  reorderLevel?: number;
};

export type SaleLineInput = {
  productId: string;
  quantity: number;
};

export type Paginated<T> = {
  data: T[];
  nextCursor?: string;
};
