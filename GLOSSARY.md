# Glossary — claude-code-map

The atlas speaks in a **cartographer's voice**: your Claude Code setup is drawn as an antique
chart, so the code and the UI call things _servitors_, _plates_, _heat_ and _landmarks_ rather
than "items", "sections", "recency" and "search results". The metaphor is deliberate and load-
bearing — the terms below are the ones actually used in `src/` and on the page. Implementation
details belong in code; this is the shared language only.

## Inventoried items

- **Servitor** — any item this tool inventories. Concrete kinds: MCP server, skill, slash command, subagent, hook.
- **Kind** — one of `mcp`, `skill`, `command`, `subagent`, `hook`. Drives the chip hue and grouping. Hooks are passive event handlers (never invoked by name), so they accrue no usage stats and are excluded from contested-name detection.
- **Location** — where a servitor lives: `global` (`~/.claude/{skills,commands,agents}`), `user-plugin`, `scoped-plugin`, `local` (project's `.claude/`). MCPs subdivide it further into scopes `user`, `project`, `local`.
- **Chip** — the rendered pill for one servitor. Hue = kind, ink density = heat, marks = contested / invocation restriction.

## Usage

- **Recency tier** — `hot` (≤7d), `warm` (≤30d), `cool` (≤90d), `stale` (older), `none` (never recorded). Derived from transcript history.
- **Heat** — the recency dimension, rendered as ink density on the chip.
- **Activity** — aggregate invocation count for a project or item.

## Cross-cutting

- **Contested name** — an invocation token that resolves to 2+ implementations across kinds or locations (e.g. a global skill `verify` and a plugin command `/verify`). Counted in the tally; flagged in the gazetteer.
- **Invocation mark** — a skill/command's frontmatter restriction on who may invoke it. `user-only` (from `disable-model-invocation: true`): slash-command only, drawn as the `/name` it's typed with. `model-only` (✳, from `user-invocable: false`): no slash command. Unset means both may invoke.
- **Relation / route** — a declared reference from one skill, command, or subagent to another, scraped from its body. Shown on the relations plate behind a toggle.
- **Frayed line** — declared wiring whose far end doesn't exist: a hook command naming a missing script, an `allowed-tools` `Bash(cmd)` binary not on PATH, an `@path` import that doesn't resolve, or a namespaced `/plugin:command` mention resolving to no known item. Static stat/PATH checks only — nothing is executed. Listed in the Surveyor's Ledger.

## Standing context

Second pillar next to servitors. Where a servitor is _invokable_, standing context is _always-on_:
files loaded into Claude's context at session start whether or not they are ever invoked. Line
counts only — no tokens, no sessions. Ref: https://code.claude.com/docs/en/memory.

- **Standing context** — the expedition's briefing. A distinct axis from servitors: no invocation count, no heat.
- **Context source** — one such file. `ContextKind`: `claude-md`, `claude-local`, `rule`, `memory-index`. Auto-memory is one member of this set (`memory-index`, built from `MEMORY.md`), not a special case.
- **Load mode** — `always` (every session), `on-demand` (a path-scoped rule with `paths:` frontmatter), `overflow-truncated` (`MEMORY.md` past the 200-line / 25KB head — the tail is silently not loaded).
- **Baseline** — the standing context loaded in _every_ project: `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md`, managed policy `/etc/claude-code/CLAUDE.md`. Shown once as the baseline strip, never repeated per card.
- **Marginal context** — a project's own standing context on top of the baseline. A card's briefing stamp shows this.
- **Briefing weight** — lines a card actually loads every session (`alwaysLines`): whole-file for always sources, head only for truncated memory, nothing for on-demand rules, plus one-level resolved imports.
- **Import** — an `@path` mention in a source body. Counted, resolved one level for an approximate line total, flagged `importsDeep` when a resolved file imports further (not followed).
- **Cliff** — a `CLAUDE.md` over ~200 lines, flagged `overCliff` as an adherence warning.

## Page structure

- **Plate** — one bordered sheet of the atlas, with its own cartouche and texture. The named ones: **compass plate** (the key — kind hues and recency samples, no data), **Surveyor's Ledger** (derived health and attrition figures), **Gazetteer** (the global and user-scope inventory), **Relations**, and one **regional plate** per region.
- **Province / Region** — parent-directory grouping of projects. What a regional plate covers.
- **Project card** — one card on a regional plate: that project's local items, scoped plugins, briefing stamp, and activity stamp.
- **Tally** — the two counter rows under the cartouche: servitors per kind, then invocations, contested names, dormant projects.
- **Astrolabe** — the <kbd>Ctrl</kbd>+<kbd>K</kbd> finder. A modal that fuzzy-matches every landmark and sails to the chosen one.
- **Landmark** — anything the astrolabe can sight: a chip, a project card, a region, or a plate. Indexed from the rendered DOM, not from the collector.
- **Sail / take a bearing** — the astrolabe's navigation act: scroll the landmark into view, flash it, focus it.
- **Ink density** — saturation used to encode heat within a kind's hue. Hot = full ink, never = dotted outline.

## Lifecycle

- **Dormant project** — exists on disk but has no recorded activity, no local items, no scoped plugins, no project-scope MCPs, and no standing context. A project that loads its own CLAUDE.md, rules, or auto-memory is _not_ dormant even with zero activity. Hidden from regional plates; counted in the tally.
- **Missing project** — referenced by transcripts or plugin install records but its directory no longer exists. Dropped entirely; counted as "dropped" in the tally.
