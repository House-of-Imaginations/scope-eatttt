import { describe, expect, it } from "vitest";
import { tokens } from "./tokens";

describe("tokens", () => {
  it("exposes all required top-level groups", () => {
    for (const g of ["color", "space", "radius", "border", "shadow", "font", "weight"]) {
      expect(tokens).toHaveProperty(g);
    }
  });

  it("color.canvas is the warm cream baseline from DESIGN.md", () => {
    expect(tokens.color.canvas).toBe("#FCFBF7");
  });

  it("color.stroke is the charcoal line-art black from DESIGN.md", () => {
    expect(tokens.color.stroke).toBe("#1C1917");
  });

  it("color.accept maps to mint-green from DESIGN.md", () => {
    expect(tokens.color.accept).toBe("#10B981");
  });

  it("color.primary maps to banana-yellow from DESIGN.md", () => {
    expect(tokens.color.primary).toBe("#FACC15");
  });

  it("shadow.block is a flat hard-edged offset with no blur", () => {
    // must contain stroke color and have NO blur (no rgba, no 'blur' keyword)
    // CSS box-shadow format: offset-x offset-y blur-radius color
    // flat block shadow has blur-radius = 0 (written as "4px 4px 0 #1C1917")
    expect(tokens.shadow.block).toContain("#1C1917");
    // no rgba (gradients/soft shadows are forbidden by DESIGN.md)
    expect(tokens.shadow.block).not.toMatch(/rgba/);
    // blur value must be 0 (third number in the shadow shorthand)
    const parts = tokens.shadow.block.trim().split(/\s+/);
    // parts: ["4px", "4px", "0", "#1C1917"]
    expect(parts[2]).toBe("0");
  });

  it("every named color value is a 6-digit hex", () => {
    const hexRe = /^#([0-9A-Fa-f]{6})$/;
    for (const [key, val] of Object.entries(tokens.color)) {
      expect(val, `color.${key} should be a 6-digit hex`).toMatch(hexRe);
    }
  });
});
