import { describe, expect, it } from "vitest";
import { createDatabaseClients } from "./client";

describe("createDatabaseClients", () => {
  it("uses pooled DATABASE_URL with prepare disabled and direct URL separately", () => {
    const clients = createDatabaseClients({
      DATABASE_URL: "postgres://app:app@localhost:6432/app",
      DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
    });

    expect(clients.pooledOptions).toEqual({
      url: "postgres://app:app@localhost:6432/app",
      prepare: false,
    });
    expect(clients.directOptions).toEqual({
      url: "postgres://app:app@localhost:5432/app",
    });
  });
});
