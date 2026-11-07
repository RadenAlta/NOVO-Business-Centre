const activeShuttleSubscriptionIndexes = [
  "ShuttleSubscription_active_member_unique_idx",
  "ShuttleSubscription_active_student_unique_idx",
] as const;

const activeShuttleSubscriptionFieldTuples = [
  ["tenantId", "routeId", "memberId"],
  ["tenantId", "routeId", "studentIdentityId"],
] as const;

function hasExactNamedIndex(value: string): boolean {
  return activeShuttleSubscriptionIndexes.some((index) => value === index);
}

function hasExactNamedIndexTarget(target: unknown): boolean {
  if (typeof target === "string") return hasExactNamedIndex(target);
  return Array.isArray(target) && target.length === 1 && typeof target[0] === "string" && hasExactNamedIndex(target[0]);
}

function hasPostgresConstraintName(value: string): boolean {
  return activeShuttleSubscriptionIndexes.some((index) =>
    new RegExp(`\\bunique constraint\\s+"${index}"`, "i").test(value),
  );
}

function hasExactFieldTuple(target: unknown): boolean {
  if (!Array.isArray(target) || !target.every((field) => typeof field === "string")) return false;
  const fields = new Set(target);
  return activeShuttleSubscriptionFieldTuples.some(
    (expected) => target.length === expected.length && fields.size === expected.length && expected.every((field) => fields.has(field)),
  );
}

/** Identifies only the two partial unique indexes added for active Shuttle riders. */
export function isActiveShuttleSubscriptionUniqueConflict(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    !error ||
    !("code" in error) ||
    (error as { code?: string }).code !== "P2002"
  ) {
    return false;
  }

  const target =
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta &&
    "target" in error.meta
      ? error.meta.target
      : undefined;
  const message = error instanceof Error ? error.message : "";
  return hasExactNamedIndexTarget(target) || hasExactFieldTuple(target) || hasPostgresConstraintName(message);
}
