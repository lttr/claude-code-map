# Notes

## 2026-05-28 — Merging skills-map into this project

Decided to expand claude-code-map from MCP-only to a four-kind inventory (MCP, skill, command, subagent) folding in everything `~/code/claude-code-skills-map` does, while keeping the cartographer visual identity.

Key decisions:

- **Superset**, not replace — MCPs become one kind among four.
- **Cartographer recency encoding** — period-ink palette (iron-gall / madder / verdigris / sepia), ink density encodes heat tier (hot/warm/cool/stale/none). AA contrast on paper is a hard constraint.
- **Atlas page structure** — overview plate (cartouche, tally, compass legend, global/user inventory) + regional plates (one per parent dir of projects, project cards inside).
- **Compass plate** is a symbolic SVG legend only — no data points on it.
- **Live but locale-dated** — every refresh redraws, date renders via `Intl.DateTimeFormat`. Cartographer styling is garnish, not a frozen-snapshot fiction.
- **Hybrid two-request architecture** — `GET /` returns a thin shell + loading overlay in ms; `GET /atlas.html` returns the fully-rendered body fragment once scanning + transcript parsing finish; client script swaps it in.
- **Split files** — real `.html`/`.css`, no string-literal templates. Server-side rendering keeps client logic to overlay-swap only.
- **Two-row tally** — per-kind counts above, activity stats below.
- **"Contested name"** replaces "cross-scope" — same invocation token resolving to 2+ implementations across kinds or locations.
- **TypeScript, no flags** — Node ≥23.6 strips types natively.
- **Not Nuxt** — would solve the loading-UX problem cleanly but breaks the "single small npm CLI, `node bin/foo.ts` and go" shape that's the whole point.

Auto-resolved details:

- CLI mirrors skills-map: `-p/--port` (7777), `--host` (127.0.0.1), `-o/--out FILE` (static export), `-h`.
- In-process cache of parsed transcripts keyed by `path + mtime`. No disk cache.
- Dormant projects (on disk, zero activity + zero local + zero scoped + zero project-MCPs) are hidden, counted in tally.
- Missing projects (referenced but dir gone) are dropped, counted as "dropped".

Open visual calls deferred to render time:

- Page title wording ("Map of my Servitors" vs keep "MCPs" with expanded subtitle).
- Plugin status badges (active/archived/removed/orphaned) — translation to cartographer marginalia.
