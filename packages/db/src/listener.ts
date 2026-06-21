import postgres from "postgres";

export interface OutboxListenerConfig {
  url: string;
  channel: "outbox";
}

export function createOutboxListenerConfig(url: string): OutboxListenerConfig {
  return { url, channel: "outbox" };
}

export async function listenOutbox(url: string, onEventId: (eventId: string) => void | Promise<void>) {
  const config = createOutboxListenerConfig(url);
  const sql = postgres(config.url);
  await sql.listen(config.channel, (eventId) => {
    void onEventId(eventId);
  });
  return sql;
}
