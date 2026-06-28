import type { Restaurant } from "@scope/contract";
import type { Cache, NearbyQuery, PlacesProvider } from "@scope/core";
import { ProviderError } from "../errors";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.rating",
  "places.priceLevel",
].join(",");

export interface GooglePlacesOptions {
  apiKey: string;
  cache: Cache;
  ttlS: number;
  fetch?: typeof fetch;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  rating?: number;
  priceLevel?: string;
}

export class GooglePlaces implements PlacesProvider {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GooglePlacesOptions) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async searchNearby(query: NearbyQuery): Promise<Restaurant[]> {
    const key = cacheKey(query);
    const cached = await this.options.cache.get<Restaurant[]>(key);
    if (cached) {
      return cached;
    }

    const response = await this.fetchImpl("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.options.apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        maxResultCount: query.limit,
        includedTypes: query.cuisines.length > 0 ? query.cuisines : undefined,
        locationRestriction: {
          circle: {
            center: { latitude: query.lat, longitude: query.lng },
            radius: query.radiusM,
          },
        },
      }),
    });

    if (!response.ok) {
      throw new ProviderError(
        `Google Places request failed with status ${response.status}`,
        await safeBody(response),
      );
    }

    const payload = (await response.json()) as { places?: GooglePlace[] };
    const restaurants = (payload.places ?? []).map(toRestaurant);
    await this.options.cache.set(key, restaurants, this.options.ttlS);
    return restaurants;
  }
}

function toRestaurant(place: GooglePlace): Restaurant {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const rating = place.rating;
  const mappedPriceLevel = priceLevel(place.priceLevel);

  return {
    id: requireField(place.id, "place id"),
    name: requireField(place.displayName?.text, "place display name"),
    address: place.formattedAddress ?? "",
    cuisineTags: place.types ?? [],
    ...(lat === undefined ? {} : { lat }),
    ...(lng === undefined ? {} : { lng }),
    ...(rating === undefined ? {} : { rating }),
    ...(mappedPriceLevel === undefined ? {} : { priceLevel: mappedPriceLevel }),
  };
}

function cacheKey(query: NearbyQuery): string {
  const cuisines = [...query.cuisines].sort().join(",");
  return `places:${query.lat.toFixed(4)}:${query.lng.toFixed(4)}:${query.radiusM}:${cuisines}:${query.limit}`;
}

function priceLevel(value: string | undefined): number | undefined {
  const levels: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return value === undefined ? undefined : levels[value];
}

function requireField<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new ProviderError(`Google Places response missing ${label}`);
  }
  return value;
}

async function safeBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
