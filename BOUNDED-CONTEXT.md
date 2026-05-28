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

- **Dormant project** — exists on disk but has no recorded activity, no local items, no scoped plugins, and no project-scope MCPs. Hidden from regional plates; counted in the tally.
- **Missing project** — referenced by transcripts or plugin install records but its directory no longer exists. Dropped entirely; counted as "dropped" in the tally.
