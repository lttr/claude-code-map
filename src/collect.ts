// Claude Code paths and config keys this collector reads. References:
//   ~/.claude/{skills,commands,agents}/                 user-level items
//     skills: https://code.claude.com/docs/en/skills
//     subagents: https://code.claude.com/docs/en/sub-agents
//     (commands have merged into skills; .claude/commands/*.md still works)
//   <proj>/.claude/{skills,commands,agents}/            project-local items (same docs)
//   <plugin-root>/{skills,commands,agents,.mcp.json}    plugin internal layout
//     SKILL.md lives at skills/<name>/SKILL.md
//     https://code.claude.com/docs/en/plugins
//   ~/.claude.json                                      main config: user-scope mcpServers + projects map
//     https://code.claude.com/docs/en/mcp
//   <proj>/.mcp.json                                    project-scope MCP config (same docs)
//   ~/.claude/settings.json, <proj>/.claude/settings{,.local}.json
//                                                       settings incl. enabledPlugins
//     https://code.claude.com/docs/en/settings
//   ~/.claude/plugins/known_marketplaces.json           registered marketplaces
//   ~/.claude/plugins/installed_plugins.json            installed plugin records
//   ~/.claude/plugins/{cache,marketplaces}/             on-disk plugin sources
//     https://code.claude.com/docs/en/discover-plugins
//   ~/.claude/projects/<slug>/*.jsonl                   transcripts (internal, undocumented)
import { readdir, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const CLAUDE = join(HOME, ".claude");
const CLAUDE_JSON = join(HOME, ".claude.json");
const pExecFile = promisify(execFile);

export type Kind = "mcp" | "skill" | "command" | "subagent" | "hook";
export type Recency = "hot" | "warm" | "cool" | "stale" | "none";
export type Location =
  | "global"
  | "user-plugin"
  | "scoped-plugin"
  | "local"
  | "user-mcp"
  | "project-mcp"
  | "claude-ai-remote";

export interface UsageBuckets {
  d7: number;
  d30: number;
  d90: number;
  total: number;
  last?: number;
}

export interface Item {
  kind: Kind;
  name: string;
  location: Location;
  pluginId?: string;
  pluginName?: string;
  pluginMarketplace?: string;
  pluginInstallPath?: string;
  pluginScope?: "user" | "project";
  pluginStatus?: "active" | "archived";
  pluginStatusNote?: string;
  projectPath?: string;
  transport?: string;
  url?: string;
  usage: UsageBuckets;
  // Same item counted across every transcript, ignoring project attribution. For
  // global/user items it equals `usage`; for project-scoped ones it also catches
  // invocations made from another cwd (a sibling repo, a subdirectory, a worktree),
  // so "never invoked" means never — not "never here".
  usageAnywhere: UsageBuckets;
  recency: Recency;
  contested: boolean;
  // When contested, the other origins (kind · place) that share this name.
  contestedWith?: string[];
  // Declared references (static body scrape): names this item points to, and
  // names that point back at it. Skills, commands, and subagents only; empty otherwise.
  refsOut?: string[];
  refsIn?: string[];
  // Frontmatter invocation restriction (skills/commands only; unset = both):
  //   user-only  → disable-model-invocation: true  (slash-command only)
  //   model-only → user-invocable: false           (no slash command)
  invocation?: "user-only" | "model-only";
}

export interface PluginInfo {
  id: string;
  name: string;
  marketplace: string;
  scope: "user" | "project";
  projectPath?: string;
  installPath: string;
  version?: string;
  status: "active" | "archived";
  statusNote: string;
  items: Item[];
}

// ---------- standing context (CLAUDE.md, rules, auto-memory) ----------
// A second axis next to servitors: files loaded into context at session start
// whether or not they are ever invoked. Line counts only (no tokens/sessions).
// Ref: https://code.claude.com/docs/en/memory
export type ContextKind = "claude-md" | "claude-local" | "rule" | "memory-index";
export type LoadMode = "always" | "on-demand" | "overflow-truncated";

export interface ContextSource {
  kind: ContextKind;
  scope: "managed" | "user" | "project" | "local";
  path: string;
  lines: number; // whole-file line count
  loadMode: LoadMode;
  importCount?: number; // count-and-flag: number of @path mentions
  importLines?: number; // best-effort ONE-level resolved lines (approximate)
  importsDeep?: boolean; // a resolved import itself has @path mentions (not followed)
  overCliff?: boolean; // CLAUDE.md over the ~200-line adherence cliff
}

export interface ProjectContext {
  sources: ContextSource[];
  alwaysLines: number; // lines actually loaded every session (marginal)
  onDemandRules: number; // count of path-scoped rules
  hasOverflow: boolean; // any memory-index truncated
  hasOverCliff: boolean; // any CLAUDE.md over the cliff
}

// Lines a source actually contributes at launch: on-demand rules add nothing,
// a truncated MEMORY.md contributes only its loaded head, everything else its
// whole body — plus any one-level resolved imports.
export function loadedContextLines(s: ContextSource): number {
  if (s.loadMode === "on-demand") return s.importLines ?? 0;
  const body = s.kind === "memory-index" ? Math.min(s.lines, MEMORY_HEAD_LINES) : s.lines;
  return body + (s.importLines ?? 0);
}

export interface ProjectInfo {
  path: string;
  inHistory: boolean;
  localItems: Item[];
  scopedPlugins: PluginInfo[];
  projectMcps: Item[];
  activity: UsageBuckets;
  dormant: boolean;
  context?: ProjectContext;
}

export interface CollectResult {
  globalItems: Item[];
  userPlugins: PluginInfo[];
  userMcps: Item[];
  regions: { label: string; projects: ProjectInfo[]; activity: UsageBuckets }[];
  baseline: ContextSource[]; // global standing context loaded in every project
  droppedProjects: number;
  dormantProjects: number;
  contestedNames: number;
  tally: {
    counts: { mcp: number; skill: number; command: number; subagent: number; hook: number };
    invocations7d: number;
    invocations30d: number;
    contested: number;
    dormant: number;
  };
  relations: Relation[];
  wiring: WiringIssue[];
  generatedAt: number;
}

// A declared reference from one skill/command/subagent to another, scraped from
// body text (slash or backticked mentions that resolve to a known item name).
// Static only.
export interface Relation {
  from: string;
  fromKind: Kind;
  fromLocation: Location;
  refs: { name: string; kind: Kind; ambiguous: boolean }[];
}

// A frayed line: declared wiring whose far end doesn't exist. All checks are
// single stat/PATH lookups — nothing is executed.
//   hook-script — a hook command names a script file that is missing
//   binary      — an allowed-tools Bash(cmd) binary not found on PATH
//   import      — an @path mention in a body that doesn't resolve
//   phantom     — a backticked `/slug` mention resolving to no known item
export interface WiringIssue {
  issue: "hook-script" | "binary" | "import" | "phantom";
  from: string;
  fromKind: Kind;
  where: string; // human place label: global / plugin <name> / ~/path
  detail: string; // the missing thing — path, binary, or slug
}

// ---------- helpers ----------

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJSON<T = any>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function run(cmd: string, args: string[]): Promise<string> {
  try {
    // shell:true on Windows so npm .cmd shims (like `claude`) resolve.
    const { stdout, stderr } = await pExecFile(cmd, args, {
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === "win32",
    });
    return stdout + stderr;
  } catch (e: any) {
    return (e?.stdout ?? "") + (e?.stderr ?? "");
  }
}

async function listDir(path: string): Promise<string[]> {
  try {
    const ents = await readdir(path, { withFileTypes: true });
    return ents
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function listMarkdownItems(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const ents = await readdir(dir, { withFileTypes: true });
    for (const e of ents) {
      if (e.isFile() && e.name.endsWith(".md")) {
        out.push(e.name.replace(/\.md$/, ""));
      } else if (e.isDirectory()) {
        try {
          const subs = await readdir(join(dir, e.name), { withFileTypes: true });
          for (const s of subs) {
            if (s.isFile() && s.name.endsWith(".md")) {
              out.push(`${e.name}:${s.name.replace(/\.md$/, "")}`);
            }
          }
        } catch {}
      }
    }
  } catch {}
  return out.sort();
}

const NOW_SEC = () => Date.now() / 1000;
const D7 = 7 * 86400;
const D30 = 30 * 86400;
const D90 = 90 * 86400;

const emptyBuckets = (): UsageBuckets => ({ d7: 0, d30: 0, d90: 0, total: 0 });
function bump(b: UsageBuckets, ts: number, now: number): void {
  const age = now - ts;
  if (age <= D7) b.d7++;
  if (age <= D30) b.d30++;
  if (age <= D90) b.d90++;
  b.total++;
  if (!b.last || ts > b.last) b.last = ts;
}
function mergeBuckets(a: UsageBuckets, b: UsageBuckets): UsageBuckets {
  return {
    d7: a.d7 + b.d7,
    d30: a.d30 + b.d30,
    d90: a.d90 + b.d90,
    total: a.total + b.total,
    last: Math.max(a.last ?? 0, b.last ?? 0) || undefined,
  };
}
function recencyOf(b: UsageBuckets | undefined): Recency {
  if (!b || !b.total) return "none";
  if (b.d7) return "hot";
  if (b.d30) return "warm";
  if (b.d90) return "cool";
  return "stale";
}

// ---------- transcript parsing with mtime cache ----------

interface TranscriptEvent {
  ts: number;
  project: string;
  kind: "skill" | "command" | "subagent" | "mcp";
  name: string;
}

interface CachedFile {
  mtime: number;
  events: TranscriptEvent[];
}

const transcriptCache = new Map<string, CachedFile>();
const folderToCwdCache = new Map<string, string>();

async function resolveCwd(folder: string, projectsDir: string): Promise<string> {
  if (folderToCwdCache.has(folder)) return folderToCwdCache.get(folder)!;
  const dir = join(projectsDir, folder);
  let cwd: string | undefined;
  try {
    const ents = await readdir(dir, { withFileTypes: true });
    for (const e of ents) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      try {
        const txt = await readFile(join(dir, e.name), "utf8");
        const m = txt.match(/"cwd"\s*:\s*"([^"]+)"/);
        if (m) {
          cwd = m[1];
          break;
        }
      } catch {}
    }
  } catch {}
  if (!cwd) cwd = ("/" + folder.replace(/^-/, "")).replace(/-/g, "/");
  folderToCwdCache.set(folder, cwd);
  return cwd;
}

const reTs = /"timestamp"\s*:\s*"([^"]+)"/;
const reCwd = /"cwd"\s*:\s*"([^"]+)"/;
const reSk = /"name"\s*:\s*"Skill"\s*,\s*"input"\s*:\s*\{\s*"skill"\s*:\s*"([^"]+)"/g;
const reCmd = /<command-name>\/?([^<]+)<\/command-name>/g;
const reSub = /"subagent_type"\s*:\s*"([^"]+)"/g;
const reSkRead = /"file_path"\s*:\s*"[^"]*\.claude\/[^"]*skills\/([^/"]+)\/SKILL\.md"/g;
// MCP tool calls surface as tool_use blocks named mcp__<server>__<tool>, always
// followed by "input". The trailing ,"input" guard excludes tool *listings* (bare
// names in allowed-tools arrays). Server key = segment between the first and second
// "__" (servers/tools use single underscores, so non-greedy stops at the right place).
const reMcp = /"name"\s*:\s*"mcp__([A-Za-z0-9_]+?)__[A-Za-z0-9_]+"\s*,\s*"input"/g;

async function parseTranscriptFile(filePath: string, fallback: string): Promise<TranscriptEvent[]> {
  const events: TranscriptEvent[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    const hasSk = line.includes('"name":"Skill"');
    const hasCmd = line.includes("<command-name>");
    const hasSub = line.includes('"subagent_type"');
    const hasRead = line.includes("/SKILL.md") && line.includes(".claude/");
    const hasMcp = line.includes('"mcp__');
    if (!hasSk && !hasCmd && !hasSub && !hasRead && !hasMcp) continue;
    const tsM = line.match(reTs);
    if (!tsM) continue;
    const ts = Date.parse(tsM[1]) / 1000;
    if (!ts) continue;
    const project = line.match(reCwd)?.[1] || fallback;
    if (hasSk) {
      reSk.lastIndex = 0;
      let m;
      while ((m = reSk.exec(line))) events.push({ ts, project, kind: "skill", name: m[1] });
    }
    if (hasCmd) {
      reCmd.lastIndex = 0;
      let m;
      while ((m = reCmd.exec(line))) events.push({ ts, project, kind: "command", name: m[1] });
    }
    if (hasSub) {
      reSub.lastIndex = 0;
      let m;
      while ((m = reSub.exec(line))) events.push({ ts, project, kind: "subagent", name: m[1] });
    }
    if (hasRead) {
      reSkRead.lastIndex = 0;
      let m;
      while ((m = reSkRead.exec(line))) events.push({ ts, project, kind: "skill", name: m[1] });
    }
    if (hasMcp) {
      reMcp.lastIndex = 0;
      let m;
      while ((m = reMcp.exec(line))) events.push({ ts, project, kind: "mcp", name: m[1] });
    }
  }
  return events;
}

type UsageKind = "skill" | "command" | "subagent" | "mcp";
type KindMaps = Record<UsageKind, Map<string, UsageBuckets>>;
const emptyKindMaps = (): KindMaps => ({
  skill: new Map(),
  command: new Map(),
  subagent: new Map(),
  mcp: new Map(),
});

interface UsageMaps {
  global: KindMaps;
  perProject: Map<string, KindMaps>;
}

async function buildUsage(): Promise<UsageMaps> {
  const projectsDir = join(CLAUDE, "projects");
  const usage: UsageMaps = {
    global: emptyKindMaps(),
    perProject: new Map(),
  };
  let topEnts: { name: string; isDirectory(): boolean }[] = [];
  try {
    topEnts = (await readdir(projectsDir, { withFileTypes: true })) as any;
  } catch {
    return usage;
  }

  const now = NOW_SEC();
  const bumpInto = (kind: UsageKind, name: string, project: string, ts: number) => {
    const g = usage.global[kind];
    if (!g.has(name)) g.set(name, emptyBuckets());
    bump(g.get(name)!, ts, now);
    if (!usage.perProject.has(project)) usage.perProject.set(project, emptyKindMaps());
    const pm = usage.perProject.get(project)![kind];
    if (!pm.has(name)) pm.set(name, emptyBuckets());
    bump(pm.get(name)!, ts, now);
  };

  for (const d of topEnts) {
    if (!d.isDirectory()) continue;
    const sub = join(projectsDir, d.name);
    let files: { name: string; isFile(): boolean }[] = [];
    try {
      files = (await readdir(sub, { withFileTypes: true })) as any;
    } catch {
      continue;
    }
    const fallback = await resolveCwd(d.name, projectsDir);
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const filePath = join(sub, f.name);
      let mtime = 0;
      try {
        mtime = (await stat(filePath)).mtimeMs;
      } catch {
        continue;
      }
      let cached = transcriptCache.get(filePath);
      if (!cached || cached.mtime !== mtime) {
        const events = await parseTranscriptFile(filePath, fallback);
        cached = { mtime, events };
        transcriptCache.set(filePath, cached);
      }
      for (const ev of cached.events) bumpInto(ev.kind, ev.name, ev.project, ev.ts);
    }
  }
  return usage;
}

// ---------- marketplaces ----------

interface MarketplaceInfo {
  exists: boolean;
  active: Set<string>;
  archived: Set<string>;
  sourceLabel: string;
}

async function readMarketplaces(): Promise<Map<string, MarketplaceInfo>> {
  const m = new Map<string, MarketplaceInfo>();
  const known = await readJSON<any>(join(CLAUDE, "plugins/known_marketplaces.json"));
  if (!known) return m;
  for (const [name, info] of Object.entries<any>(known)) {
    const loc = info?.installLocation;
    const exists = loc ? await pathExists(loc) : false;
    const active = new Set(loc ? await listDir(join(loc, "plugins")) : []);
    const archived = new Set(loc ? await listDir(join(loc, "_archived")) : []);
    const src = info?.source;
    const sourceLabel = src?.repo
      ? `github:${src.repo}`
      : src?.path
        ? src.path.replace(HOME, "~")
        : "?";
    m.set(name, { exists, active, archived, sourceLabel });
  }
  return m;
}

function pluginStatus(
  pluginName: string,
  marketplace: string,
  installPath: string | undefined,
  marketplaces: Map<string, MarketplaceInfo>,
): { status: "active" | "archived" | "removed" | "orphaned"; note: string } {
  const m = marketplaces.get(marketplace);
  if (!m || !m.exists) return { status: "orphaned", note: "marketplace not registered/installed" };
  const dirName = installPath ? basename(installPath) : pluginName;
  if (m.active.has(dirName) || m.active.has(pluginName))
    return { status: "active", note: m.sourceLabel };
  if (m.archived.has(dirName) || m.archived.has(pluginName))
    return { status: "archived", note: `archived in ${m.sourceLabel}` };
  return { status: "removed", note: `not present in ${m.sourceLabel}` };
}

// ---------- enabled plugins per scope ----------

const enabledPluginsCache = new Map<string, Set<string>>();
async function enabledPluginsAt(scopeKey: string): Promise<Set<string>> {
  if (enabledPluginsCache.has(scopeKey)) return enabledPluginsCache.get(scopeKey)!;
  const set = new Set<string>();
  const files =
    scopeKey === "__user__"
      ? [join(HOME, ".claude/settings.json")]
      : [join(scopeKey, ".claude/settings.json"), join(scopeKey, ".claude/settings.local.json")];
  for (const f of files) {
    const d = await readJSON<any>(f);
    for (const [k, v] of Object.entries(d?.enabledPlugins ?? {})) if (v) set.add(k);
  }
  enabledPluginsCache.set(scopeKey, set);
  return set;
}

// ---------- usage lookup helper ----------

// Reproduce Claude Code's MCP tool-name sanitization: a server reachable as
// mcp__<key>__<tool>. claude.ai remotes carry an implicit "claude.ai " prefix
// (stripped from the stored name); plugin servers are namespaced plugin_<plugin>_<server>.
const sanitizeMcp = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, "_");
function mcpServerKey(name: string, location: Location, pluginName?: string): string {
  if (location === "claude-ai-remote") return sanitizeMcp(`claude.ai ${name}`);
  if (location === "user-plugin" || location === "scoped-plugin")
    return sanitizeMcp(`plugin_${pluginName}_${name}`);
  return sanitizeMcp(name);
}

function lookupUsage(
  name: string,
  kind: Kind,
  pluginName: string | undefined,
  projectPath: string | undefined,
  usage: UsageMaps,
  location?: Location,
): UsageBuckets {
  if (kind === "hook") return emptyBuckets();
  if (kind === "mcp") {
    const key = mcpServerKey(name, location!, pluginName);
    // claude.ai remotes / user-scope servers fire from any cwd → global tally;
    // project-scoped servers are attributed to their project's transcripts.
    const src = projectPath ? usage.perProject.get(projectPath)?.mcp : usage.global.mcp;
    return src?.get(key) ?? emptyBuckets();
  }
  const kindPool: ("skill" | "command" | "subagent")[] =
    kind === "subagent" ? ["subagent"] : ["skill", "command"];
  const keys = pluginName ? [`${pluginName}:${name}`, name] : [name];
  let merged = emptyBuckets();
  for (const k of kindPool) {
    const src = projectPath ? usage.perProject.get(projectPath)?.[k] : usage.global[k];
    if (!src) continue;
    for (const key of keys) {
      const b = src.get(key);
      if (b) merged = mergeBuckets(merged, b);
    }
  }
  return merged;
}

// ---------- MCP scanning ----------

interface RawMcp {
  name: string;
  location: Location;
  pluginId?: string;
  pluginName?: string;
  pluginMarketplace?: string;
  pluginInstallPath?: string;
  pluginScope?: "user" | "project";
  pluginStatus?: "active" | "archived";
  pluginStatusNote?: string;
  projectPath?: string;
  transport?: string;
  url?: string;
}

async function scanUserScopeMcps(): Promise<RawMcp[]> {
  const out: RawMcp[] = [];
  // claude.ai remotes via `claude mcp list`
  const raw = await run("claude", ["mcp", "list"]);
  for (const line of raw.split("\n")) {
    const m = line.match(/^(claude\.ai\s+)?([^:]+):\s*(https?:\/\/\S+)\s*-\s*(.*)$/);
    if (!m) continue;
    out.push({
      name: m[2].trim(),
      location: "claude-ai-remote",
      transport: "remote",
      url: m[3].trim(),
    });
  }
  // ~/.claude.json mcpServers — user scope
  const data = await readJSON<any>(CLAUDE_JSON);
  const servers = data?.mcpServers ?? {};
  for (const [name, cfg] of Object.entries<any>(servers)) {
    out.push({
      name,
      location: "user-mcp",
      transport: cfg?.type ?? (cfg?.command ? "stdio" : cfg?.url ? "http" : "unknown"),
      url: cfg?.url,
    });
  }
  return out;
}

async function scanLocalScopeMcps(): Promise<RawMcp[]> {
  const data = await readJSON<any>(CLAUDE_JSON);
  const projects = data?.projects ?? {};
  const out: RawMcp[] = [];
  for (const [path, p] of Object.entries<any>(projects)) {
    const servers = p?.mcpServers ?? {};
    if (Object.keys(servers).length === 0) continue;
    if (!(await pathExists(path))) continue;
    for (const [name, cfg] of Object.entries<any>(servers)) {
      out.push({
        name,
        location: "local",
        projectPath: path,
        transport: cfg?.type ?? (cfg?.command ? "stdio" : cfg?.url ? "http" : "unknown"),
        url: cfg?.url,
      });
    }
  }
  return out;
}

interface PluginInstall {
  id: string;
  name: string;
  marketplace: string;
  scope: "user" | "project";
  projectPath?: string;
  installPath: string;
  version?: string;
}

async function readInstalledPlugins(): Promise<PluginInstall[]> {
  const out: PluginInstall[] = [];
  const data = await readJSON<any>(join(CLAUDE, "plugins/installed_plugins.json"));
  for (const [id, installs] of Object.entries<any>(data?.plugins ?? {})) {
    const [name, marketplace] = id.split("@");
    for (const inst of installs as any[]) {
      if (!inst?.installPath) continue;
      out.push({
        id,
        name,
        marketplace,
        scope: inst.scope === "user" ? "user" : "project",
        projectPath: inst.projectPath,
        installPath: inst.installPath,
        version: inst.version,
      });
    }
  }
  return out;
}

async function scanProjectAndPluginMcps(installs: PluginInstall[]): Promise<RawMcp[]> {
  const out: RawMcp[] = [];

  // Plugin-shipped MCP config lives at <installPath>/.mcp.json
  // (https://code.claude.com/docs/en/plugins).
  for (const inst of installs) {
    const data = await readJSON<any>(join(inst.installPath, ".mcp.json"));
    const servers = data?.mcpServers ?? {};
    if (Object.keys(servers).length === 0) continue;
    const scopeKey = inst.scope === "user" ? "__user__" : (inst.projectPath ?? "__user__");
    const ep = await enabledPluginsAt(scopeKey);
    if (!ep.has(inst.id)) continue;
    for (const [name, cfg] of Object.entries<any>(servers)) {
      out.push({
        name,
        location: inst.scope === "user" ? "user-plugin" : "scoped-plugin",
        pluginId: inst.id,
        pluginName: inst.name,
        pluginMarketplace: inst.marketplace,
        pluginInstallPath: inst.installPath,
        pluginScope: inst.scope,
        projectPath: inst.scope === "project" ? inst.projectPath : undefined,
        transport: "plugin",
        url: cfg?.url,
      });
    }
  }

  // Project-scope <proj>/.mcp.json for every project Claude Code has opened,
  // taken from the ~/.claude.json projects map.
  const projects = Object.keys((await readJSON<any>(CLAUDE_JSON))?.projects ?? {});
  const installPaths = new Set(installs.map((i) => i.installPath));
  for (const dir of projects) {
    if (installPaths.has(dir)) continue;
    const data = await readJSON<any>(join(dir, ".mcp.json"));
    const servers = data?.mcpServers ?? {};
    for (const [name, cfg] of Object.entries<any>(servers)) {
      out.push({
        name,
        location: "project-mcp",
        projectPath: dir,
        transport: cfg?.type ?? (cfg?.command ? "stdio" : cfg?.url ? "http" : "project"),
        url: cfg?.url,
      });
    }
  }
  return out;
}

// ---------- hooks scanning ----------
// Hooks fire on Claude Code events (PreToolUse, PostToolUse, UserPromptSubmit, …).
// Sources: settings.json `hooks` block at user/project scope and plugin `hooks/hooks.json`.
// Docs: https://code.claude.com/docs/en/hooks (and the "Migrate hooks" section of /en/plugins).

interface RawHook {
  event: string;
  matcher?: string;
  commands: string[];
}

function extractHooks(data: any): RawHook[] {
  const block = data?.hooks;
  if (!block || typeof block !== "object") return [];
  const out: RawHook[] = [];
  for (const [event, entries] of Object.entries(block)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries as any[]) {
      const matcher = typeof e?.matcher === "string" && e.matcher ? e.matcher : undefined;
      const commands = (Array.isArray(e?.hooks) ? e.hooks : [])
        .map((h: any) => h?.command)
        .filter((c: any): c is string => typeof c === "string" && !!c);
      out.push({ event, matcher, commands });
    }
  }
  return out;
}

function nameHook(h: RawHook): string {
  return h.matcher ? `${h.event}:${h.matcher}` : h.event;
}

async function readHooksFromSettings(paths: string[]): Promise<RawHook[]> {
  const out: RawHook[] = [];
  for (const p of paths) {
    const d = await readJSON<any>(p);
    out.push(...extractHooks(d));
  }
  return out;
}

async function readHooksFromPlugin(installPath: string): Promise<RawHook[]> {
  const d = await readJSON<any>(join(installPath, "hooks", "hooks.json"));
  return extractHooks(d);
}

// ---------- declared relations (static body scrape) ----------

// Resolve a skill/command/subagent item back to its source markdown:
//   skill    → <base>/skills/<name>/SKILL.md
//   command  → <base>/commands/<name>.md   (":" namespacing maps to a subdir)
//   subagent → <base>/agents/<name>.md
// base is the global ~/.claude, a plugin install path, or a project's .claude.
function bodyPathFor(it: Item): string | undefined {
  let base: string;
  if (it.location === "global") base = CLAUDE;
  else if (it.location === "user-plugin" || it.location === "scoped-plugin") {
    if (!it.pluginInstallPath) return undefined;
    base = it.pluginInstallPath;
  } else if (it.location === "local") {
    if (!it.projectPath) return undefined;
    base = join(it.projectPath, ".claude");
  } else return undefined;
  if (it.kind === "skill") return join(base, "skills", it.name, "SKILL.md");
  if (it.kind === "command") return join(base, "commands", it.name.replace(/:/g, "/") + ".md");
  if (it.kind === "subagent") return join(base, "agents", it.name.replace(/:/g, "/") + ".md");
  return undefined;
}

// Mentions count only as /slug or backticked `slug` / `/slug`. The known-name
// filter (applied by the caller) is the real precision guard — it drops prose
// noise like `pwd`, `text`, /tmp, and doc URLs, keeping only real item names.
const reRefSlash = /\/([a-z][a-z0-9:_-]*)/gi;
const reRefTick = /`\/?([a-z][a-z0-9:_-]*)`/gi;
function extractRefs(body: string, known: Set<string>, self: string): string[] {
  const found = new Set<string>();
  for (const re of [reRefSlash, reRefTick]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const n = m[1].toLowerCase();
      if (n !== self && known.has(n)) found.add(n);
    }
  }
  return [...found].sort();
}

// ---------- frayed lines (broken-wiring checks) ----------
// Everything here is a stat or PATH lookup on something a body/config declares;
// nothing is executed. Unresolvable tokens (env vars we can't expand, globs,
// relative paths with unknown cwd) are skipped, not flagged — precision over recall.

const tildePath = (p: string): string => (p.startsWith(HOME) ? "~" + p.slice(HOME.length) : p);

// Script-looking path tokens inside a hook command string. Only tokens we can
// resolve to an absolute path are checked: ~/, /abs, $CLAUDE_PROJECT_DIR (when the
// hook is project-scoped), $CLAUDE_PLUGIN_ROOT (when plugin-shipped).
const reScriptTok =
  /(?:^|[\s"'=])((?:~\/|\/|\$\{?CLAUDE_(?:PROJECT_DIR|PLUGIN_ROOT)\}?\/)[^\s"';|&)]*\.(?:sh|bash|py|ts|js|mjs|cjs))/g;

async function missingHookScripts(
  h: RawHook,
  ctx: { projectPath?: string; pluginRoot?: string },
): Promise<string[]> {
  const missing = new Set<string>();
  for (const cmd of h.commands) {
    reScriptTok.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = reScriptTok.exec(cmd))) {
      let p = m[1]
        .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, ctx.projectPath ?? "$")
        .replace(/^\$\{?CLAUDE_PLUGIN_ROOT\}?/, ctx.pluginRoot ?? "$");
      if (p.startsWith("~/")) p = join(HOME, p.slice(2));
      if (p.includes("$") || !p.startsWith("/")) continue; // couldn't resolve → skip
      if (!(await pathExists(p))) missing.add(tildePath(p));
    }
  }
  return [...missing];
}

// Binaries named in frontmatter allowed-tools Bash(cmd:*) entries. Shell builtins
// and anything with a var/glob are skipped.
const SHELL_BUILTINS = new Set([
  "cd",
  "echo",
  "source",
  ".",
  "export",
  "set",
  "exit",
  "true",
  "false",
  "test",
  "[",
  "[[",
  "command",
  "type",
  "eval",
  "kill",
  "wait",
  "trap",
  "read",
  "printf",
  "pwd",
  "alias",
  "time",
  "if",
  "for",
  "while",
]);

const PATH_DIRS = (process.env.PATH ?? "").split(":").filter(Boolean);
const binCache = new Map<string, boolean>();
async function binOnPath(bin: string): Promise<boolean> {
  const hit = binCache.get(bin);
  if (hit !== undefined) return hit;
  let found = false;
  for (const d of PATH_DIRS) {
    if (await pathExists(join(d, bin))) {
      found = true;
      break;
    }
  }
  binCache.set(bin, found);
  return found;
}

const reBashTool = /Bash\(\s*([^)\s:,]+)/g;
function bashBinaries(body: string): string[] {
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const out = new Set<string>();
  reBashTool.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = reBashTool.exec(fm[1]))) {
    const tok = m[1];
    if (/[$*{]/.test(tok) || tok.startsWith("-") || SHELL_BUILTINS.has(tok)) continue;
    out.add(tok);
  }
  return [...out];
}

// @path imports worth checking: reuses importSpecs (code fences already stripped),
// minus placeholders (<SKILL_DIR>), vars, URLs, and npm package names (@scope/pkg
// passes looksLikeImport but is not a file). A checkable spec must be anchored
// (~/, ./, ../, /) or end in a file extension.
function checkableImports(body: string): string[] {
  return importSpecs(body).filter(
    (s) =>
      !/[<>{}$]/.test(s) &&
      !s.includes("://") &&
      (/^(~\/|\.\/|\.\.\/|\/)/.test(s) || /\.[a-z0-9]+$/i.test(s)),
  );
}

// Phantom refs: a backticked, colon-namespaced `/ns:slug` is unambiguously Claude
// Code command syntax — if neither the full name nor the part after the colon
// resolves to anything known, it points at a renamed or removed item. Plain
// `/slug` backticks are NOT scanned: they collide with URL routes (`/about`,
// `/healthz`) too often to judge statically.
const reTickSlash = /`\/([a-z][a-z0-9_-]*:[a-z0-9:_-]+)`/gi;
// Documentation placeholders that explain the namespace syntax itself.
const NOT_PHANTOM = new Set(["namespace:command", "plugin:command", "plugin-name:command"]);

function phantomRefs(body: string, known: Set<string>, self: string): string[] {
  const noFences = body.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
  const out = new Set<string>();
  reTickSlash.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = reTickSlash.exec(noFences))) {
    const n = m[1].toLowerCase();
    if (n === self || known.has(n) || NOT_PHANTOM.has(n)) continue;
    // A namespaced invocation like /df:code-review resolves to the plugin's bare
    // command name ("code-review") — items are inventoried without the prefix.
    const short = n.slice(n.indexOf(":") + 1);
    if (short === self || known.has(short)) continue;
    out.add(n);
  }
  return [...out].sort();
}

// Human place label for a wiring row — where the frayed declaration lives.
function placeLabel(it: Item): string {
  switch (it.location) {
    case "global":
      return "global";
    case "user-plugin":
    case "scoped-plugin":
      return `plugin ${it.pluginName ?? "?"}`;
    case "local":
      return it.projectPath ? tildePath(it.projectPath) : "?";
    default:
      return it.location;
  }
}

// ---------- standing-context scanning ----------
// CLAUDE.md over this many lines gets an adherence warning (per the memory docs).
const CLIFF = 200;
// MEMORY.md is loaded head-first; past either threshold the tail is silently
// dropped, so only the head counts toward what actually loads.
const MEMORY_HEAD_LINES = 200;
const MEMORY_HEAD_BYTES = 25 * 1024;

function lineCount(txt: string): number {
  if (!txt) return 0;
  const n = txt.split("\n").length;
  return txt.endsWith("\n") ? n - 1 : n;
}

// Blank out fenced blocks and inline code spans so an @path inside an example
// (` `@foo` `) is not mistaken for a real import.
function stripCode(txt: string): string {
  return txt
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]*`/g, "");
}

// A rule is path-scoped (on-demand) when its YAML frontmatter carries a `paths:` key.
function hasPathsFrontmatter(txt: string): boolean {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!m && /^\s*paths\s*:/m.test(m[1]);
}

// Skill/command frontmatter can restrict who invokes it (docs "Control who
// invokes a skill"): disable-model-invocation: true → user-only (slash only),
// user-invocable: false → model-only (no slash command). Unset → both.
function invocationFromFrontmatter(txt: string): Item["invocation"] {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return undefined;
  if (/^\s*disable-model-invocation\s*:\s*true\b/m.test(m[1])) return "user-only";
  if (/^\s*user-invocable\s*:\s*false\b/m.test(m[1])) return "model-only";
  return undefined;
}

// Only tokens that look like file paths count as imports — filters handles and
// prose noise from real @path/to/file mentions. Approximate, by design.
function looksLikeImport(s: string): boolean {
  return (
    s.startsWith("~/") ||
    s.startsWith("./") ||
    s.startsWith("../") ||
    s.startsWith("/") ||
    s.includes("/") ||
    /\.(md|markdown|txt)$/i.test(s)
  );
}

function importSpecs(txt: string): string[] {
  const stripped = stripCode(txt);
  const re = /(?:^|\s)@([^\s]+)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const s = m[1].replace(/[.,;:)\]]+$/, "");
    if (looksLikeImport(s)) out.push(s);
  }
  return out;
}

function resolveImport(spec: string, fromFile: string): string {
  if (spec.startsWith("~/")) return join(HOME, spec.slice(2));
  if (spec.startsWith("/")) return spec;
  return join(dirname(fromFile), spec);
}

// Count-and-flag imports: how many @path mentions, one-level resolved line total,
// and whether any resolved file itself imports further (undercount flag).
async function scanImports(
  txt: string,
  fromFile: string,
): Promise<Pick<ContextSource, "importCount" | "importLines" | "importsDeep">> {
  const specs = importSpecs(txt);
  if (!specs.length) return {};
  let importLines = 0;
  let importsDeep = false;
  for (const spec of specs) {
    const body = await readFile(resolveImport(spec, fromFile), "utf8").catch(() => undefined);
    if (body === undefined) continue;
    importLines += lineCount(body);
    if (importSpecs(body).length) importsDeep = true;
  }
  return {
    importCount: specs.length,
    importLines: importLines || undefined,
    importsDeep: importsDeep || undefined,
  };
}

async function walkMd(dir: string): Promise<string[]> {
  const out: string[] = [];
  let ents;
  try {
    ents = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkMd(full)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
  return out.sort();
}

async function claudeMdSource(
  path: string,
  kind: "claude-md" | "claude-local",
  scope: ContextSource["scope"],
): Promise<ContextSource | undefined> {
  const txt = await readFile(path, "utf8").catch(() => undefined);
  if (txt === undefined) return undefined;
  const lines = lineCount(txt);
  return {
    kind,
    scope,
    path,
    lines,
    loadMode: "always",
    overCliff: kind === "claude-md" && lines > CLIFF ? true : undefined,
    ...(await scanImports(txt, path)),
  };
}

async function ruleSources(dir: string, scope: ContextSource["scope"]): Promise<ContextSource[]> {
  const out: ContextSource[] = [];
  for (const path of await walkMd(dir)) {
    const txt = await readFile(path, "utf8").catch(() => undefined);
    if (txt === undefined) continue;
    out.push({
      kind: "rule",
      scope,
      path,
      lines: lineCount(txt),
      loadMode: hasPathsFrontmatter(txt) ? "on-demand" : "always",
      ...(await scanImports(txt, path)),
    });
  }
  return out;
}

async function memorySource(folder: string | undefined): Promise<ContextSource | undefined> {
  if (!folder) return undefined;
  const path = join(CLAUDE, "projects", folder, "memory", "MEMORY.md");
  const txt = await readFile(path, "utf8").catch(() => undefined);
  if (txt === undefined) return undefined;
  const lines = lineCount(txt);
  const overflow = lines > MEMORY_HEAD_LINES || Buffer.byteLength(txt, "utf8") > MEMORY_HEAD_BYTES;
  return {
    kind: "memory-index",
    scope: "project",
    path,
    lines,
    loadMode: overflow ? "overflow-truncated" : "always",
  };
}

function summariseContext(sources: ContextSource[]): ProjectContext {
  return {
    sources,
    alwaysLines: sources.reduce((n, s) => n + loadedContextLines(s), 0),
    onDemandRules: sources.filter((s) => s.loadMode === "on-demand").length,
    hasOverflow: sources.some((s) => s.loadMode === "overflow-truncated"),
    hasOverCliff: sources.some((s) => s.overCliff),
  };
}

// A project's own standing context (marginal, on top of the baseline).
async function scanContext(
  projectPath: string,
  folder: string | undefined,
): Promise<ProjectContext | undefined> {
  const sources: ContextSource[] = [];
  const md1 = await claudeMdSource(join(projectPath, "CLAUDE.md"), "claude-md", "project");
  if (md1) sources.push(md1);
  const md2 = await claudeMdSource(
    join(projectPath, ".claude", "CLAUDE.md"),
    "claude-md",
    "project",
  );
  if (md2) sources.push(md2);
  const local = await claudeMdSource(join(projectPath, "CLAUDE.local.md"), "claude-local", "local");
  if (local) sources.push(local);
  sources.push(...(await ruleSources(join(projectPath, ".claude", "rules"), "project")));
  const mem = await memorySource(folder);
  if (mem) sources.push(mem);
  return sources.length ? summariseContext(sources) : undefined;
}

// Global standing context loaded in every project, scanned once.
async function scanBaseline(): Promise<ContextSource[]> {
  const out: ContextSource[] = [];
  const userMd = await claudeMdSource(join(CLAUDE, "CLAUDE.md"), "claude-md", "user");
  if (userMd) out.push(userMd);
  out.push(...(await ruleSources(join(CLAUDE, "rules"), "user")));
  const managed = await claudeMdSource("/etc/claude-code/CLAUDE.md", "claude-md", "managed");
  if (managed) out.push(managed);
  return out;
}

// ---------- main collect ----------

function dedupeBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Identity of one plugin install: same version installed into two projects (or
// user + project) are distinct installs with distinct usage and distinct homes.
const installKey = (installPath: string, scope: "user" | "project", projectPath?: string): string =>
  `${installPath}|${scope}|${projectPath ?? ""}`;

export async function collect(): Promise<CollectResult> {
  enabledPluginsCache.clear();
  folderToCwdCache.clear();
  binCache.clear();

  const wiring: WiringIssue[] = [];

  const usage = await buildUsage();
  const marketplaces = await readMarketplaces();
  // Claude Code can record the same install twice (scope "local" and "project"
  // for one dir); they describe one plugin in one place, so keep the first.
  const installs = dedupeBy(await readInstalledPlugins(), (i) =>
    installKey(i.installPath, i.scope, i.projectPath),
  );

  // Resolve plugin status for each install; drop orphaned/removed — they're gone.
  // Keyed per install, not per installPath: the same plugin version can be
  // installed into several scopes/projects at once (Claude Code records one entry
  // per scope, incl. both "local" and "project" for the same dir). Collapsing them
  // onto the install path merged their items into one bucket — duplicate names,
  // usage resolved against the wrong project, and every project but the last one
  // losing the plugin entirely.
  const installInfo: Map<string, PluginInfo> = new Map();
  for (const inst of installs) {
    const st = pluginStatus(inst.name, inst.marketplace, inst.installPath, marketplaces);
    if (st.status === "orphaned" || st.status === "removed") continue;
    installInfo.set(installKey(inst.installPath, inst.scope, inst.projectPath), {
      id: inst.id,
      name: inst.name,
      marketplace: inst.marketplace,
      scope: inst.scope,
      projectPath: inst.projectPath,
      installPath: inst.installPath,
      version: inst.version,
      status: st.status,
      statusNote: st.note,
      items: [],
    });
  }

  // Helper to make an Item from a raw record + lookup usage
  const makeItem = (rec: {
    kind: Kind;
    name: string;
    location: Location;
    pluginName?: string;
    projectPath?: string;
    pluginId?: string;
    pluginMarketplace?: string;
    pluginInstallPath?: string;
    pluginScope?: "user" | "project";
    pluginStatus?: any;
    pluginStatusNote?: string;
    transport?: string;
    url?: string;
  }): Item => {
    const usageBuckets = lookupUsage(
      rec.name,
      rec.kind,
      rec.pluginName,
      rec.projectPath,
      usage,
      rec.location,
    );
    const anywhere = rec.projectPath
      ? lookupUsage(rec.name, rec.kind, rec.pluginName, undefined, usage, rec.location)
      : usageBuckets;
    return {
      kind: rec.kind,
      name: rec.name,
      location: rec.location,
      pluginId: rec.pluginId,
      pluginName: rec.pluginName,
      pluginMarketplace: rec.pluginMarketplace,
      pluginInstallPath: rec.pluginInstallPath,
      pluginScope: rec.pluginScope,
      pluginStatus: rec.pluginStatus,
      pluginStatusNote: rec.pluginStatusNote,
      projectPath: rec.projectPath,
      transport: rec.transport,
      url: rec.url,
      usage: usageBuckets,
      usageAnywhere: anywhere,
      recency: recencyOf(usageBuckets),
      contested: false,
    };
  };

  // Global items (skills/commands/agents under ~/.claude/, hooks from ~/.claude/settings.json)
  const globalItems: Item[] = [];
  for (const name of await listDir(join(CLAUDE, "skills")))
    globalItems.push(makeItem({ kind: "skill", name, location: "global" }));
  for (const name of await listMarkdownItems(join(CLAUDE, "commands")))
    globalItems.push(makeItem({ kind: "command", name, location: "global" }));
  for (const name of await listMarkdownItems(join(CLAUDE, "agents")))
    globalItems.push(makeItem({ kind: "subagent", name, location: "global" }));
  for (const h of await readHooksFromSettings([join(CLAUDE, "settings.json")])) {
    globalItems.push(makeItem({ kind: "hook", name: nameHook(h), location: "global" }));
    for (const p of await missingHookScripts(h, {}))
      wiring.push({
        issue: "hook-script",
        from: nameHook(h),
        fromKind: "hook",
        where: "global",
        detail: p,
      });
  }

  // Plugin items (skills/commands/agents) for each install
  for (const inst of installs) {
    const info = installInfo.get(installKey(inst.installPath, inst.scope, inst.projectPath));
    if (!info) continue;
    const loc: Location = inst.scope === "user" ? "user-plugin" : "scoped-plugin";
    const sk = await listDir(join(inst.installPath, "skills"));
    const cm = await listMarkdownItems(join(inst.installPath, "commands"));
    const ag = await listMarkdownItems(join(inst.installPath, "agents"));
    const common = {
      pluginId: inst.id,
      pluginName: inst.name,
      pluginMarketplace: inst.marketplace,
      pluginInstallPath: inst.installPath,
      pluginScope: inst.scope,
      pluginStatus: info.status,
      pluginStatusNote: info.statusNote,
      projectPath: inst.scope === "project" ? inst.projectPath : undefined,
    };
    for (const name of sk)
      info.items.push(makeItem({ kind: "skill", name, location: loc, ...common }));
    for (const name of cm)
      info.items.push(makeItem({ kind: "command", name, location: loc, ...common }));
    for (const name of ag)
      info.items.push(makeItem({ kind: "subagent", name, location: loc, ...common }));
    for (const h of await readHooksFromPlugin(inst.installPath)) {
      info.items.push(makeItem({ kind: "hook", name: nameHook(h), location: loc, ...common }));
      for (const p of await missingHookScripts(h, {
        pluginRoot: inst.installPath,
        projectPath: inst.projectPath,
      }))
        wiring.push({
          issue: "hook-script",
          from: nameHook(h),
          fromKind: "hook",
          where: `plugin ${inst.name}`,
          detail: p,
        });
    }
  }

  // MCPs
  const userMcpsRaw = await scanUserScopeMcps();
  const localMcpsRaw = await scanLocalScopeMcps();
  const projAndPluginMcpsRaw = await scanProjectAndPluginMcps(installs);

  const userMcps: Item[] = userMcpsRaw.map((r) => makeItem({ kind: "mcp", ...r }));

  // Attach plugin MCPs into plugin items
  const projectMcpsByPath = new Map<string, Item[]>();
  for (const r of [...localMcpsRaw, ...projAndPluginMcpsRaw]) {
    if (r.location === "user-plugin") {
      const info = installInfo.get(installKey(r.pluginInstallPath!, "user"));
      if (info) info.items.push(makeItem({ kind: "mcp", ...r }));
      continue;
    }
    if (r.location === "scoped-plugin") {
      const info = installInfo.get(installKey(r.pluginInstallPath!, "project", r.projectPath));
      if (info) info.items.push(makeItem({ kind: "mcp", ...r }));
      continue;
    }
    if (!r.projectPath) continue;
    if (!projectMcpsByPath.has(r.projectPath)) projectMcpsByPath.set(r.projectPath, []);
    projectMcpsByPath.get(r.projectPath)!.push(makeItem({ kind: "mcp", ...r }));
  }

  // Candidate projects
  const fromHistory = new Set<string>(folderToCwdCache.values());
  const candidates = new Set<string>(fromHistory);
  for (const inst of installs) {
    if (!installInfo.has(installKey(inst.installPath, inst.scope, inst.projectPath))) continue;
    if (inst.scope === "project" && inst.projectPath) candidates.add(inst.projectPath);
  }
  for (const p of projectMcpsByPath.keys()) candidates.add(p);

  // Per-project local items
  const localItemsByPath = new Map<string, Item[]>();
  for (const p of candidates) {
    const claudeDir = join(p, ".claude");
    // The home dir can surface as a project (transcript cwd), but its .claude IS
    // the global ~/.claude — scanning it re-emits every global item as "local",
    // falsely contesting all of them. Skip it; global already covers this dir.
    if (claudeDir === CLAUDE) continue;
    if (!(await pathExists(claudeDir))) continue;
    const items: Item[] = [];
    for (const name of await listDir(join(claudeDir, "skills")))
      items.push(makeItem({ kind: "skill", name, location: "local", projectPath: p }));
    for (const name of await listMarkdownItems(join(claudeDir, "commands")))
      items.push(makeItem({ kind: "command", name, location: "local", projectPath: p }));
    for (const name of await listMarkdownItems(join(claudeDir, "agents")))
      items.push(makeItem({ kind: "subagent", name, location: "local", projectPath: p }));
    for (const h of await readHooksFromSettings([
      join(claudeDir, "settings.json"),
      join(claudeDir, "settings.local.json"),
    ])) {
      items.push(makeItem({ kind: "hook", name: nameHook(h), location: "local", projectPath: p }));
      for (const miss of await missingHookScripts(h, { projectPath: p }))
        wiring.push({
          issue: "hook-script",
          from: nameHook(h),
          fromKind: "hook",
          where: tildePath(p),
          detail: miss,
        });
    }
    if (items.length) localItemsByPath.set(p, items);
  }

  // Build ProjectInfo, filter missing, mark dormant
  const projects: ProjectInfo[] = [];
  let droppedProjects = 0;
  let dormantProjects = 0;
  const scopedByPath = new Map<string, PluginInfo[]>();
  for (const info of installInfo.values()) {
    if (info.scope !== "project" || !info.projectPath) continue;
    if (!scopedByPath.has(info.projectPath)) scopedByPath.set(info.projectPath, []);
    scopedByPath.get(info.projectPath)!.push(info);
  }

  // Reverse the folder→cwd map so each project can find its auto-memory slug.
  const cwdToFolder = new Map<string, string>();
  for (const [folder, cwd] of folderToCwdCache) cwdToFolder.set(cwd, folder);

  for (const p of candidates) {
    if (!(await pathExists(p))) {
      droppedProjects++;
      continue;
    }
    const localItems = localItemsByPath.get(p) ?? [];
    const scopedPlugins = scopedByPath.get(p) ?? [];
    const projectMcps = projectMcpsByPath.get(p) ?? [];
    let activity = emptyBuckets();
    const pm = usage.perProject.get(p);
    if (pm)
      for (const k of ["skill", "command", "subagent", "mcp"] as const)
        for (const b of pm[k].values()) activity = mergeBuckets(activity, b);
    const context = await scanContext(p, cwdToFolder.get(p));
    // Standing context is its own reason to exist: a project that only loads a
    // CLAUDE.md is not dormant, even with zero activity or servitors.
    const dormant =
      activity.total === 0 &&
      localItems.length === 0 &&
      scopedPlugins.length === 0 &&
      projectMcps.length === 0 &&
      !context;
    if (dormant) dormantProjects++;
    projects.push({
      path: p,
      inHistory: fromHistory.has(p),
      localItems,
      scopedPlugins,
      projectMcps,
      activity,
      dormant,
      context,
    });
  }

  // Group projects by parent dir (region)
  const home = (s: string) => (s.startsWith(HOME) ? "~" + s.slice(HOME.length) : s);
  const groups = new Map<string, ProjectInfo[]>();
  for (const proj of projects) {
    if (proj.dormant) continue;
    const label = home(dirname(proj.path));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(proj);
  }

  const regions = [...groups.entries()].map(([label, projects]) => {
    let activity = emptyBuckets();
    for (const p of projects) activity = mergeBuckets(activity, p.activity);
    projects.sort(
      (a, b) =>
        b.activity.total - a.activity.total ||
        (b.activity.last ?? 0) - (a.activity.last ?? 0) ||
        a.path.localeCompare(b.path),
    );
    return { label, projects, activity };
  });
  regions.sort((a, b) => b.activity.total - a.activity.total || a.label.localeCompare(b.label));

  // Mark contested names. An invocation token resolves into:
  //   skill/command pool — name (lowercased)
  //   subagent pool      — name (lowercased)
  //   mcp pool           — name (lowercased)
  // Contested = same lowercased name appears in 2+ distinct origins within its pool.
  function originKey(item: Item): string {
    return [item.location, item.pluginId ?? "", item.projectPath ?? ""].join("|");
  }
  // Human-readable "kind · place" so a contested chip can explain the clash.
  const tilde = (p?: string) => (p ? p.replace(HOME, "~") : "?");
  function originLabel(it: Item): string {
    let where: string;
    switch (it.location) {
      case "global":
        where = "global";
        break;
      case "user-plugin":
        where = `plugin ${it.pluginName ?? "?"}`;
        break;
      case "scoped-plugin":
        where = `plugin ${it.pluginName ?? "?"} @ ${tilde(it.projectPath)}`;
        break;
      case "local":
        where = tilde(it.projectPath);
        break;
      case "user-mcp":
        where = "user (~/.claude.json)";
        break;
      case "project-mcp":
        where = tilde(it.projectPath);
        break;
      case "claude-ai-remote":
        where = "claude.ai";
        break;
      default:
        where = it.location;
    }
    return `${it.kind} · ${where}`;
  }
  const allItems: Item[] = [
    ...globalItems,
    ...userMcps,
    ...[...installInfo.values()].flatMap((p) => p.items),
    ...projects.flatMap((p) => [...p.localItems, ...p.projectMcps]),
  ];
  const buckets = new Map<string, { items: Item[]; origins: Set<string> }>();
  for (const it of allItems) {
    if (it.kind === "hook") continue;
    const pool = it.kind === "subagent" ? "subagent" : it.kind === "mcp" ? "mcp" : "skill+command";
    const key = `${pool}::${it.name.toLowerCase()}`;
    if (!buckets.has(key)) buckets.set(key, { items: [], origins: new Set() });
    const b = buckets.get(key)!;
    b.items.push(it);
    b.origins.add(originKey(it));
  }
  let contestedNames = 0;
  for (const b of buckets.values()) {
    if (b.origins.size > 1) {
      contestedNames++;
      const all = [...new Set(b.items.map(originLabel))];
      for (const it of b.items) {
        it.contested = true;
        const self = originLabel(it);
        it.contestedWith = all.filter((l) => l !== self);
      }
    }
  }

  // Declared relations: scrape each skill/command/subagent body for /slug and
  // `slug` mentions that resolve to a known item name. Targets that resolve to
  // a contested name are flagged ambiguous (the edge can't pick one origin).
  const linkable = allItems.filter(
    (it) => it.kind === "skill" || it.kind === "command" || it.kind === "subagent",
  );
  // Resolution respects scope: an item only "sees" targets that are actually
  // available where it runs. Global and user-plugin items are ambient (visible
  // everywhere); local and scoped-plugin items are visible only within their own
  // project. Without this a local /release in one repo wrongly links every other
  // repo's mention of `release`.
  const ambientNames = new Set<string>();
  const localNamesByProject = new Map<string, Set<string>>();
  for (const it of linkable) {
    const n = it.name.toLowerCase();
    if (it.location === "global" || it.location === "user-plugin") ambientNames.add(n);
    else if ((it.location === "local" || it.location === "scoped-plugin") && it.projectPath) {
      if (!localNamesByProject.has(it.projectPath))
        localNamesByProject.set(it.projectPath, new Set());
      localNamesByProject.get(it.projectPath)!.add(n);
    }
  }
  function visibleNames(it: Item): Set<string> {
    const local = it.projectPath ? localNamesByProject.get(it.projectPath) : undefined;
    return local ? new Set([...ambientNames, ...local]) : ambientNames;
  }
  const ambiguousNames = new Set(
    linkable.filter((it) => it.contested).map((it) => it.name.toLowerCase()),
  );
  // A target name's kind. When a name resolves to both a skill and a command it is
  // already contested (ambiguous) — pick one kind for colour, the "?" marks the doubt.
  const nameKind = new Map<string, Kind>();
  for (const it of linkable)
    if (!nameKind.has(it.name.toLowerCase())) nameKind.set(it.name.toLowerCase(), it.kind);
  // Phantom detection checks against every known invokable name anywhere (not
  // just scope-visible ones) — a real name in another project is out of scope,
  // not frayed.
  const allKnownNames = new Set(
    allItems.filter((it) => it.kind !== "hook").map((it) => it.name.toLowerCase()),
  );
  const relations: Relation[] = [];
  for (const it of linkable) {
    const path = bodyPathFor(it);
    if (!path) continue;
    const body = await readFile(path, "utf8").catch(() => "");
    if (!body) continue;
    it.invocation = invocationFromFrontmatter(body);

    // Frayed-line checks on the same body read
    for (const bin of bashBinaries(body)) {
      if (bin.includes("/")) {
        const p = bin.startsWith("~/") ? join(HOME, bin.slice(2)) : bin;
        if (p.startsWith("/") && !(await pathExists(p)))
          wiring.push({
            issue: "binary",
            from: it.name,
            fromKind: it.kind,
            where: placeLabel(it),
            detail: bin,
          });
      } else if (!(await binOnPath(bin))) {
        wiring.push({
          issue: "binary",
          from: it.name,
          fromKind: it.kind,
          where: placeLabel(it),
          detail: bin,
        });
      }
    }
    for (const spec of checkableImports(body)) {
      if (!(await pathExists(resolveImport(spec, path))))
        wiring.push({
          issue: "import",
          from: it.name,
          fromKind: it.kind,
          where: placeLabel(it),
          detail: "@" + spec,
        });
    }
    for (const slug of phantomRefs(body, allKnownNames, it.name.toLowerCase()))
      wiring.push({
        issue: "phantom",
        from: it.name,
        fromKind: it.kind,
        where: placeLabel(it),
        detail: "/" + slug,
      });

    const refs = extractRefs(body, visibleNames(it), it.name.toLowerCase());
    if (!refs.length) continue;
    relations.push({
      from: it.name,
      fromKind: it.kind,
      fromLocation: it.location,
      refs: refs.map((name) => ({
        name,
        kind: nameKind.get(name) ?? "skill",
        ambiguous: ambiguousNames.has(name),
      })),
    });
  }
  relations.sort(
    (a, b) => a.from.localeCompare(b.from) || a.fromLocation.localeCompare(b.fromLocation),
  );

  const ISSUE_ORDER: Record<WiringIssue["issue"], number> = {
    "hook-script": 0,
    binary: 1,
    import: 2,
    phantom: 3,
  };
  wiring.sort(
    (a, b) =>
      ISSUE_ORDER[a.issue] - ISSUE_ORDER[b.issue] ||
      a.from.localeCompare(b.from) ||
      a.detail.localeCompare(b.detail),
  );

  // Annotate items (by name) with their outgoing/incoming refs so each chip can
  // show it participates in the graph. allItems holds the live Item objects, so
  // this also reaches globalItems / plugin / project copies.
  const outByName = new Map<string, Set<string>>();
  const inByName = new Map<string, Set<string>>();
  for (const rel of relations) {
    const from = rel.from.toLowerCase();
    if (!outByName.has(from)) outByName.set(from, new Set());
    for (const ref of rel.refs) {
      outByName.get(from)!.add(ref.name);
      if (!inByName.has(ref.name)) inByName.set(ref.name, new Set());
      inByName.get(ref.name)!.add(from);
    }
  }
  for (const it of linkable) {
    const key = it.name.toLowerCase();
    const out = outByName.get(key);
    const inn = inByName.get(key);
    if (out?.size) it.refsOut = [...out].sort();
    if (inn?.size) it.refsIn = [...inn].sort();
  }

  // Tally counts: unique items per kind across all locations
  const uniqueByKind: Record<Kind, Set<string>> = {
    mcp: new Set(),
    skill: new Set(),
    command: new Set(),
    subagent: new Set(),
    hook: new Set(),
  };
  for (const it of allItems) uniqueByKind[it.kind].add(it.name.toLowerCase());

  let inv7 = 0,
    inv30 = 0;
  for (const m of [
    usage.global.skill,
    usage.global.command,
    usage.global.subagent,
    usage.global.mcp,
  ]) {
    for (const b of m.values()) {
      inv7 += b.d7;
      inv30 += b.d30;
    }
  }

  const userPlugins = [...installInfo.values()]
    .filter((p) => p.scope === "user")
    .sort((a, b) => a.name.localeCompare(b.name));

  const baseline = await scanBaseline();

  return {
    globalItems,
    userPlugins,
    userMcps,
    regions,
    baseline,
    droppedProjects,
    dormantProjects,
    contestedNames,
    tally: {
      counts: {
        mcp: uniqueByKind.mcp.size,
        skill: uniqueByKind.skill.size,
        command: uniqueByKind.command.size,
        subagent: uniqueByKind.subagent.size,
        hook: uniqueByKind.hook.size,
      },
      invocations7d: inv7,
      invocations30d: inv30,
      contested: contestedNames,
      dormant: dormantProjects,
    },
    relations,
    wiring,
    generatedAt: Date.now(),
  };
}
