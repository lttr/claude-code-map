import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "client");

// The shell references client scripts via `<!-- script:name -->` markers,
// resolved here from src/client/name. The published build ships a pre-stripped
// name.js next to this file; in dev the TS source is stripped on the fly.
// Both are blank-preserving, so browser devtools line numbers match the TS source.
async function loadClientScript(name: string): Promise<string> {
  try {
    return await readFile(join(CLIENT_DIR, `${name}.js`), "utf8");
  } catch {
    const { stripTypeScriptTypes } = await import("node:module");
    const src = await readFile(join(CLIENT_DIR, `${name}.ts`), "utf8");
    return stripTypeScriptTypes(src);
  }
}

export async function injectClientScripts(
  shell: string,
  opts: { runtimeFetch: boolean },
): Promise<string> {
  const names = [...shell.matchAll(/<!-- script:([\w-]+) -->/g)].map((m) => m[1]);
  let out = shell;
  for (const name of names) {
    const marker = `<!-- script:${name} -->`;
    if (name === "fetch-atlas" && !opts.runtimeFetch) {
      out = out.replace(marker, "");
      continue;
    }
    out = out.replace(marker, `<script>\n${await loadClientScript(name)}</script>`);
  }
  return out;
}
