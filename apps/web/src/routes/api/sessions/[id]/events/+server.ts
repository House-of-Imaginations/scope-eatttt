import { getContainer } from "$lib/server/container";
import { createSessionEventStream } from "$lib/server/sse";
import type { RequestHandler } from "@sveltejs/kit";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  if (afterEventId && !UUID_PATTERN.test(afterEventId)) {
    return new Response("Invalid Last-Event-ID", { status: 400 });
  }

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
