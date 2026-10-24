import { z } from "zod";

export const id = z.string().cuid();
export const money = z.coerce.number().finite().nonnegative().max(999_999_999);
export const date = z.coerce.date();
export const paymentMethod = z.enum(["CASH", "TRANSFER", "QRIS", "CARD"]);
export const memberInput = z.object({
  identityId: id.optional(),
  memberNo: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(6).max(30).optional(),
});
