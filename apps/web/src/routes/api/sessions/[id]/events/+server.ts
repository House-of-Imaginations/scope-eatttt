import type { RequestHandler } from "@sveltejs/kit";
import { getContainer } from "$lib/server/container";
import { createSessionEventStream } from "$lib/server/sse";

export const GET: RequestHandler = async ({ params, request }) => {
  const sessionId = params.id;
  if (!sessionId) {
    return new Response("Missing session id", { status: 400 });
  }

  const container = getContainer();
  const user = await container.auth.getUser(request.headers);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const members = await container.repo.withTx((tx) => container.repo.listMembers(tx, sessionId));
  if (!members.some((member) => member.userId === user.id)) {
    return new Response("Forbidden", { status: 403 });
  }

  const afterEventId = request.headers.get("last-event-id") ?? undefined;
  const stream = await createSessionEventStream({
    bus: container.bus,
    replayStore: container.relayStore,
    sessionId,
    afterEventId,
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
};
