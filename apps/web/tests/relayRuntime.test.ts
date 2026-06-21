import { describe, expect, it } from "vitest";
import type { AppContainer } from "../src/lib/server/container";
import { createRelayRuntime } from "../src/lib/server/relayRuntimeCore";

describe("relay runtime startup", () => {
  it("starts the relay once outside build mode", async () => {
    const starts: unknown[] = [];
    const runtime = createRelayRuntime({
      building: false,
      getContainer: () => ({ relayStore: "store", bus: "bus", relayListener: "listener" }) as unknown as AppContainer,
      startRelay: async (options) => {
        starts.push(options);
        return async () => {};
      },
    });

    runtime.ensure();
    runtime.ensure();
    await runtime.started();

    expect(starts).toEqual([{ store: "store", bus: "bus", listener: "listener", pollMs: 1000 }]);
  });

  it("does not start the relay during SvelteKit build", async () => {
    const starts: unknown[] = [];
    const runtime = createRelayRuntime({
      building: true,
      getContainer: () => ({}) as AppContainer,
      startRelay: async (options) => {
        starts.push(options);
        return async () => {};
      },
    });

    runtime.ensure();
    await runtime.started();

    expect(starts).toEqual([]);
  });
});
