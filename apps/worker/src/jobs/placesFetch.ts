import type { Restaurant } from "@scope/contract";
import type { NearbyQuery, PlacesFetchRepo, PlacesProvider, TransactionContext } from "@scope/core";

export interface PlacesFetchJobData extends NearbyQuery {
  sessionId: string;
  userId: string;
}

export interface PlacesFetchDeps<Tx = TransactionContext> {
  places: PlacesProvider;
  repo: PlacesFetchRepo<Tx>;
}

export interface PlacesFetchJobResult {
  restaurants: Restaurant[];
}

export async function runPlacesFetchJob<Tx>(
  deps: PlacesFetchDeps<Tx>,
  data: PlacesFetchJobData,
): Promise<PlacesFetchJobResult> {
  const restaurants = await deps.places.searchNearby({
    lat: data.lat,
    lng: data.lng,
    radiusM: data.radiusM,
    cuisines: data.cuisines,
    limit: data.limit,
  });

  const cachedAt = new Date().toISOString();
  await deps.repo.withTx(async (tx) => {
    await deps.repo.upsertRestaurants(
      tx,
      restaurants.map((restaurant) => ({ restaurant, cachedAt })),
    );
    await deps.repo.insertOutbox(tx, {
      aggregate: "session",
      aggregateId: data.sessionId,
      type: "deck.replenished",
      payload: {
        userId: data.userId,
        restaurants,
      },
    });
  });

  return { restaurants };
}
