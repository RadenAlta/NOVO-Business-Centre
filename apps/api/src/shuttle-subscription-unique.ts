const activeShuttleSubscriptionIndexes = [
  "ShuttleSubscription_active_member_unique_idx",
  "ShuttleSubscription_active_student_unique_idx",
] as const;
const activeShuttleSubscriptionFieldTuples = [
  ["tenantId", "routeId", "memberId"],
  ["tenantId", "routeId", "studentIdentityId"],
] as const;

function hasExactFieldTuple(target: unknown): boolean {
  if (!Array.isArray(target) || target.length !== 3 || !target.every((field) => typeof field === "string")) return false;
  return activeShuttleSubscriptionFieldTuples.some((tuple) => tuple.every((field, index) => target[index] === field));
}

function hasApprovedIndexName(target: unknown): boolean {
  if (typeof target === "string") return activeShuttleSubscriptionIndexes.includes(target as typeof activeShuttleSubscriptionIndexes[number]);
  return Array.isArray(target) && target.length === 1 && typeof target[0] === "string" && activeShuttleSubscriptionIndexes.includes(target[0] as typeof activeShuttleSubscriptionIndexes[number]);
}

function hasApprovedPostgresIndexMessage(message: string): boolean {
  return activeShuttleSubscriptionIndexes.some((index) => new RegExp(`(^|[^A-Za-z0-9_])${index}(?![A-Za-z0-9_])`).test(message));
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
  return hasApprovedIndexName(target) || hasExactFieldTuple(target) || hasApprovedPostgresIndexMessage(message);
}
