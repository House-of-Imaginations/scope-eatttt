# DESIGN.md

## Overview

The Hungry Sandwich Club marketing and studio surface is a highly expressive, high-energy sandbox that blends **retro cartoon mechanics, bold illustration styles, and a rubber-hose animation vibe**. Instead of clean corporate minimalism or cold layouts, the digital surface behaves like a living comic book or a Saturday-morning cartoon canvas. The structure relies on a warm, organic cream baseline (`{colors.canvas}` — #FCFBF7) paired with high-contrast, heavy black line-art strokes (`{colors.stroke}` — #1C1917) and highly vibrant, nostalgic color accents (`{colors.electric-blue}`, `{colors.banana-yellow}`, `{colors.bubblegum-pink}`). 

The system completely rejects drop shadows, subtle gradients, and standard borderless UI cards. Instead, depth and physical tactile voltage are achieved through **thick 2px to 4px black outlines** around components, which shift and slide on hover to reveal flat color block shadows beneath them. Brand energy comes from **playful character illustrations and dynamic loop animations** that fill large layout blocks, bringing an editorial, whimsical "sarnie" energy to every viewport.

Type voice runs bold and approachable with a punchy split: **Fredoka** or a chunky geometric sans-serif for display headers at heavy weights (800) to maintain a stamped, organic voice, while running body paragraphs use a clean, highly legible modern neo-grotesque font for grounding text.

**Key Characteristics:**
- Warm, organic cream canvas (`{colors.canvas}` — #FCFBF7) with rich charcoal-black type and vector lines. The system feels hand-crafted and analog rather than sterile or corporate.
- Display headlines in tight, friendly, high-impact sans-serif lettering at weight 800. Main hooks are written in conversational, adventurous sentence case.
- Thick black borders (`{colors.stroke}` — #1C1917) ranging from 2px to 4px on all buttons, cards, containers, and inputs. 
- High-saturation retro accents (`{colors.electric-blue}` / `{colors.banana-yellow}` / `{colors.bubblegum-pink}`) used as flat solid fills for cards, active navigation states, and interactive pills.
- Hover behaviors are explicitly tactile: elements shift up-and-left or down-and-right (`translate(-4px, -4px)`) while maintaining a fixed flat block-shadow position to create a mechanical pop.
- Border radius scales are generously rounded across the system (`{rounded.xl}` — 24px) to emphasize a soft, plastic, bouncy silhouette. Fully circular shapes (`{rounded.full}`) represent functional buttons and cursor indicators.
- Spacing is organic but structured around a 4px base unit, utilizing wide internal card padding (`{spacing.xl}` — 32px) and generous vertical section breaks (`{spacing.section}` — 80px) to give colorful motion work breathing room.

## Colors

### Brand & Accent
- **Electric Blue** (`{colors.electric-blue}` — #1D4ED8): The primary identity accent. Used for energetic highlights, vector fills, active status rings, and prominent link labels.
- **Banana Yellow** (`{colors.banana-yellow}` — #FACC15): A cheerful, saturated retro yellow used as a solid fill for primary click targets, alert blocks, and emphasis containers.
- **Bubblegum Pink** (`{colors.bubblegum-pink}` — #FBCFE8): A friendly, pastel-adjacent pink used for lighter full-width canvas backdrops and secondary illustrative details.
- **Mint Green** (`{colors.mint-green}` — #10B981): A splashy secondary green utilized for dynamic tags, hiring flags, and successful form states.

### Surface
- **Canvas Cream** (`{colors.canvas}` — #FCFBF7): The default warm, cozy cream background floor across every primary page surface.
- **Surface Soft** (`{colors.surface-soft}` — #F4F2EA): A slightly darker tint of cream used for alternating feed cards, spec grids, or footer background strips.
- **Surface Card** (`{colors.surface-card}` — #FFFFFF): Pure solid white, always framed by a thick border, used to isolate text-heavy blocks or readable lists.

### Hairlines & Borders
- **Stroke Black** (`{colors.stroke}` — #1C1917): The foundational line-art black. Applied to all component outlines, text content, table grids, and character vector artwork.

### Text
- **Ink Primary** (`{colors.ink-primary}` — #1C1917): Default color for all headlines, running body copy, and primary button labels.
- **Ink Muted** (`{colors.ink-muted}` — #57534E): Secondary metadata, timestamps, copyright fine print, and disabled text states.

## Typography

### Font Family
The system utilizes **Fredoka** (or an open-source alternative like **Space Grotesk** or **Plus Jakarta Sans** with high weights) for display headlines and buttons to establish the "stamped, cartoon" voice. Body paragraphs and structural data use **Inter** or a clean neo-grotesque stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`) to ensure long descriptions remain highly readable against colorful backgrounds.

The weight system is polarized:
- Display (800) for headlines, navigation items, pills, and card titles — the "chunky illustration" voice.
- Regular (400) or Medium (500) for running body text and descriptive lists — the "grounded" voice.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.display-xl}` | 64px | 800 | 1.1 | -1px | Massive playful hero hooks ("What happens when...") |
| `{typography.display-lg}` | 40px | 800 | 1.2 | -0.5px | Section headers ("Let's get you up to date") |
| `{typography.display-md}` | 28px | 800 | 1.3 | 0 | Project titles inside grids, blog post titles |
| `{typography.title-sm}` | 20px | 700 | 1.3 | 0 | Subheaders, card meta headlines, team titles |
| `{typography.body-md}` | 16px | 400 | 1.6 | 0 | Default running body, studio descriptions, post text |
| `{typography.body-sm}` | 14px | 400 | 1.5 | 0 | Metadata rows, date stamps, address lines, footer text |
| `{typography.label-uppercase}` | 12px | 800 | 1.0 | 1px | Pill tags, small category badges, active tab markers |
| `{typography.button}` | 16px | 800 | 1.0 | 0.5px | Interactive button text labels |
| `{typography.nav-link}` | 18px | 800 | 1.4 | 0 | Main header navigation links |

### Principles
Headlines are configured with tight line-heights and slightly negative tracking (`-1px` to `-0.5px`) to make large typography feel clustered, custom-drawn, and blocky. Letter-spacing is only increased on small uppercase category badges to preserve ink legibility when rendered small. 

Sentence-case is enforced across headlines; avoiding all-caps display ensures the tone stays friendly, informal, and accessible rather than aggressively bold.

## Layout

### Spacing System
- **Base unit:** 4px.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 16px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 80px.
- **Section padding (vertical):** `{spacing.section}` (80px) between major project grids, about blocks, and feed flows.
- **Card internal padding:** `{spacing.xl}` (32px) uniformly inside project boxes and editorial text blocks.
- **Gutters:** `{spacing.xl}` (32px) between cards in multi-column desktop grids; `{spacing.md}` (16px) inside mobile layouts.

### Grid & Container
- **Max content width:** 1280px centered across marketing and collection views.
- **Project Grid:** 2-column grid at desktop for project showcases (giving large vector imagery heavy prominence), collapsing to 1-column at mobile.
- **Blog / Feed Grid:** 3-column alternating card grid at desktop, collapsing to 1-column at mobile.

### Whitespace Philosophy
The system balances highly dense, high-contrast comic components with broad fields of empty `{colors.canvas}` or single flat pastel fills. Air around major blocks is uniform (`{spacing.section}`), ensuring that the combination of heavy black borders and neon colors does not create visual fatigue. 

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Flat Canvas | `{colors.canvas}` or pastel background with no borders | Page baseline, site container strips, full-bleed color sections |
| Bordered Flat | 3px `{colors.stroke}` border, no shadow | Input fields, active header navigation bar, divider lines |
| Comic Pop (Default) | 3px `{colors.stroke}` border + 4px flat black solid offset block shadow | Main portfolio grid cards, interactive filter selectors, blog items |
| Interactive Clicked | 3px `{colors.stroke}` border + 0px shadow (element translates down/right) | Active clicked or pressed state of cards and action buttons |

The system completely outlaws fuzzy canvas box-shadows, blurs, or gradients. Dimensional depth is treated exclusively as a geometric hard-edged extrusion or a offset layer, paying homage to vintage 2D vector pop mechanics.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed media strips, horizontal layout dividing borders |
| `{rounded.sm}` | 6px | Small micro-tags, tag categories, tiny UI buttons |
| `{rounded.lg}` | 16px | Project thumbnails, standard blog feed cards, form text boxes |
| `{rounded.xl}` | 24px | Massive container cards, contact panels, interactive profile grids |
| `{rounded.full}` | 9999px | Action buttons, pills, filter tabs, circular icon navigation links |

### Geometric Rhythm
The interface balances organic, playful roundness with high-contrast sharp grid geometry. Image frames use `{rounded.lg}` to clip animations and artwork into soft-cornered modules, which are then enclosed by solid black outlines.

## Components

### Top Navigation

**`top-nav`** — Pinned clean header tracking at the top of the viewport. Height 80px, background transparent or matching `{colors.canvas}`. Features the Hungry Sandwich Club text mark or animated graphic on the left, and horizontal primary links (Home, Work, About, Blog) on the right. Links are styled using `{typography.nav-link}`. Active and hover links are underlined with a thick 3px `{colors.stroke}` horizontal bar or wrapped in a `{colors.banana-yellow}` pill box.

### Buttons

**`pill-button-primary`** — The primary action item. Background `{colors.banana-yellow}`, text `{colors.ink-primary}`, border 3px solid `{colors.stroke}`, rounded `{rounded.full}` (9999px), padding 12px × 24px. Height 48px. Type `{typography.button}`. Features an implicit 3px flat black block shadow behind it; on hover, the button translates down-and-right by 3px while the shadow collapses, simulating an analog button press.

**`pill-button-secondary`** — Same layout silhouette as primary, but utilizes a transparent or white background with text in `{colors.ink-primary}` and a 3px border outline. Used for structural links, tag filters, or secondary content pathways.

**`category-badge`** — Tiny informational micro-pill. Background `{colors.bubblegum-pink}` or `{colors.mint-green}`, border 2px solid `{colors.stroke}`, rounded `{rounded.sm}` (6px), padding 4px × 8px. Font uses `{typography.label-uppercase}`. Non-interactive, used strictly to indicate post categories (e.g., "Animation", "Web Development", "Jobs").

### Cards & Containers

**`project-card`** — Heavy structural card used in the 2-up showcase grid. Background `{colors.surface-card}`, border 3px solid `{colors.stroke}`, rounded `{rounded.lg}` (16px), internal padding 0px (image is flush). Top container is a responsive, auto-playing vector video loop or image frame. Below the media split, a 24px padded metadata tray holds a category label row, a headline in `{typography.display-md}`, and a subheader description. On hover, the whole card rises up-and-left while expanding its flat block shadow.

**`feed-post-card`** — Used in the 3-up blog or article row. Background alternates between `{colors.surface-soft}`, `{colors.bubblegum-pink}`, or white depending on index position. Border 3px solid `{colors.stroke}`, rounded `{rounded.lg}`. Features a prominent category line, creation date stamp in `{typography.body-sm}`, post header, and a clear call-to-action text link at the base ("Read Post").

**`contact-banner`** — Broad pre-footer billboard module. Background `{colors.electric-blue}`, text #FFFFFF, border 4px solid `{colors.stroke}`, rounded `{rounded.xl}` (24px). Internal padding `{spacing.xxl}` (48px). Houses a heavy title, studio coordinates, and primary button targets arranged in a clean structural layout.

### Inputs & Forms

**`comic-text-input`** — Input fields for search strings or contact details. Background `{colors.surface-card}`, text `{colors.ink-primary}`, border 3px solid `{colors.stroke}`, rounded `{rounded.lg}`, padding 14px × 16px. Typography maps to `{typography.body-md}`. Focus state introduces a solid, vibrant `{colors.electric-blue}` flat block shadow frame around the element.

### Footer

**`footer`** — Soft, un-bordered baseline closure at the bottom of pages. Background transparent or `{colors.surface-soft}`. Layout spaces out studio emails, phone numbers, studio street addresses, and social links (Instagram / Twitter / Github) into uniform, highly readable text columns styled with `{typography.body-sm}`.

## Do's and Don'ts

### Do
- Frame every image, video capsule, button, and text card with a solid black border line (`{colors.stroke}`).
- Stick to sentence-case for large playful headings to keep the brand-voice warm and conversational.
- Apply high-contrast flat block shadow transformations to components during hover or active interactions.
- Let background canvas blocks breathe using uniform, spacious padding scales (`{spacing.section}`).
- Maintain high contrast between dark text inks and bright background pastel fills.

### Don't
- Never introduce linear gradients, radical box blurs, or realistic drop-shadow textures. The aesthetic is flat vector art.
- Don't use standard stark white (#FFFFFF) backgrounds for full pages; keep backgrounds grounded on warm Canvas Cream (`{colors.canvas}`).
- Don't clamp text content inside border frames without adequate internal padding (`{spacing.xl}`).
- Don't use thin, high-contrast serif font faces for display messaging; typography must match the thick line weights of the illustrations.
- Never let borders overlap messy graphic details without a solid background fill layer to block out under-slung noise.

## Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 768px | Header contracts; top navigation switches to collapse overlay or stacked links; hero title scales 64px→36px; grids collapse to 1-column layout; card padding reduces to 16px. |
| Tablet | 768–1024px | Project grids transition to 2-up columns; text scales balance out; vertical section padding reduces to 48px. |
| Desktop | > 1024px | Full grid capabilities; 3-column article arrays active; full top-nav visibility; max content container locks at 1280px. |

### Layout Shifts
- Grids dynamically collapse columns rather than shrinking media cards into unreadable dimensions.
- Thick 3px lines and vector art stroke scales remain uniform across all screen sizes to guarantee consistency.
- Input targets and buttons preserve explicit 48px tactile heights on touch devices to comply with accessible finger target parameters.

## Iteration Guide

1. Address one component at a time, strictly anchoring parameters to defined semantic keys (`{colors.electric-blue}`, `{component.pill-button-primary}`).
2. New design widgets must adopt thick outlines and rounded parameters (`{rounded.lg}`) by default.
3. Keep hover properties clean: always combine object translation with reciprocal block shadow expansion.
4. Keep structural layout structures highly organized, and rely on graphic loops and animations to inject humor.
5. Review contrast metrics when overlaying text onto vibrant filled cards.

## Known Gaps

- Color extraction has been optimized to map directly to visible website assets; specific underlying hover styles or secondary input error screens were not actively mapped in the core view.
- Animation curves, easing profiles (e.g., bouncy cubic-beziers), and character physics are not explicitly codified within this styling outline.
- Dark mode configurations are completely omitted; the platform operates exclusively on a high-contrast, warm light comic canvas layout.
