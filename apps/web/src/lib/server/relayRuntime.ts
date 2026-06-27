import { building } from "$app/environment";
import { getContainer } from "./container";
import { createRelayRuntime } from "./relayRuntimeCore";
import { startRelay } from "./relay";
import { getAppLogger } from "@scope/logging";

const relayRuntime = createRelayRuntime({
  building,
  getContainer,
  startRelay,
  logger: {
    error(message, properties) {
      getAppLogger(["relay-runtime"]).error(message, properties);
    },
  },
});

export function ensureRelayStarted(): void {
  relayRuntime.ensure();
}

export async function stopRelayForTests(): Promise<void> {
  await relayRuntime.stop();
}
