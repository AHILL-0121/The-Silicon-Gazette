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
  analytics/                 Private dashboard (client shell; noindex, rendered per request for the CSP nonce)
  api/track/                 Analytics ingestion
  api/analytics/             Dashboard login/session, data, CSV export, storage, rollup
  sitemap.ts, robots.ts, icon.png, favicon.ico, opengraph-image.tsx
middleware.ts                Nonce Content-Security-Policy for /analytics
components/                  UI (server components unless marked "use client")
  analytics/                 Tracker (mounted in the root layout), dashboard, charts, login, session guard
lib/
  edition-service.ts         Read (cached) / generate (locked, cooled down) editions
  edition-view.ts            Stored edition -> what the UI renders (dedupe, slugs, sections)
  gazette.ts                 Zod schema, normalisation, URL safety, duplicate detection
  groq.ts, gemini.ts, tavily.ts  Generation pipeline
  generation-lock.ts, rate-limit.ts  Upstash Redis lock and limiter
  db.ts, schema.ts           Drizzle + Neon
  analytics/                 Events schema, ingestion, visitor hashing, owner sessions,
                             daily aggregation SQL (daily.ts), rollups, dashboard queries
assets/fonts/                Fonts for the PNG social cards (SIL Open Font License)
scripts/                     verify-pipeline.ts, verify-redis.ts, verify-analytics.ts
```

## Analytics internals

- **Tracking:** `lib/analytics/client.ts` queues events and sends them with `sendBeacon`, after 2 s, at 10 events, or when the page is hidden or unloads. Each event carries its own page path, because a batch can span a client-side navigation. Clicks are tracked by delegation from `data-track` / `data-track-*` attributes, or by calling `track()` directly. The 404 page renders `NotFoundBeacon` so its views are stored with page type `404`.
- **Events:** each event name has a Zod props schema in `lib/analytics/events.ts`. `/api/track` validates events one at a time, so one bad event doesn't drop the batch.
- **Aggregation:** `lib/analytics/daily.ts` builds the per-UTC-day SQL for each rollup table. The rollup (`rollup.ts`, one transaction per day) inserts those rows, and `queries.ts` runs the same SQL over days that aren't rolled up yet. A day counts as rolled up once it has a `daily_session_stats` row. Today and yesterday are always read raw.
- **CSP:** the root layout's inline theme script (`lib/theme-script.ts`) is allowed by its SHA-256 hash, and Next.js adds the per-request nonce to its own scripts. The nonce isn't read in the root layout, because that would force every public page to render per request.

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
