import { describe, expect, it } from "vitest";
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

  it('treats "1" as googleEnabled true', () => {
    expect(parsePublicEnv({ PUBLIC_GOOGLE_ENABLED: "1" }).googleEnabled).toBe(true);
  });
  it('treats "true" as googleEnabled true', () => {
    expect(parsePublicEnv({ PUBLIC_GOOGLE_ENABLED: "true" }).googleEnabled).toBe(true);
  });
  it("googleEnabled defaults to false when absent", () => {
    expect(parsePublicEnv({}).googleEnabled).toBe(false);
  });
  it('googleEnabled treats undefined/"" as false', () => {
    expect(parsePublicEnv({ PUBLIC_GOOGLE_ENABLED: "" }).googleEnabled).toBe(false);
  });
});
