import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { contract } from "@scope/contract";
import type { NestedClient } from "@orpc/client";
import { parsePublicEnv } from "@scope/config";
import { makeMockApi } from "./mockHandler";

// Derive the typed client shape from the contract definition.
type RouterClient = {
  [G in keyof typeof contract]: {
    [P in keyof (typeof contract)[G]]: (typeof contract)[G][P] extends {
      "~orpc": { input: infer I; output: infer O };
    }
      ? (input: I) => Promise<O>
      : never;
  };
};

// Use SvelteKit's PUBLIC_ env flag (via @scope/config) to switch between real and mock transport.
const USE_MOCK = parsePublicEnv(import.meta.env).useMock;

function buildRealClient(): RouterClient {
  const link = new RPCLink({ url: "/api/rpc" });
  return createORPCClient<NestedClient<RouterClient>>(link) as RouterClient;
}

export const api: RouterClient = USE_MOCK
  ? (makeMockApi() as unknown as RouterClient)
  : buildRealClient();
