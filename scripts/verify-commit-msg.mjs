// commit-msg hook: enforce conventional commits (https://www.conventionalcommits.org)
// so changelogen can derive version bumps and the changelog from history.
import { readFileSync } from "node:fs";

const first = readFileSync(process.argv[2], "utf8").split("\n")[0].trim();

// merges, reverts and autosquash commits pass through
if (/^(Merge|Revert|fixup!|squash!)/.test(first)) process.exit(0);

// types mirror changelogen's defaults
const RE =
  /^(feat|fix|perf|refactor|docs|build|types|chore|test|style|ci|examples)(\([\w./-]+\))?!?: \S.*$/;

if (!RE.test(first)) {
  console.error(`✖ commit message does not follow conventional commits:

  ${first}

Expected: <type>(<optional scope>): <subject>
Types: feat fix perf refactor docs build types chore test style ci examples
Example: feat(cli): add --out flag for one-shot rendering`);
  process.exit(1);
}
