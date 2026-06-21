import { describe, expect, it } from "vitest";
import { createOutboxListenerConfig } from "./listener";

describe("createOutboxListenerConfig", () => {
  it("listens on the direct database URL only", () => {
    expect(createOutboxListenerConfig("postgres://app:app@localhost:5432/app")).toEqual({
      url: "postgres://app:app@localhost:5432/app",
      channel: "outbox",
    });
  });
});
