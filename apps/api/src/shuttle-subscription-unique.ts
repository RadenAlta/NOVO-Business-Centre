const activeShuttleSubscriptionIndexes = [
  "ShuttleSubscription_active_member_unique_idx",
  "ShuttleSubscription_active_student_unique_idx",
] as const;

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
  const identifier = Array.isArray(target) ? target.join(",") : String(target ?? "");
  const message = error instanceof Error ? error.message : "";
  return [identifier, message].some((value) =>
    activeShuttleSubscriptionIndexes.some((index) => value.includes(index)),
  );
}
