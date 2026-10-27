import { z } from "zod";

export const id = z.string().cuid();
export const money = z.coerce.number().finite().nonnegative().max(999_999_999);
export const date = z.coerce.date();
export const paymentMethod = z.enum(["CASH", "TRANSFER", "QRIS", "CARD"]);
export const memberInput = z.object({
  identityId: id,
  memberNo: z.string().trim().min(2).max(50),
});
