---
name: run-claude-code-map
description: Run, start, serve, smoke-test, or screenshot the claude-code-map atlas. Use when asked to launch the CLI, verify the atlas renders, check a change in the running app, or capture the map in a browser.
---

# Run claude-code-map

Runs from TypeScript source, no build step: `node bin/cli.ts` (Node ≥ 22.6;
repo pins v24 via `.node-version`). Paths relative to repo root.

Run and drive it:

```sh
node bin/cli.ts --port 7891 &
agent-browser open http://127.0.0.1:7891/
agent-browser snapshot -i     # then click/press by ref; screenshot needs an ABSOLUTE path
kill %1
```

Only when checking that serving/`--out` still work (self-terminating, ~5s):

```sh
bash .claude/skills/run-claude-code-map/smoke.sh   # prints SMOKE OK, exit 0
```

## Gotchas

- `GET /` is a ~26KB shell that fetches content at runtime — content
  assertions must hit `/atlas.html` (the rendered fragment). Grep it for
  structural classes (`proj-head`, `rel-row`), not prose words.
- Node prints `ExperimentalWarning: stripTypeScriptTypes` on stderr on
  every run. Harmless.
- `vp run test` exits 1 because no test files exist — not a regression.
