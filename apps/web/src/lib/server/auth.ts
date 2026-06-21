import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { createDatabaseClients, account, session, user, verification } from "@scope/db";
import { loadEnv, type Env } from "@scope/config";
import { DrizzleSessionRepo } from "@scope/adapters";
import type { UserLinkRepo } from "@scope/core";

type Database = ReturnType<typeof createDatabaseClients>["db"];

export interface CreateAuthOptions {
  database: BetterAuthOptions["database"];
  secret: string;
  baseURL: string;
  google?: { clientId: string; clientSecret: string };
  onLinkAnonymousAccount?: (input: { anonymousUserId: string; newUserId: string }) => Promise<void> | void;
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    database: options.database,
    secret: options.secret,
    baseURL: options.baseURL,
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
): CreateAuthOptions {
  return {
    database,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
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
  return createAuthFromDatabase(env, db, new DrizzleSessionRepo(db));
}

export function createAuthFromDatabase(env: Env, db: Database, userLinks: UserLinkRepo) {
  return createAuth(createAuthOptionsFromEnv(
    env,
    drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    ({ anonymousUserId, newUserId }) => userLinks.reassignUserRows(anonymousUserId, newUserId),
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
