import { createEnv } from "@t3-oss/env-core";
import * as z from "zod/v4";

// Coerce "1"/"true" → true; everything else (incl. absent, "0", "") → false.
const boolFlag = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

export interface PublicEnv {
  useMock: boolean;
}

// Browser-exposed vars only. Validated/coerced via t3-oss createEnv (same guard
// as the server env), but kept defensive: a bad flag must not crash the client.
export function parsePublicEnv(src: Record<string, unknown>): PublicEnv {
  try {
    const env = createEnv({
      clientPrefix: "PUBLIC_",
      client: { PUBLIC_USE_MOCK: boolFlag },
      runtimeEnv: src as Record<string, string | undefined>,
      emptyStringAsUndefined: true,
      onValidationError: () => {
        throw new Error("invalid public env");
      },
    });
    return { useMock: env.PUBLIC_USE_MOCK };
  } catch {
    return { useMock: false };
  }
}
