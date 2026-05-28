# Spec — merge skills-map into claude-code-map

## Goal

Fold all functionality of `~/code/claude-code-skills-map` into `claude-code-map`, keep cartographer visuals. Ship as single npm CLI, run once.

## Domain

- **Kinds:** mcp, skill, command, subagent
- **Locations:** global (`~/.claude/{skills,commands,agents}`), user-plugin, scoped-plugin, local (`<proj>/.claude/`), MCP scopes (user/project/local)
- **Recency tiers:** hot ≤7d, warm ≤30d, cool ≤90d, stale, none
- **Contested name:** token resolves to 2+ impls across kinds/locations
- Full glossary → [CONTEXT.md](../../CONTEXT.md)

## Architecture

Hybrid two-request CLI. No framework.

- `GET /` → shell HTML (cartouche, tally skeleton, compass plate, loading overlay). Sub-100ms.
- `GET /atlas.html` → server-rendered atlas body fragment, swapped in on arrival.
- `--out FILE` → full page rendered in one shot, no server.
- TypeScript source, run via `node` directly (≥23.6, no flags).
- Split files: `bin/claude-code-map.ts`, `templates/shell.html`, `templates/atlas.css`, optional render helpers. Client JS only handles fragment swap + overlay transition.

## CLI

```
claude-code-map [options]
  -p, --port N      default 7777
      --host HOST   default 127.0.0.1
  -o, --out FILE    static export, no server
  -h, --help
```

## Data sources

- MCPs: `~/.claude.json` (`mcpServers`, `projects.*.mcpServers`), `.mcp.json` via `fd`, plugin `.mcp.json` filtered by `installed_plugins.json` + per-scope `enabledPlugins`, `claude mcp list` for claude.ai remotes.
- Skills/commands/agents: `~/.claude/{skills,commands,agents}`, plugin install paths, project `<proj>/.claude/{skills,commands,agents}`.
- Plugin status: cross-check `installed_plugins.json` against `known_marketplaces.json` (active / archived / removed / orphaned).
- Usage: stream `~/.claude/projects/*.jsonl`, regex on Skill tool invocations, `<command-name>` tags, `subagent_type`, and SKILL.md reads. Bucket per kind × scope (global/per-project) × recency.
- Project resolution: `cwd` from jsonl, fallback dash-decode of folder name.

## Page

Overview plate

- Cartouche: title, subtitle, ornament, locale-formatted date.
- Tally, two rows:
  - row 1: mcp · skill · command · subagent (unique counts)
  - row 2: invocations 7d · invocations 30d · contested names · dormant projects
- Compass plate: symbolic SVG, 4 kind hues + location/scope rings. Legend only.
- Global/user inventory: 3-column gazetteer (global / user plugins / user MCPs+remotes) with chips per item, sorted by usage then name.

Regional plates

- One per parent dir, sorted by aggregate activity desc.
- Inside: project cards sorted by project activity. Each card: project path, activity stamp (`N invocations · last YYYY-MM-DD`), local items (skills/commands/agents), scoped plugins (with status marginalia), project-scope MCPs.

Chip

- Hue = kind. Ink density = recency tier. Dotted outline for `none`.
- Hover tooltip: 7d/30d/90d/total counts, last-used date.
- Contested name → cartographer mark (TBD glyph, replaces ✦).

## Filtering

- Missing project (dir gone) → drop, count as dropped.
- Dormant project (on disk, zero of {activity, local items, scoped plugins, project MCPs}) → hide card, count in tally.

## Perf

- In-process cache of parsed JSONL keyed by `path + mtime`. First load slow; refresh fast.
- No disk cache. No eviction.

## Files to touch

- `package.json` — add `bin` entry, bump engines to `>=23.6`, drop `start` or repoint to bin.
- `bin/claude-code-map.ts` — new, merges current `src/backend.ts` + skills-map collection logic.
- `templates/shell.html` — new, from current `src/index.html` minus the gazetteer JS.
- `templates/atlas.html.ts` (or `.css` + render helpers) — new, server renders atlas fragment.
- `src/` — delete after migration.
- `CONTEXT.md` — done.
- `notes.md` — done (session notes).

## Out of scope

- Data-bearing SVG map (force-directed island chart). Defer to v2.
- Filters/search UI. Static page only.
- `/data.json` public endpoint. Drop; revisit only if external consumer appears.
- Hosted/multi-user deployment.

## Unresolved

- Page title wording: "Map of my Servitors" vs keep "MCPs" with expanded subtitle.
- Plugin status badges → cartographer marginalia: Latin tags? small symbols? Italic "archived" suffix?
- Contested-name glyph: keep ✦ red, or introduce a second mark?
- Exact final hex values for the 4 kind hues after AA pass on `--paper` (`#efe3c8`).
- Compass plate exact geometry: rose with 4 points (one per kind) and 3 nested rings (scopes), or 4 rings + 4 cardinal labels?
