import type { AppContainer } from "./container";
import type { StartRelayOptions } from "./relay";

type StopRelay = () => Promise<void>;

export interface RelayRuntimeDeps {
  building: boolean;
  getContainer: () => AppContainer;
  startRelay: (options: StartRelayOptions) => Promise<StopRelay>;
  logger?: Pick<Console, "error">;
}

export interface RelayRuntime {
  ensure(): void;
  started(): Promise<void>;
  stop(): Promise<void>;
}

export function createRelayRuntime(deps: RelayRuntimeDeps): RelayRuntime {
  let startPromise: Promise<void> | undefined;
  let stopRelay: StopRelay | undefined;

  return {
    ensure() {
      if (deps.building || startPromise) {
        return;
      }

      startPromise = (async () => {
        const container = deps.getContainer();
        stopRelay = await deps.startRelay({
          store: container.relayStore,
          bus: container.bus,
          listener: container.relayListener,
          pollMs: 1000,
        });
      })().catch((error: unknown) => {
        startPromise = undefined;
        deps.logger?.error("Failed to start outbox relay", error);
      });
    },
    started() {
      return startPromise ?? Promise.resolve();
    },
    async stop() {
      await startPromise;
      await stopRelay?.();
      stopRelay = undefined;
      startPromise = undefined;
    },
  };
}
