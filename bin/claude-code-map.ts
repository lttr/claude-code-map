#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { collect } from "./collect.ts";
import { renderAtlas, renderFullPage } from "./render.ts";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHELL_PATH = join(ROOT, "templates/shell.html");
const CSS_PATH = join(ROOT, "templates/atlas.css");

interface Args {
  port: number;
  host: string;
  outPath?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { port: 7777, host: "127.0.0.1", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--port") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "-o" || a === "--out") out.outPath = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

const HELP = `Usage: claude-code-map [options]

Scans ~/.claude (skills, commands, subagents, MCPs, plugins, JSONL transcripts)
and serves an interactive cartographer atlas from a local HTTP server.

Options:
  -p, --port N     Server port (default: 7777)
      --host HOST  Bind host (default: 127.0.0.1)
  -o, --out FILE   Render once to FILE (no server)
  -h, --help       Show this help`;

async function loadShell(): Promise<string> { return readFile(SHELL_PATH, "utf8"); }
async function loadCss(): Promise<string>   { return readFile(CSS_PATH, "utf8"); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return; }

  if (args.outPath) {
    const t0 = Date.now();
    const [shell, css, result] = await Promise.all([loadShell(), loadCss(), collect()]);
    const atlas = renderAtlas(result);
    const html = renderFullPage(shell, css, atlas);
    await writeFile(args.outPath, html);
    const t = result.tally;
    console.log(`wrote ${args.outPath} (${Date.now() - t0}ms)`);
    console.log(`tally: mcp=${t.counts.mcp} skill=${t.counts.skill} command=${t.counts.command} subagent=${t.counts.subagent} | 7d=${t.invocations7d} 30d=${t.invocations30d} contested=${t.contested} dormant=${t.dormant}`);
    return;
  }

  const server = createServer(async (req, res) => {
    const t0 = Date.now();
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const shell = await loadShell();
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(shell);
        console.log(`${new Date().toISOString()}  GET ${url.pathname}  ${Date.now() - t0}ms`);
        return;
      }
      if (url.pathname === "/atlas.css") {
        const css = await loadCss();
        res.writeHead(200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-store" });
        res.end(css);
        return;
      }
      if (url.pathname === "/atlas.html") {
        const result = await collect();
        const fragment = renderAtlas(result);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(fragment);
        const t = result.tally;
        console.log(`${new Date().toISOString()}  GET /atlas.html  ${Date.now() - t0}ms  mcp=${t.counts.mcp} sk=${t.counts.skill} cm=${t.counts.command} sa=${t.counts.subagent} 7d=${t.invocations7d}`);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(String(e?.stack ?? e));
      console.error(e);
    }
  });
  server.on("error", (e: any) => { console.error(`server error: ${e.message}`); process.exit(1); });
  server.listen(args.port, args.host, () => {
    console.log(`claude-code-map → http://${args.host}:${args.port}/  (refresh to rebuild, ctrl-c to stop)`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
