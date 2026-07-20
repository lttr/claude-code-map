# Spec — standing context on the map (CLAUDE.md, rules, auto-memory)

## Goal

Give the atlas a second pillar next to _servitors_ (invokable things): **standing context** — everything loaded into Claude's context at session start in a project, whether or not it's ever invoked. Auto-memory is one member of this set, not a special case. Ship as a card stamp per project plus a global baseline strip on the overview plate. Line counts only; no tokens, no sessions.

Reference: https://code.claude.com/docs/en/memory (CLAUDE.md, rules, imports, auto-memory).

## Domain (new vocabulary → BOUNDED-CONTEXT.md)

- **Standing context** — files loaded at session start, always-on, not invoked. The expedition's briefing. Distinct axis from servitors; no invocation count.
- **Context source** — one such file. `ContextKind`: `claude-md`, `claude-local`, `rule`, `memory-index`.
- **Load mode** — `always` (loaded every session), `on-demand` (path-scoped rule with `paths:` frontmatter; loads only on matching file), `overflow-truncated` (`MEMORY.md` past the 200-line / 25KB head — tail silently not loaded).
- **Baseline** — the global standing context loaded in _every_ project: `~/.claude/CLAUDE.md`, `~/.claude/rules/*.md`, managed policy `/etc/claude-code/CLAUDE.md`. Shown once on the overview, never repeated per card.
- **Marginal context** — a project's own standing context on top of the baseline: `<proj>/CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/**`, `MEMORY.md`, imports. This is what a card stamp shows.
- **Briefing weight** — total `always` lines a card contributes (marginal), rendered on the stamp.

## Data model (collect.ts)

```ts
type ContextKind = "claude-md" | "claude-local" | "rule" | "memory-index";
type LoadMode = "always" | "on-demand" | "overflow-truncated";

interface ContextSource {
  kind: ContextKind;
  scope: "managed" | "user" | "project" | "local";
  path: string;
  lines: number; // whole-file line count
  loadMode: LoadMode;
  importCount?: number; // count-and-flag: number of @path mentions
  importLines?: number; // best-effort ONE-level resolved lines (approximate)
  importsDeep?: boolean; // true if any resolved import itself has @path mentions (not followed)
  overCliff?: boolean; // claude-md over ~200 lines (adherence warning per docs)
}

interface ProjectContext {
  sources: ContextSource[];
  alwaysLines: number; // sum of `always` source lines + importLines
  onDemandRules: number; // count of path-scoped rules
  hasOverflow: boolean; // any memory-index truncated
  hasOverCliff: boolean; // any CLAUDE.md over the cliff
}
```

- `ProjectInfo` gains `context?: ProjectContext`.
- `CollectResult` gains `baseline: ContextSource[]` (global always-on, marked scope `managed`/`user`).
- Memory is folded in: `memory-index` is just a `ContextSource` built from `MEMORY.md`; topic-file count can ride along as a note but is not loaded at launch, so it is not counted in `alwaysLines`.

## Collection

New step in the per-project candidate loop (`collect.ts` ~800, beside local-item scan). Each already-resolved `projectPath` gets a `scanContext(projectPath)`:

- **CLAUDE.md** — read `<proj>/CLAUDE.md` and `<proj>/.claude/CLAUDE.md` (either or both may exist). Count lines. Flag `overCliff` if > 200.
- **CLAUDE.local.md** — `<proj>/CLAUDE.local.md`.
- **Rules** — glob `<proj>/.claude/rules/**/*.md`. Peek YAML frontmatter for a `paths:` key: present → `on-demand`, absent → `always`.
- **AGENTS.md** — skipped in v1 unless reached via an `@AGENTS.md` import, in which case it is already counted through the importing file's `importLines`. No standalone `agents-md` source.
- **Imports (count-and-flag)** — scan each CLAUDE.md / local / rule body for `@path` mentions outside code fences/spans. `importCount` = how many. Resolve one level (relative to the file, and `~/`), sum their line counts into `importLines`, set `importsDeep` if any resolved file itself contains `@path`. Do not recurse further.
- **Memory** — `~/.claude/projects/<slug>/memory/MEMORY.md`. The slug is already resolved (`folderToCwdCache`, reverse the cwd→slug you have). Line count; `loadMode = overflow-truncated` if > 200 lines or > 25KB, else `always` (but only the head counts toward load — cap counted lines at 200 for `alwaysLines`).

Baseline scan (once): `~/.claude/CLAUDE.md`, `~/.claude/rules/**/*.md`, and the Linux managed path `/etc/claude-code/CLAUDE.md` if present.

Dormancy: a project with any `context.sources` (or memory) is **not** dormant even with zero activity/servitors — update the `dormant` test at `collect.ts:836` and BOUNDED-CONTEXT.

## Rendering

**Project card** (`render.ts:439`, `projectCard`) — add a **briefing stamp** in `.proj-head`, after the activity/use badge:

- `📓 briefing 142 ln` (alwaysLines), muted.
- Small marginalia ticks when present: `overflow` (memory tail not loaded), `long CLAUDE.md` (over cliff), `N on-demand rules`.
- Optional hover/expand listing each source `kind · scope · lines` (reuse the expandable-row pattern from the ledger work). Collapsed by default.

**Overview plate** (`render.ts` `renderAtlas` ~490) — a **baseline strip** under the tally: "Every project also loads N lines of standing context — user CLAUDE.md (x) · user rules (y) · managed policy (z)." One line, so a card's stamp reads as _marginal on top of this_.

**CSS** (`atlas.css`) — `.briefing-stamp`, `.briefing-tick`, `.baseline-strip`. Muted period ink; not a kind hue (standing context is a separate axis, so it should not read as a servitor chip).

Tally: optional 5th stat cell is out of scope for v1 unless a slot frees up; the baseline strip carries the global number.

## Out of scope (v1)

- **`autoMemoryDirectory` override** — scan the default `~/.claude/projects/<slug>/memory/` only. Custom dirs (any settings scope, absolute or `~/`) not resolved; note it.
- **Ancestor CLAUDE.md walk** — monorepo subdir projects load ancestor CLAUDE.md up the tree. v1 reads the project's own locations only.
- **Deep import resolution** — only one level, approximate. `importsDeep` flags that the number undercounts.
- **Token estimation and per-session cost** — line counts only, per the decision.
- **`InstructionsLoaded` hook telemetry** — precise per-session load events exist only if the user configured that hook; not read.
- **`claudeMdExcludes` / `claudeMd` managed key** — not honored; counts may overstate what actually loads in an excluded monorepo.

## Files to touch

- `src/collect.ts` — `ContextSource`/`ProjectContext` types; `scanContext()`; baseline scan; slug reverse-lookup for memory; extend `ProjectInfo`, `CollectResult`; dormancy fix.
- `src/render.ts` — `briefingStamp()` in `projectCard`; `baselineStrip()` in `renderAtlas`.
- `src/atlas.css` — stamp / tick / baseline-strip styles.
- `BOUNDED-CONTEXT.md` — new "Standing context" section + the vocabulary above; amend the Heat note (heat can now derive from memory mtime) and the Dormant definition.

## Provisional decisions (try first, revisit after we see it)

- **Stamp glyph** — `❧` (hedera/fleuron), a period typographic ornament, in muted ink: `❧ briefing 142 ln`. No emoji; reads as marginalia, not a servitor chip.
- **Breakdown location** — on the card, collapsed, reusing the ledger's expandable-row pattern. Each row `kind · scope · lines`. Surveyor's Ledger dead-weight integration (overflow memory, over-cliff CLAUDE.md, never-matching on-demand rules) is deferred to a follow-up, not v1.
- **Non-imported AGENTS.md** — skip entirely in v1. Only count AGENTS.md when reached via `@AGENTS.md` import (where it surfaces through `importLines` on the importing file). Drop `agents-md` as its own `ContextKind` for now; keeps counts honest.
