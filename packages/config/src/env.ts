import { createEnv } from "@t3-oss/env-core";
import * as z from "zod/v4";

const provider = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.enum(values).default(fallback);

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const optionalBool = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    return value === "1" || value === "true";
  });
const authSecret = z
  .string()
  .min(32)
  .refine(
    (value) => !["replace-me-with-openssl-rand-base64-48", "dev-secret-change-me"].includes(value),
    "BETTER_AUTH_SECRET must be a generated secret",
  );

const server = {
  DATABASE_URL: z.url(),
  DATABASE_DIRECT_URL: z.url(),
  REDIS_URL: z.url(),
  PLACES_PROVIDER: provider(["google", "fake"] as const, "fake"),
  OCR_PROVIDER: provider(["mindee", "fake"] as const, "fake"),
  GOOGLE_MAPS_API_KEY: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: authSecret,
  BETTER_AUTH_URL: z.url(),
  PROMOTE_THRESHOLD: positiveInt(2),
  REJECT_STREAK: positiveInt(5),
  RADIUS_BASE_M: positiveInt(500),
  RADIUS_STEP_M: positiveInt(500),
  RADIUS_CAP_M: positiveInt(3000),
  POLL_TIMER_MS: positiveInt(300000),
  PLACES_CACHE_TTL_S: positiveInt(1800),
  RATE_LIMIT_ENABLED: optionalBool,
  TRUSTED_IP_HEADER: z.string().min(1).optional(),
};

export interface Env {
  DATABASE_URL: string;
  DATABASE_DIRECT_URL: string;
  REDIS_URL: string;
  PLACES_PROVIDER: "google" | "fake";
  OCR_PROVIDER: "mindee" | "fake";
  GOOGLE_MAPS_API_KEY?: string | undefined;
  GOOGLE_CLIENT_ID?: string | undefined;
  GOOGLE_CLIENT_SECRET?: string | undefined;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  PROMOTE_THRESHOLD: number;
  REJECT_STREAK: number;
  RADIUS_BASE_M: number;
  RADIUS_STEP_M: number;
  RADIUS_CAP_M: number;
  POLL_TIMER_MS: number;
  PLACES_CACHE_TTL_S: number;
  RATE_LIMIT_ENABLED?: boolean | undefined;
  TRUSTED_IP_HEADER?: string | undefined;
}

export function parseEnv(src: Record<string, string | undefined>): Env {
  return createEnv({
    server,
    runtimeEnv: src,
    emptyStringAsUndefined: true,
    onValidationError: (issues) => {
      throw new Error(
        `Invalid environment variables: ${issues.map((issue) => issue.path?.join(".") ?? issue.message).join(", ")}`,
      );
    },
  });
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}
