#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const pExecFile = promisify(execFile);

type Scope = "user" | "project" | "local";

interface Entry {
  name: string;
  scope: Scope;
  location: string;
  transport?: string;
  url?: string;
  status?: string;
}

const HOME = homedir();
const CLAUDE_JSON = `${HOME}/.claude.json`;
const ROOT = dirname(fileURLToPath(import.meta.url));

async function pathExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function readJSON(path: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return undefined; }
}

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await pExecFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 });
    return stdout + stderr;
  } catch (e: any) {
    return (e?.stdout ?? "") + (e?.stderr ?? "");
  }
}

async function readUserScope(): Promise<Entry[]> {
  const raw = await run("claude", ["mcp", "list"]);
  const entries: Entry[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(claude\.ai\s+)?([^:]+):\s*(https?:\/\/\S+)\s*-\s*(.*)$/);
    if (!m) continue;
    const name = m[2].trim();
    const url = m[3].trim();
    const status = m[4].replace(/[✓✗]/g, "").trim();
    entries.push({ name, scope: "user", location: "claude.ai (remote)", transport: "remote", url, status });
  }
  const data = await readJSON(CLAUDE_JSON);
  const servers = data?.mcpServers ?? {};
  for (const [name, cfg] of Object.entries<any>(servers)) {
    entries.push({
      name, scope: "user", location: "~/.claude.json (user)",
      transport: cfg?.type ?? (cfg?.command ? "stdio" : "unknown"), url: cfg?.url,
    });
  }
  return entries;
}

async function readLocalScope(): Promise<Entry[]> {
  const data = await readJSON(CLAUDE_JSON);
  const projects = data?.projects ?? {};
  const entries: Entry[] = [];
  for (const [path, p] of Object.entries<any>(projects)) {
    const servers = p?.mcpServers ?? {};
    if (Object.keys(servers).length === 0) continue;
    if (!(await pathExists(path))) continue;
    for (const [name, cfg] of Object.entries<any>(servers)) {
      entries.push({
        name, scope: "local", location: path.replace(HOME, "~"),
        transport: cfg?.type ?? (cfg?.command ? "stdio" : (cfg?.url ? "http" : "unknown")), url: cfg?.url,
      });
    }
  }
  return entries;
}

interface PluginInstall { id: string; scope: string; projectPath?: string }
async function readInstalledPlugins(): Promise<{ byPath: Map<string, PluginInstall> }> {
  const byPath = new Map<string, PluginInstall>();
  const data = await readJSON(`${HOME}/.claude/plugins/installed_plugins.json`);
  for (const [id, insts] of Object.entries<any>(data?.plugins ?? {})) {
    for (const inst of insts as any[]) {
      if (inst?.installPath) byPath.set(inst.installPath, { id, scope: inst.scope, projectPath: inst.projectPath });
    }
  }
  return { byPath };
}

const enabledCache = new Map<string, Set<string>>();
async function enabledPluginsAt(scopeKey: string): Promise<Set<string>> {
  if (enabledCache.has(scopeKey)) return enabledCache.get(scopeKey)!;
  const set = new Set<string>();
  const files = scopeKey === "__user__"
    ? [`${HOME}/.claude/settings.json`]
    : [`${scopeKey}/.claude/settings.json`, `${scopeKey}/.claude/settings.local.json`];
  for (const f of files) {
    const d = await readJSON(f);
    for (const [k, v] of Object.entries(d?.enabledPlugins ?? {})) if (v) set.add(k);
  }
  enabledCache.set(scopeKey, set);
  return set;
}

async function readProjectScope(): Promise<Entry[]> {
  const entries: Entry[] = [];
  const out = await run("fd", ["-H", "-t", "f", "\\.mcp\\.json$", HOME, "--max-depth", "8"]);
  const { byPath } = await readInstalledPlugins();
  const PLUGIN_SRC = /\/(cowork_plugins|marketplaces|claude-marketplace\/plugins|\.claude\/plugins\/(cache|marketplaces))\//;

  for (const path of out.split("\n").filter(Boolean)) {
    const dir = path.replace(/\/\.mcp\.json$/, "");
    const isPluginSrc = PLUGIN_SRC.test(path);
    let label: string;
    let kind: string;
    if (isPluginSrc) {
      const inst = byPath.get(dir);
      if (!inst) continue;
      const key = inst.scope === "user" ? "__user__" : (inst.projectPath ?? "__user__");
      const ep = await enabledPluginsAt(key);
      if (!ep.has(inst.id)) continue;
      label = `${inst.id}@${inst.scope === "user" ? "user" : (inst.projectPath ?? "?").replace(HOME, "~")}`;
      kind = "plugin";
    } else {
      label = dir.replace(HOME, "~");
      kind = "project";
    }
    const data = await readJSON(path);
    const servers = data?.mcpServers ?? {};
    for (const [name, cfg] of Object.entries<any>(servers)) {
      entries.push({
        name, scope: "project", location: label,
        transport: kind === "plugin" ? "plugin" : (cfg?.type ?? (cfg?.command ? "stdio" : (cfg?.url ? "http" : "project"))),
        url: cfg?.url,
      });
    }
  }
  return entries;
}

type Source = { kind: string; where: string };
type ScopeOut = { id: Scope; title: string; note: string; regionNote: string; servers: { name: string; sources: Source[] }[] };

const META: Record<Scope, Pick<ScopeOut, "title" | "note" | "regionNote">> = {
  user:    { title: "User Scope",    note: "claude.ai remote & user-global, present in every bay", regionNote: "claude.ai remote & user-global, present everywhere." },
  project: { title: "Project Scope", note: ".mcp.json, committed unto each project",               regionNote: ".mcp.json committed in each project." },
  local:   { title: "Local Scope",   note: "~/.claude.json · per-project, private to this engine", regionNote: "~/.claude.json, per-project, private to this machine." },
};

function toSource(e: Entry): Source {
  if (e.scope === "user" && e.location.startsWith("claude.ai")) return { kind: "remote", where: "claude.ai" };
  return { kind: e.transport ?? e.scope, where: e.location };
}

function group(entries: Entry[]): { scopes: ScopeOut[] } {
  const byScope: Record<Scope, Map<string, Source[]>> = { user: new Map(), project: new Map(), local: new Map() };
  for (const e of entries) {
    const m = byScope[e.scope];
    if (!m.has(e.name)) m.set(e.name, []);
    m.get(e.name)!.push(toSource(e));
  }
  const scopes: ScopeOut[] = (["user", "project", "local"] as Scope[]).map(id => ({
    id, ...META[id],
    servers: [...byScope[id].entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, sources]) => ({ name, sources })),
  }));
  return { scopes };
}

async function collect(): Promise<{ scopes: ScopeOut[] }> {
  const all: Entry[] = [];
  all.push(...await readUserScope());
  all.push(...await readProjectScope());
  all.push(...await readLocalScope());
  return group(all);
}

const PORT = Number(process.env.PORT) || 7777;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/data.json") {
    const data = await collect();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = await readFile(join(ROOT, "index.html"), "utf8");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));
