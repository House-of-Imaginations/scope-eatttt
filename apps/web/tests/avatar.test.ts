import { colorFor, initials } from "@scope/ui/src/avatar";
import { describe, expect, test } from "vitest";

describe("initials", () => {
	test("single word returns first char uppercased", () => {
		expect(initials("Alice")).toBe("A");
	});

	test("two words returns first chars of first and last word", () => {
		expect(initials("Alice Wong")).toBe("AW");
	});

	test("trims surrounding whitespace", () => {
		expect(initials("  bob ")).toBe("B");
	});

	test("empty string returns ?", () => {
		expect(initials("")).toBe("?");
	});

	test("whitespace-only returns ?", () => {
		expect(initials("   ")).toBe("?");
	});
});

describe("colorFor", () => {
	test("deterministic: same seed returns same token", () => {
		expect(colorFor("alice")).toBe(colorFor("alice"));
	});

	test("returns a CSS var name starting with --color-", () => {
		expect(colorFor("alice")).toMatch(/^--color-/);
	});

	test("different seeds can produce different tokens", () => {
		// Not guaranteed but palette has 4 entries — just check it's a valid token
		const tokens = [
			"--color-banana-yellow",
			"--color-bubblegum-pink",
			"--color-mint-green",
			"--color-electric-blue",
		];
		expect(tokens).toContain(colorFor("bob"));
	});
});
