import { Worker, type Job } from "bullmq";
import { loadEnv, type Env } from "@scope/config";
import { FakePlaces, type PlacesFetchRepo, type PlacesProvider } from "@scope/core";
import { createDatabaseClients } from "@scope/db";
import { DrizzleSessionRepo, GooglePlaces, RedisCache } from "@scope/adapters";
import { configureBackendLogging, getAppLogger } from "@scope/logging";
import {
  runPlacesFetchJob,
  type PlacesFetchDeps,
  type PlacesFetchJobData,
  type PlacesFetchJobResult,
} from "./jobs/placesFetch";
import {
  runPollCloseJob,
  type PollCloseDeps,
  type PollCloseJobData,
  type PollCloseJobResult,
  type PollCloseRepo,
} from "./jobs/pollClose";

type DrizzleTx = Parameters<DrizzleSessionRepo["getSession"]>[0];
type ScopeJobResult = PlacesFetchJobResult | PollCloseJobResult;

type WorkerRepo<Tx> = PollCloseRepo<Tx> & PlacesFetchRepo<Tx>;

configureBackendLogging({ service: "worker" });

export interface WorkerDeps<Tx> extends Omit<PollCloseDeps<Tx>, "repo">, Omit<PlacesFetchDeps<Tx>, "repo"> {
  repo: WorkerRepo<Tx>;
}

export function buildWorkerDeps(env: Env = loadEnv()): WorkerDeps<DrizzleTx> {
  const clients = createDatabaseClients(env);
  const cache = RedisCache.fromUrl(env.REDIS_URL);
  const repo = new DrizzleSessionRepo(clients.db);

  return {
    repo,
    places: buildPlaces(env, cache),
  };
}

export function createJobProcessor<Tx>(deps: WorkerDeps<Tx>): (job: Job) => Promise<ScopeJobResult> {
  return async (job: Job) => {
    switch (job.name) {
      case "poll.close":
        return runPollCloseJob(deps, job.data as PollCloseJobData);
      case "places.fetch":
        return runPlacesFetchJob(deps, job.data as PlacesFetchJobData);
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  };
}

export function createScopeWorker(env: Env = loadEnv()): Worker {
  const deps = buildWorkerDeps(env);
  return new Worker("scope-eatttt", createJobProcessor(deps), {
    connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
  });
}

function buildPlaces(env: Env, cache: RedisCache): PlacesProvider {
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
      });
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  getAppLogger(["startup"]).info("Starting worker from file: {file}", { file: process.argv[1] });
  createScopeWorker();
  getAppLogger(["startup"]).info("Worker started");
}
