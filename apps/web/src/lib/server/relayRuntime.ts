import { building } from "$app/environment";
import { getAppLogger } from "@scope/logging";
import { getContainer } from "./container";
import { startRelay } from "./relay";
import { createRelayRuntime } from "./relayRuntimeCore";

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
