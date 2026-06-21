import { building } from "$app/environment";
import { getContainer } from "./container";
import { createRelayRuntime } from "./relayRuntimeCore";
import { startRelay } from "./relay";

const relayRuntime = createRelayRuntime({ building, getContainer, startRelay, logger: console });

export function ensureRelayStarted(): void {
  relayRuntime.ensure();
}

export async function stopRelayForTests(): Promise<void> {
  await relayRuntime.stop();
}
