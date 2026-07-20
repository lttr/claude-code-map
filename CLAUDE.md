# claude-code-map

CLI that scans `~/.claude` and serves an interactive atlas of skills, commands, subagents, MCPs, plugins, and hooks. Published as `@lttr/claude-code-map`.

- `pnpm run dev` — serve with watch; `check` — lint+typecheck; `build` — plain-JS `dist/`; `release` — publish
- Flow: `src/collect.ts` (scan) → `src/render.ts` (HTML) → `bin/cli.ts` (serve or `--out`)
- Conventional commits (hook-enforced). Domain vocabulary in `GLOSSARY.md` — use it.
- Stay OS-agnostic: no shelling out to tools that may not exist, paths via `node:path`
