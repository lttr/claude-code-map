// Runs after `tsc -p tsconfig.build.json`: copies static assets into dist/
// and pre-strips the browser client scripts to plain JS so the published
// package runs without Node's type-stripping (see src/inline-scripts.ts).
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";

const SRC = "src";
const OUT = join("dist", "src");
const CLIENT_OUT = join(OUT, "client");

await mkdir(CLIENT_OUT, { recursive: true });
await copyFile(join(SRC, "shell.html"), join(OUT, "shell.html"));
await copyFile(join(SRC, "atlas.css"), join(OUT, "atlas.css"));

for (const f of await readdir(join(SRC, "client"))) {
  if (!f.endsWith(".ts")) continue;
  const src = await readFile(join(SRC, "client", f), "utf8");
  await writeFile(join(CLIENT_OUT, f.replace(/\.ts$/, ".js")), stripTypeScriptTypes(src));
}

console.log("dist/ assets ready");
