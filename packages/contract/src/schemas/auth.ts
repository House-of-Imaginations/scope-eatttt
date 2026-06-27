import { z } from "zod";

export const AbsorbGuestInput = z.object({
  anonUserId: z.string().min(1),
});

export type AbsorbGuestInput = z.infer<typeof AbsorbGuestInput>;
