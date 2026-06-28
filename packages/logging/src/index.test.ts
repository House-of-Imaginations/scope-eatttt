import { getConfig, resetSync } from "@logtape/logtape";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureBackendLogging, configureFrontendLogging, getAppLogger } from "./index";

describe("@scope/logging", () => {
  afterEach(() => {
    resetSync();
    vi.restoreAllMocks();
  });

  it("prefixes logger categories with the app namespace", () => {
    expect(getAppLogger("auth").category).toEqual(["scope-eatttt", "auth"]);
    expect(getAppLogger(["worker", "places"]).category).toEqual([
      "scope-eatttt",
      "worker",
      "places",
    ]);
  });

  it("configures backend logging with service-prefixed categories", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    configureBackendLogging({ service: "worker", level: "info" });
    getAppLogger("startup").info("Worker started");

    expect(getAppLogger("startup").category).toEqual(["scope-eatttt", "worker", "startup"]);
    expect(info).toHaveBeenCalled();
  });

  it("leaves frontend logging silent when disabled", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    configureFrontendLogging({ enabled: false });
    getAppLogger("ui").info("Client booted");

    expect(getConfig()).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });
});
