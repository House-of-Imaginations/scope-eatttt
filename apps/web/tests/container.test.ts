import { DrizzleRelayStore, GooglePlaces } from "@scope/adapters";
import type { Env } from "@scope/config";
import {
	type AuthProvider,
	type AuthUser,
	FakePlaces,
	InMemoryBus,
	InlineQueue,
	MemoryCache,
} from "@scope/core";
import { describe, expect, it } from "vitest";
import { buildContainer } from "../src/lib/server/container";

describe("buildContainer", () => {
	it("uses fake places when PLACES_PROVIDER is fake", () => {
		const container = buildContainer(
			testEnv({ PLACES_PROVIDER: "fake" }),
			testOverrides(),
		);

		expect(container.places).toBeInstanceOf(FakePlaces);
	});

	it("uses Google Places when PLACES_PROVIDER is google", () => {
		const container = buildContainer(
			testEnv({ PLACES_PROVIDER: "google", GOOGLE_MAPS_API_KEY: "maps-key" }),
			testOverrides(),
		);

		expect(container.places).toBeInstanceOf(GooglePlaces);
	});

	it("wires relay dependencies from the validated environment", () => {
		const container = buildContainer(testEnv(), testOverrides());

		expect(container.relayStore).toBeInstanceOf(DrizzleRelayStore);
		expect(container.relayListener).toBeDefined();
	});

	it("fails fast when Google Places is selected without an API key", () => {
		expect(() =>
			buildContainer(testEnv({ PLACES_PROVIDER: "google" }), testOverrides()),
		).toThrow("GOOGLE_MAPS_API_KEY");
	});
});

function testEnv(overrides: Partial<Env> = {}): Env {
	return {
		DATABASE_URL: "postgres://app:app@localhost:6432/app",
		DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
		REDIS_URL: "redis://localhost:6379",
		PLACES_PROVIDER: "fake",
		OCR_PROVIDER: "fake",
		BETTER_AUTH_SECRET: "test-secret-at-least-32-characters",
		BETTER_AUTH_URL: "http://localhost:5173",
		PROMOTE_THRESHOLD: 2,
		REJECT_STREAK: 5,
		RADIUS_BASE_M: 500,
		RADIUS_STEP_M: 500,
		RADIUS_CAP_M: 3000,
		POLL_TIMER_MS: 300000,
		PLACES_CACHE_TTL_S: 1800,
		...overrides,
	};
}

function testOverrides() {
	return {
		bus: new InMemoryBus(),
		queue: new InlineQueue(),
		cache: new MemoryCache(),
		auth: new TestAuthProvider(),
	};
}

class TestAuthProvider implements AuthProvider {
	private readonly user: AuthUser = {
		id: "u1",
		displayName: "Ada",
		isAnonymous: false,
	};

	async getUser(): Promise<AuthUser | null> {
		return this.user;
	}

	async requireUser(): Promise<AuthUser> {
		return this.user;
	}
}
