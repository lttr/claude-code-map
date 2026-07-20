import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "client");

// The shell references client scripts via `<!-- script:name -->` markers,
// resolved here from src/client/name.ts. Types are stripped blank-preserving,
// so browser devtools line numbers match the TS source.
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
    const src = await readFile(join(CLIENT_DIR, `${name}.ts`), "utf8");
    out = out.replace(marker, `<script>\n${stripTypeScriptTypes(src)}</script>`);
  }
  return out;
}
