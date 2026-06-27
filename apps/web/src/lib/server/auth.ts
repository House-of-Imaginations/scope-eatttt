import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDatabaseClients, account, session, user, verification } from "@scope/db";
import { loadEnv, type Env } from "@scope/config";
import { DrizzleSessionRepo, RedisSecondaryStorage } from "@scope/adapters";
import type { UserLinkRepo } from "@scope/core";

type Database = ReturnType<typeof createDatabaseClients>["db"];

export interface CreateAuthOptions {
  database: BetterAuthOptions["database"];
  secret: string;
  baseURL: string;
  google?: { clientId: string; clientSecret: string };
  secondaryStorage?: BetterAuthOptions["secondaryStorage"];
  rateLimit?: BetterAuthOptions["rateLimit"];
  advanced?: BetterAuthOptions["advanced"];
  onLinkAnonymousAccount?: (input: { anonymousUserId: string; newUserId: string }) => Promise<void> | void;
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    database: options.database,
    secret: options.secret,
    baseURL: options.baseURL,
    ...(options.secondaryStorage === undefined ? {} : { secondaryStorage: options.secondaryStorage }),
    ...(options.rateLimit === undefined ? {} : { rateLimit: options.rateLimit }),
    ...(options.advanced === undefined ? {} : { advanced: options.advanced }),
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      ...(options.google === undefined ? {} : { google: options.google }),
    },
    user: {
      additionalFields: {
        displayName: {
          type: "string",
          required: false,
        },
      },
    },
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await options.onLinkAnonymousAccount?.({
            anonymousUserId: anonymousUser.user.id,
            newUserId: newUser.user.id,
          });
        },
      }),
    ],
  });
}

export function createAuthOptionsFromEnv(
  env: Env,
  database: BetterAuthOptions["database"],
  onLinkAnonymousAccount?: CreateAuthOptions["onLinkAnonymousAccount"],
  secondaryStorage?: CreateAuthOptions["secondaryStorage"],
): CreateAuthOptions {
  const rateLimit = secondaryStorage === undefined
    ? undefined
    : {
        enabled: env.RATE_LIMIT_ENABLED ?? process.env.NODE_ENV === "production",
        window: 60,
        max: 100,
        storage: "secondary-storage",
        customRules: {
          "/sign-in/email": { window: 60, max: 10 },
          "/sign-up/email": { window: 60, max: 10 },
          "/sign-in/anonymous": { window: 60, max: 10 },
          "/get-session": false,
        },
      } satisfies BetterAuthOptions["rateLimit"];
  const trustedIpHeader = env.TRUSTED_IP_HEADER ?? (secondaryStorage === undefined ? undefined : "x-real-ip");
  const advanced = trustedIpHeader === undefined
    ? undefined
    : { ipAddress: { ipAddressHeaders: [trustedIpHeader] } } satisfies BetterAuthOptions["advanced"];

  return {
    database,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    ...(secondaryStorage === undefined ? {} : { secondaryStorage, rateLimit }),
    ...(advanced === undefined ? {} : { advanced }),
    ...(env.GOOGLE_CLIENT_ID === undefined || env.GOOGLE_CLIENT_SECRET === undefined
      ? {}
      : {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
        }),
    ...(onLinkAnonymousAccount === undefined ? {} : { onLinkAnonymousAccount }),
  };
}

export function createAuthFromEnv(env: Env = loadEnv()) {
  const { db } = createDatabaseClients(env);
  return createAuthFromDatabase(env, db, new DrizzleSessionRepo(db), RedisSecondaryStorage.fromUrl(env.REDIS_URL));
}

export function createAuthFromDatabase(env: Env, db: Database, userLinks: UserLinkRepo, secondaryStorage?: CreateAuthOptions["secondaryStorage"]) {
  return createAuth(createAuthOptionsFromEnv(
    env,
    drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    ({ anonymousUserId, newUserId }) => userLinks.reassignUserRows(anonymousUserId, newUserId),
    secondaryStorage,
  ));
}

let authInstance: ReturnType<typeof createAuth> | undefined;

export function getAuth(): ReturnType<typeof createAuth> {
  authInstance ??= createAuthFromEnv();
  return authInstance;
}

export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_target, prop, receiver) {
    return Reflect.get(getAuth(), prop, receiver);
  },
});
