import * as z from "zod/v4";

const publicEnvSchema = z.object({
  PUBLIC_USE_MOCK: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export interface PublicEnv {
  useMock: boolean;
}

export function parsePublicEnv(src: Record<string, unknown>): PublicEnv {
  const result = publicEnvSchema.safeParse(src);
  if (!result.success) {
    return { useMock: false };
  }
  return { useMock: result.data.PUBLIC_USE_MOCK ?? false };
}
