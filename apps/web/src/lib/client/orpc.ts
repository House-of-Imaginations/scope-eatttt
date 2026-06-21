import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "@scope/contract";
import { parsePublicEnv } from "@scope/config";
import { makeMockApi } from "./mockHandler";

// Fully-typed client inferred from the oRPC contract. Each leaf becomes
// (input) => Promise<output> — do not hand-roll the mapped type (the contract's
// internal shape uses inputSchema/outputSchema, so a manual mapper resolves to never).
export type Api = ContractRouterClient<typeof contract>;

// PUBLIC_ env flag (validated via @scope/config) switches real vs mock transport.
const USE_MOCK = parsePublicEnv(import.meta.env).useMock;

function buildRealClient(): Api {
  const link = new RPCLink({ url: "/api/rpc" });
  return createORPCClient(link);
}

export const api: Api = USE_MOCK
  ? (makeMockApi() as unknown as Api)
  : buildRealClient();
