import { prisma } from "./db.js";
import type { AuthContext } from "./types.js";

export async function audit(
  actor: AuthContext,
  action: string,
  entityType: string,
  entityId: string,
  after?: unknown,
): Promise<void> {
  await prisma.auditLog.create({
    data: { tenantId: actor.tenantId, actorId: actor.id, action, entityType, entityId, after: after as never },
  });
}
