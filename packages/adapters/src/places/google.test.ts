import { MemoryCache } from "@scope/core";
import { describe, expect, it, vi } from "vitest";
import { GooglePlaces } from "./google";

describe("GooglePlaces.searchNearby", () => {
  it("maps Places New JSON to Restaurant and applies field mask plus cache-aside", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        places: [
          {
            id: "p1",
            displayName: { text: "Sushi Co" },
            formattedAddress: "1 Fish Ln",
            location: { latitude: 1, longitude: 2 },
            types: ["sushi_restaurant", "restaurant"],
            rating: 4.5,
            priceLevel: "PRICE_LEVEL_MODERATE",
          },
        ],
      }),
    });
    const cache = new MemoryCache();
    const places = new GooglePlaces({ apiKey: "k", cache, ttlS: 1800, fetch: fetchMock });

    const first = await places.searchNearby({ lat: 1, lng: 2, radiusM: 500, cuisines: ["sushi"], limit: 5 });
    const second = await places.searchNearby({ lat: 1, lng: 2, radiusM: 500, cuisines: ["sushi"], limit: 5 });

    expect(first[0]).toMatchObject({
      id: "p1",
      name: "Sushi Co",
      address: "1 Fish Ln",
      cuisineTags: ["sushi_restaurant", "restaurant"],
      rating: 4.5,
      priceLevel: 2,
      lat: 1,
      lng: 2,
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k");
    expect((init?.headers as Record<string, string>)["X-Goog-FieldMask"]).toContain("places.displayName");
  });

  it("wraps non-ok responses as provider errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "quota" });
    const places = new GooglePlaces({ apiKey: "k", cache: new MemoryCache(), ttlS: 1800, fetch: fetchMock });

    await expect(places.searchNearby({ lat: 1, lng: 2, radiusM: 500, cuisines: [], limit: 5 })).rejects.toMatchObject({
      name: "ProviderError",
    });
  });
});
