import type { RequestHandler } from "@sveltejs/kit";
import { RPCHandler } from "@orpc/server/fetch";
import type { AuthUser } from "@scope/core";
import { createORPCRouter, type ORPCContext } from "$lib/server/orpc";

let handler: RPCHandler<ORPCContext> | undefined;

function getHandler(): RPCHandler<ORPCContext> {
  handler ??= new RPCHandler(createORPCRouter());
  return handler;
}

const handle: RequestHandler = async (event) => {
  const { response } = await getHandler().handle(event.request, {
    prefix: "/api/rpc",
    context: { user: authUserFromLocal(event.locals.user) },
  });

  return response ?? new Response("Not Found", { status: 404 });
};

export const GET = handle;
export const POST = handle;

interface LocalAuthUser {
  id: string;
  email?: string | null | undefined;
  name?: string | null | undefined;
  displayName?: string | null | undefined;
  isAnonymous?: boolean | null | undefined;
}

function authUserFromLocal(value: unknown): AuthUser | null {
  if (!isLocalAuthUser(value)) {
    return null;
  }

  return {
    id: value.id,
    email: value.email ?? null,
    displayName: value.displayName ?? value.name ?? "Guest",
    isAnonymous: value.isAnonymous ?? false,
  };
}

function isLocalAuthUser(value: unknown): value is LocalAuthUser {
  return !!value && typeof value === "object" && "id" in value && typeof value.id === "string";
}
