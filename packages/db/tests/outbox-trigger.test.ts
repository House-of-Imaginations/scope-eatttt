import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	resolve(import.meta.dirname, "../migrations/0001_outbox_trigger.sql"),
	"utf8",
);
const journal = readFileSync(
	resolve(import.meta.dirname, "../migrations/meta/_journal.json"),
	"utf8",
);

describe("outbox trigger migration", () => {
	it("creates the pending partial index and outbox notify trigger", () => {
		expect(migration).toContain("WHERE dispatched_at IS NULL");
		expect(migration).toContain("pg_notify('outbox', NEW.id::text)");
		expect(migration).toContain("CREATE TRIGGER outbox_notify");
		expect(migration).toContain("AFTER INSERT ON outbox_event");
	});

	it("is registered in the drizzle migration journal", () => {
		expect(JSON.parse(journal)).toMatchObject({
			entries: expect.arrayContaining([
				expect.objectContaining({ idx: 1, tag: "0001_outbox_trigger" }),
			]),
		});
	});
});
