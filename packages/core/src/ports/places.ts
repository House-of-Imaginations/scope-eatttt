import type { Restaurant } from "@scope/contract";

export interface NearbyQuery {
  lat: number;
  lng: number;
  radiusM: number;
  cuisines: string[];
  limit: number;
}

export interface PlacesProvider {
  searchNearby(q: NearbyQuery): Promise<Restaurant[]>;
}
