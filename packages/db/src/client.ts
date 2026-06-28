import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export interface DatabaseUrlEnv {
  DATABASE_URL: string;
  DATABASE_DIRECT_URL: string;
}

export function createDatabaseClients(env: DatabaseUrlEnv) {
  const pooledOptions = { url: env.DATABASE_URL, prepare: false };
  const directOptions = { url: env.DATABASE_DIRECT_URL };
  const pooledSql = postgres(pooledOptions.url, {
    prepare: pooledOptions.prepare,
  });
  const directSql = postgres(directOptions.url);

  return {
    pooledOptions,
    directOptions,
    pooledSql,
    directSql,
    db: drizzle(pooledSql, { schema }),
    directDb: drizzle(directSql, { schema }),
  };
}
