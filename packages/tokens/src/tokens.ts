export const tokens = {
  color: {
    // surface
    canvas: "#FCFBF7",
    surfaceSoft: "#F4F2EA",
    surfaceCard: "#FFFFFF",
    // line-art + text
    stroke: "#1C1917",
    ink: "#1C1917",
    inkMuted: "#57534E",
    // retro accents
    electricBlue: "#1D4ED8",
    bananaYellow: "#FACC15",
    bubblegumPink: "#FBCFE8",
    mintGreen: "#10B981",
    // app role aliases (mapped onto DESIGN.md accents)
    primary: "#FACC15",  // banana-yellow primary action (label = ink)
    accept: "#10B981",   // mint-green
    reject: "#EF4444",   // comic red
    accent: "#1D4ED8",   // electric-blue highlights/rings
  },
  space: {
    xxs: "4px",
    xs: "8px",
    sm: "12px",
    md: "16px",
    lg: "24px",
    xl: "32px",
    xxl: "48px",
    section: "80px",
  },
  radius: {
    none: "0px",
    sm: "6px",
    lg: "16px",
    xl: "24px",
    full: "9999px",
  },
  border: {
    thin: "2px",
    base: "3px",
    thick: "4px",
  },
  shadow: {
    block: "4px 4px 0 #1C1917", // flat hard-edged offset — never blurred
  },
  font: {
    display: 'Fredoka, "Space Grotesk", "Plus Jakarta Sans", system-ui, sans-serif',
    body: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  weight: {
    body: 400,
    medium: 500,
    title: 700,
    display: 800,
  },
} as const;

export type Tokens = typeof tokens;
