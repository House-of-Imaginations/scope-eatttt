import { afterEach, describe, expect, it, vi } from "vitest";
import { configureFrontendLogging, getAppLogger } from "./browser";

describe("@scope/logging/browser", () => {
  afterEach(() => {
    configureFrontendLogging({ enabled: false });
    vi.restoreAllMocks();
  });

  it("keeps browser logs silent when disabled", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    configureFrontendLogging({ enabled: false });
    getAppLogger("layout").error("Client failed", { reason: "test" });

    expect(error).not.toHaveBeenCalled();
  });

  it("writes browser logs when explicitly enabled", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    configureFrontendLogging({ enabled: true });
    getAppLogger(["layout"]).error("Client failed", { reason: "test" });

    expect(error).toHaveBeenCalledWith("[scope-eatttt:frontend:layout] Client failed", {
      reason: "test",
    });
  });
});
