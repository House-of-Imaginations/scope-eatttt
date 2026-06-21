// CT entry — makes the @scope/tokens design tokens available as the same
// `var(--color-*)`, `var(--radius-*)`, `var(--shadow-block)`, `var(--font-*)`
// custom properties the real app exposes, so component style assertions resolve.
//
// theme.css declares those vars inside Tailwind v4's `@theme {}` at-rule, which
// only emits real custom properties after Tailwind processes it. The CT bundler
// runs vite-plugin-svelte only (no Tailwind), so we inject the `:root` block
// straight from the typed token object instead — single source of truth, zero
// duplicated hex, and it cannot drift from tokens.ts.
import { tokens } from "@scope/tokens";

const css = `:root{
  --color-canvas:${tokens.color.canvas};
  --color-surface-soft:${tokens.color.surfaceSoft};
  --color-surface-card:${tokens.color.surfaceCard};
  --color-stroke:${tokens.color.stroke};
  --color-ink:${tokens.color.ink};
  --color-ink-muted:${tokens.color.inkMuted};
  --color-electric-blue:${tokens.color.electricBlue};
  --color-banana-yellow:${tokens.color.bananaYellow};
  --color-bubblegum-pink:${tokens.color.bubblegumPink};
  --color-mint-green:${tokens.color.mintGreen};
  --color-primary:${tokens.color.primary};
  --color-accept:${tokens.color.accept};
  --color-reject:${tokens.color.reject};
  --color-accent:${tokens.color.accent};
  --radius-sm:${tokens.radius.sm};
  --radius-lg:${tokens.radius.lg};
  --radius-xl:${tokens.radius.xl};
  --radius-full:${tokens.radius.full};
  --shadow-block:${tokens.shadow.block};
  --font-display:${tokens.font.display};
  --font-body:${tokens.font.body};
}`;

const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);
