import { PUBLIC_USE_MOCK } from "$env/static/public";
import { parsePublicEnv } from "@scope/config";
import type { AppEvent } from "@scope/contract";
import { subscribeMockEvents } from "./mockHandler";

export interface SseHandlers {
  onOpen?: () => void;
  onError?: (error: Event) => void;
  onEvent: (event: AppEvent) => void;
}

export interface SseConnection {
  /** Last event id received, exposed for Last-Event-ID replay on reconnect. */
  readonly lastEventId: string | null;
  close(): void;
  /** Mock-only: push a synthetic AppEvent. No-op for a real EventSource. */
  emit(event: AppEvent): void;
}

// Read via $env/static/public — PUBLIC_* is not on import.meta.env in the browser.
const USE_MOCK = parsePublicEnv({ PUBLIC_USE_MOCK }).useMock;

/** Real EventSource-backed connection to the session SSE stream. */
function createRealSse(sessionId: string, handlers: SseHandlers): SseConnection {
  const source = new EventSource(`/api/sessions/${sessionId}/events`);
  let lastEventId: string | null = null;

  source.onopen = () => handlers.onOpen?.();
  source.onerror = (error) => handlers.onError?.(error);
  source.onmessage = (message: MessageEvent<string>) => {
    if (message.lastEventId) lastEventId = message.lastEventId;
    handlers.onEvent(JSON.parse(message.data) as AppEvent);
  };

  return {
    get lastEventId() {
      return lastEventId;
    },
    close() {
      source.close();
    },
    emit() {
      // No-op: real streams receive events from the server only.
    },
  };
}

/**
 * Mock connection used when parsePublicEnv(import.meta.env).useMock is true.
 * Exposes `emit()` so tests and screens can push synthetic AppEvents through
 * the same handler pipeline without a real EventSource.
 */
function createMockSse(sessionId: string, handlers: SseHandlers): SseConnection {
  let lastEventId: string | null = null;
  let open = true;
  const unsubscribe = subscribeMockEvents(sessionId, (event) => {
    if (!open) return;
    lastEventId = event.id;
    handlers.onEvent(event);
  });
  handlers.onOpen?.();

  return {
    get lastEventId() {
      return lastEventId;
    },
    close() {
      open = false;
      unsubscribe();
    },
    emit(event: AppEvent) {
      if (!open) return;
      lastEventId = event.id;
      handlers.onEvent(event);
    },
  };
}

export function createSse(sessionId: string, handlers: SseHandlers): SseConnection {
  return USE_MOCK ? createMockSse(sessionId, handlers) : createRealSse(sessionId, handlers);
}
