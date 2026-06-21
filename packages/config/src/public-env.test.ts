import { describe, it, expect } from "vitest";
import { parsePublicEnv } from "./public-env";

describe("parsePublicEnv", () => {
  it('treats "1" as useMock true', () => {
    expect(parsePublicEnv({ PUBLIC_USE_MOCK: "1" }).useMock).toBe(true);
  });
  it('treats "true" as useMock true', () => {
    expect(parsePublicEnv({ PUBLIC_USE_MOCK: "true" }).useMock).toBe(true);
  });
  it("defaults to false when absent", () => {
    expect(parsePublicEnv({}).useMock).toBe(false);
  });
  it('treats "0"/"" as false', () => {
    expect(parsePublicEnv({ PUBLIC_USE_MOCK: "0" }).useMock).toBe(false);
    expect(parsePublicEnv({ PUBLIC_USE_MOCK: "" }).useMock).toBe(false);
  });
});
