import {
  BetterAuthProvider,
  BullQueue,
  DrizzleRelayStore,
  DrizzleSessionRepo,
  GooglePlaces,
  RedisBus,
  RedisCache,
  RedisSecondaryStorage,
} from "@scope/adapters";
import type { Env } from "@scope/config";
import { loadEnv } from "@scope/config";
import type { AuthProvider, Cache, EventBus, JobQueue, PlacesProvider } from "@scope/core";
import { FakePlaces } from "@scope/core";
import { createDatabaseClients } from "@scope/db";
import { createAuthFromDatabase } from "./auth";
import { type OutboxNotifyListener, type RelayStore, createOutboxNotifyListener } from "./relay";
import type { SessionEventReplayStore } from "./sse";

type DatabaseClients = ReturnType<typeof createDatabaseClients>;
type Repo = DrizzleSessionRepo;

export interface AppContainer {
  config: Env;
  repo: Repo;
  bus: EventBus;
  queue: JobQueue;
  cache: Cache;
  places: PlacesProvider;
  auth: AuthProvider;
  relayStore: RelayStore & SessionEventReplayStore;
  relayListener: OutboxNotifyListener;
}

export interface BuildContainerOptions {
  databaseClients?: DatabaseClients;
  repo?: Repo;
  bus?: EventBus;
  queue?: JobQueue;
  cache?: Cache;
  places?: PlacesProvider;
  auth?: AuthProvider;
  relayStore?: RelayStore & SessionEventReplayStore;
  relayListener?: OutboxNotifyListener;
  fetch?: typeof fetch;
}

export function buildContainer(
  env: Env = loadEnv(),
  options: BuildContainerOptions = {},
): AppContainer {
  const databaseClients = options.databaseClients ?? createDatabaseClients(env);
  const repo = options.repo ?? new DrizzleSessionRepo(databaseClients.db);
  const cache = options.cache ?? RedisCache.fromUrl(env.REDIS_URL);

  return {
    config: env,
    repo,
    bus: options.bus ?? RedisBus.fromUrl(env.REDIS_URL),
    queue: options.queue ?? BullQueue.fromRedisUrl("scope-eatttt", env.REDIS_URL),
    cache,
    places: options.places ?? buildPlaces(env, cache, options.fetch),
    auth:
      options.auth ??
      new BetterAuthProvider(
        createAuthFromDatabase(
          env,
          databaseClients.db,
          repo,
          RedisSecondaryStorage.fromUrl(env.REDIS_URL),
        ),
      ),
    relayStore: options.relayStore ?? new DrizzleRelayStore(databaseClients.db),
    relayListener: options.relayListener ?? createOutboxNotifyListener(env.DATABASE_DIRECT_URL),
  };
}

function buildPlaces(env: Env, cache: Cache, fetchImpl?: typeof fetch): PlacesProvider {
  switch (env.PLACES_PROVIDER) {
    case "fake":
      return new FakePlaces();
    case "google":
      if (!env.GOOGLE_MAPS_API_KEY) {
        throw new Error("GOOGLE_MAPS_API_KEY is required when PLACES_PROVIDER=google");
      }
      return new GooglePlaces({
        apiKey: env.GOOGLE_MAPS_API_KEY,
        cache,
        ttlS: env.PLACES_CACHE_TTL_S,
        ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      });
  }
}

let container: AppContainer | undefined;

export function getContainer(): AppContainer {
  container ??= buildContainer();
  return container;
}
