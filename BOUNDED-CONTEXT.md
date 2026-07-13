# Context — claude-code-map

Glossary of terms used in this project. Implementation details belong in code; this is the shared language only.

## Inventoried items

- **Servitor** — generic term in cartographer voice for any item this tool inventories. Concrete kinds: MCP server, skill, slash command, subagent, hook.
- **Kind** — one of `mcp`, `skill`, `command`, `subagent`, `hook`. Drives the chip hue and grouping. Hooks are passive event handlers (they don't get invoked by name), so they don't accrue usage stats and are excluded from contested-name detection.
- **Location** — where a servitor lives. Coarse values: `global` (`~/.claude/{skills,commands,agents}`), `user-plugin`, `scoped-plugin`, `local` (project's `.claude/`), and the three MCP scopes below.
- **MCP scope** — one of `user`, `project`, `local`. MCP-specific subdivision of location, predating the unification.

## Usage

- **Recency tier** — `hot` (≤7d), `warm` (≤30d), `cool` (≤90d), `stale` (older), `none` (never recorded). Derived from transcript history.
- **Heat** — informal name for the recency dimension. Rendered as ink density on the page.
- **Activity** — aggregate invocation count for a project or item across tiers.

## Cross-cutting

- **Contested name** — an invocation token that resolves to 2+ implementations across kinds or locations (e.g., a global skill `verify` and a plugin command `/verify`). Replaces the earlier MCP-only "cross-scope" concept. Counted in the tally; flagged in the gazetteer.

## Standing context

Second pillar next to servitors. Where a servitor is *invokable*, standing context is *always-on*: files loaded into Claude's context at session start whether or not they are ever invoked. Line counts only — no tokens, no sessions. Ref: https://code.claude.com/docs/en/memory.

- **Standing context** — files loaded at session start, always-on, not invoked. The expedition's briefing. A distinct axis from servitors; no invocation count, no heat.
- **Context source** — one such file. `ContextKind`: `claude-md`, `claude-local`, `rule`, `memory-index`. Auto-memory is one member of this set (`memory-index`, built from `MEMORY.md`), not a special case.
- **Load mode** — `always` (loaded every session), `on-demand` (a path-scoped rule with `paths:` frontmatter; loads only on a matching file), `overflow-truncated` (`MEMORY.md` past the 200-line / 25KB head — the tail is silently not loaded).
- **Baseline** — the global standing context loaded in *every* project: `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md`, managed policy `/etc/claude-code/CLAUDE.md`. Shown once on the overview as the baseline strip, never repeated per card.
- **Marginal context** — a project's own standing context on top of the baseline: its `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/**`, `MEMORY.md`, and their imports. A card's briefing stamp shows this.
- **Briefing weight** — total lines a card actually loads every session (`alwaysLines`): whole-file for always sources, the head only for truncated memory, nothing for on-demand rules, plus one-level resolved imports.
- **Import** — an `@path` mention in a source body. Count-and-flag only: counted, resolved one level for an approximate line total, flagged `importsDeep` when a resolved file imports further (not followed).
- **Cliff** — a `CLAUDE.md` over ~200 lines, flagged `overCliff` as an adherence warning.

## Page structure

- **Plate** — one paper sheet in the atlas. Each plate has its own cartouche, border, and texture.
- **Overview plate** — top plate: cartouche, tally, [[compass-plate]], and global/user-wide inventory.
- **Compass plate** — small symbolic SVG legend on the overview plate. Shows the four kind hues and the location rings. Carries no data — purely a key.
- **Regional plate** — one plate per parent directory of projects (any workspace root). Holds project cards inside that region, sorted by activity.
- **Province / Region** — parent-directory grouping of projects. Synonym for what a regional plate covers.
- **Project card** — one card on a regional plate, listing that project's local items, scoped plugins, and activity stamp.

## Visual vocabulary

- **Cartographer palette** — period-ink hues, one per kind: iron-gall (skill), madder/red-ochre (command), verdigris/sage (subagent), sepia/umber (MCP). AA contrast against the paper background is a hard constraint.
- **Ink density** — saturation/value used to encode heat within a kind's hue. Hot = full ink, never = dotted outline.

## Lifecycle

- **Dormant project** — exists on disk but has no recorded activity, no local items, no scoped plugins, no project-scope MCPs, and no standing context. A project that loads its own CLAUDE.md, rules, or auto-memory is *not* dormant even with zero activity. Hidden from regional plates; counted in the tally.
- **Missing project** — referenced by transcripts or plugin install records but its directory no longer exists. Dropped entirely; counted as "dropped" in the tally.
