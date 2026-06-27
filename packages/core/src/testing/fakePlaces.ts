import type { Restaurant } from "@scope/contract";
import type { NearbyQuery, PlacesProvider } from "../ports/places";

export class FakePlaces implements PlacesProvider {
  async searchNearby(q: NearbyQuery): Promise<Restaurant[]> {
    return Array.from({ length: q.limit }, (_, index) => {
      const ordinal = index + 1;
      const cuisine = q.cuisines[index % q.cuisines.length] ?? "Restaurant";

      return {
        id: `fake-place-${ordinal}`,
        name: `Fake ${titleCase(cuisine)} Restaurant ${ordinal}`,
        address: `${ordinal} Fake Street`,
        cuisineTags: q.cuisines,
        rating: 4 + index / 10,
        priceLevel: Math.min(ordinal, 4), // clamp to schema max(4)
        distanceM: ordinal * 125,
      };
    });
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
