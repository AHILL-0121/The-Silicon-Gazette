# The Silicon Gazette: frontend

Next.js 15 App Router app containing the reader UI, the API routes and the generation pipeline. See the [root README](../README.md) for setup and environment variables.

## Structure

```text
app/
  gazette/[date]/            Edition page, error boundary, social card
  gazette/[date]/story/[slug]/  Story reader and its social card
  archive/                   Searchable archive
  latest/                    Redirect to the newest printed edition
  api/gazette/               Read and generate endpoints
  sitemap.ts, robots.ts, icon.png, favicon.ico, opengraph-image.tsx
components/                  UI (server components unless marked "use client")
lib/
  edition-service.ts         Read (cached) / generate (locked, cooled down) editions
  edition-view.ts            Stored edition -> what the UI renders (dedupe, slugs, sections)
  gazette.ts                 Zod schema, normalisation, URL safety, duplicate detection
  groq.ts, gemini.ts, tavily.ts  Generation pipeline
  generation-lock.ts, rate-limit.ts  Upstash Redis lock and limiter
  db.ts, schema.ts           Drizzle + Neon
assets/fonts/                Fonts for the PNG social cards (SIL Open Font License)
```

## Rendering and caching

- Edition and story pages render per request so today's edition can stream a loading screen while it is generated, and errors reach `error.tsx`.
- Past editions never change, so their data comes from the Next data cache (`unstable_cache` in `edition-service.ts`) instead of querying Neon on every view. Today's edition is always read fresh.
- The archive and sitemap are regenerated every 5 minutes and every hour respectively. The generate route invalidates the `editions` cache tag after it stores a new edition.

## Design

The look is an editorial broadsheet: a warm newsprint palette (plus a dark "night edition"), a signal-red accent, Instrument Serif headlines, Newsreader for reading, and Geist Mono for datelines. Interaction patterns were inspired by 21st.dev components and rebuilt in this style: Spotlight Card (card glow), Marquee (the wire), Command Palette, Bento Grid (sections), Scroll Progress, and the line-mask headline reveal.

Motion:

- **Lenis** handles smooth scrolling, driven by the GSAP ticker so ScrollTrigger stays in sync (`components/SmoothScroll.tsx`).
- **GSAP** scroll animations are declared in markup with `data-anim` and run by `components/MotionDirector.tsx`:
  - `words`: headline words rise on enter
  - `rule`: rules draw across as you scroll
  - `scrub-words`: text inks in word by word
  - `parallax`: drift and fade
  - `count`: numbers count up
  - `bg-drift`: the background pattern drifts
- Split text is rendered on the server by `SplitWords`.
- Cards and list items with `data-reveal` fade up in batches (`ScrollReveal`).
- The wire ticker speeds up with Lenis scroll velocity.
- The masthead and lead headline intros are pure CSS, so they play before JavaScript loads.
- All of it switches off under `prefers-reduced-motion`.

Accessibility rules the UI follows:

- One `h1` per page, one site footer, and a skip link.
- Text is at least 11 px, and every text colour meets WCAG AA contrast in both themes.
- Visible focus rings. The command palette is a combobox with a listbox.
- The ticker can be paused. `prefers-reduced-motion` disables smooth scrolling, the ticker and reveal animations.
