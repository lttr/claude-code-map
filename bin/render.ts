import { homedir } from "node:os";
import type { CollectResult, Item, Kind, PluginInfo, ProjectInfo } from "./collect.ts";

const HOME = homedir();
const home = (s: string) => (s.startsWith(HOME) ? "~" + s.slice(HOME.length) : s);

const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const KIND_LABEL: Record<Kind, string> = { mcp: "MCPs", skill: "skills", command: "commands", subagent: "subagents" };
const KIND_SINGULAR: Record<Kind, string> = { mcp: "MCP", skill: "skill", command: "command", subagent: "subagent" };
const KIND_HUE: Record<Kind, string> = {
  skill: "var(--hue-skill)",
  command: "var(--hue-command)",
  subagent: "var(--hue-subagent)",
  mcp: "var(--hue-mcp)",
};

function chip(item: Item): string {
  const cls = [`chip`, `k-${item.kind}`, `r-${item.recency}`];
  if (item.contested) cls.push("contested");
  const u = item.usage;
  const lastTxt = u.last ? new Date(u.last * 1000).toISOString().slice(0, 10) : "never";
  const title = item.kind === "mcp"
    ? `${item.name} — ${item.transport ?? "?"}${item.url ? ` (${item.url})` : ""}${item.projectPath ? ` @ ${home(item.projectPath)}` : ""}`
    : `${item.name}\n7d: ${u.d7}  30d: ${u.d30}  90d: ${u.d90}\ntotal: ${u.total}  last: ${lastTxt}`;
  const ext = item.kind === "mcp" && item.transport ? `<span class="ext">${esc(item.transport)}</span>` : "";
  return `<span class="${cls.join(" ")}" title="${esc(title)}">${esc(item.name)}${ext}</span>`;
}

function chipsOf(items: Item[]): string {
  if (!items.length) return `<div class="muted">— none</div>`;
  const sorted = [...items].sort((a, b) => {
    if (b.usage.total !== a.usage.total) return b.usage.total - a.usage.total;
    if ((b.usage.last ?? 0) !== (a.usage.last ?? 0)) return (b.usage.last ?? 0) - (a.usage.last ?? 0);
    return a.name.localeCompare(b.name);
  });
  return `<div class="chips">${sorted.map(chip).join("")}</div>`;
}

function kindSection(label: string, items: Item[], kind: Kind): string {
  if (!items.length) return "";
  return `<div class="sublabel">${esc(label)} <span class="ct">· ${items.length}</span></div>${chipsOf(items)}`;
}

function pluginBlock(p: PluginInfo): string {
  const skills = p.items.filter((i) => i.kind === "skill");
  const commands = p.items.filter((i) => i.kind === "command");
  const subagents = p.items.filter((i) => i.kind === "subagent");
  const mcps = p.items.filter((i) => i.kind === "mcp");
  const empty = !p.items.length;
  return `
  <div class="plug">
    <div class="plug-head">
      <span class="plug-name">${esc(p.name)}</span>
      <span class="plug-status s-${p.status}" title="${esc(p.statusNote)}">${p.status}</span>
      <span class="plug-meta">@ ${esc(p.marketplace)}${p.version ? " · v" + esc(p.version) : ""}</span>
    </div>
    ${kindSection("skills", skills, "skill")}
    ${kindSection("commands", commands, "command")}
    ${kindSection("subagents", subagents, "subagent")}
    ${kindSection("MCPs", mcps, "mcp")}
    ${empty ? `<div class="muted">— no items</div>` : ""}
  </div>`;
}

function tallyRow(rowClass: string, cells: { num: number | string; lbl: string }[]): string {
  return `<div class="tally ${rowClass}">${cells.map((c) => `<div><div class="num">${esc(c.num)}</div><div class="lbl">${esc(c.lbl)}</div></div>`).join("")}</div>`;
}

function compassPlate(): string {
  // Four-point rose, one symbol per kind; three nested location rings.
  return `
  <div class="compass-wrap">
    <svg class="compass-svg" viewBox="-110 -110 220 220" xmlns="http://www.w3.org/2000/svg">
      <circle r="100" fill="none" stroke="var(--rule)" stroke-opacity=".6"/>
      <circle r="74"  fill="none" stroke="var(--rule)" stroke-opacity=".45"/>
      <circle r="48"  fill="none" stroke="var(--rule)" stroke-opacity=".3"/>
      <circle r="22"  fill="none" stroke="var(--rule)" stroke-opacity=".25"/>
      <g stroke="var(--rule)" stroke-opacity=".5">
        <line x1="0" y1="-100" x2="0" y2="100"/>
        <line x1="-100" y1="0" x2="100" y2="0"/>
        <line x1="-70" y1="-70" x2="70" y2="70" stroke-opacity=".3"/>
        <line x1="-70" y1="70"  x2="70" y2="-70" stroke-opacity=".3"/>
      </g>
      <g font-family="IM Fell English, serif" font-size="18" text-anchor="middle">
        <text y="-86" fill="${KIND_HUE.skill}">✶</text>
        <text x="86" y="6" fill="${KIND_HUE.command}">✦</text>
        <text y="96" fill="${KIND_HUE.subagent}">❉</text>
        <text x="-86" y="6" fill="${KIND_HUE.mcp}">⚓</text>
      </g>
      <g font-family="IM Fell English SC, serif" font-size="9" letter-spacing="2" fill="var(--ink-faint)" text-anchor="middle">
        <text y="-72">N</text><text x="72" y="3">E</text><text y="80">S</text><text x="-72" y="3">W</text>
      </g>
      <circle r="3" fill="var(--ink)"/>
    </svg>
    <div class="compass-legend">
      <h4>Kinds</h4>
      <div class="leg-row"><span class="swatch" style="background:${KIND_HUE.skill}"></span>skill — iron-gall</div>
      <div class="leg-row"><span class="swatch" style="background:${KIND_HUE.command}"></span>command — madder</div>
      <div class="leg-row"><span class="swatch" style="background:${KIND_HUE.subagent}"></span>subagent — verdigris</div>
      <div class="leg-row"><span class="swatch" style="background:${KIND_HUE.mcp}"></span>MCP — sepia</div>
      <h4>Ink density · recency</h4>
      <div class="leg-row"><span class="chip k-skill r-hot">hot</span> ≤ 7 days</div>
      <div class="leg-row"><span class="chip k-skill r-warm">warm</span> ≤ 30 days</div>
      <div class="leg-row"><span class="chip k-skill r-cool">cool</span> ≤ 90 days</div>
      <div class="leg-row"><span class="chip k-skill r-stale">stale</span> older</div>
      <div class="leg-row"><span class="chip k-skill r-none">none</span> never</div>
    </div>
  </div>`;
}

function gazetteer(result: CollectResult): string {
  const global = result.globalItems;
  const gs = global.filter((i) => i.kind === "skill");
  const gc = global.filter((i) => i.kind === "command");
  const ga = global.filter((i) => i.kind === "subagent");
  return `
  <section class="plate">
    <h2 class="plate-title">Global &amp; User Inventory <span class="sub">· Gazetteer</span></h2>
    <p class="plate-note">What rides with every project: ~/.claude/ contents, user-scope plugins, and user-scope MCPs.</p>
    <div class="gaz-grid">
      <div class="gaz-col">
        <h3>Global <span class="count">${global.length} item${global.length === 1 ? "" : "s"}</span></h3>
        <p class="region-note">~/.claude/{skills,commands,agents} — present in every bay.</p>
        ${kindSection("skills", gs, "skill")}
        ${kindSection("commands", gc, "command")}
        ${kindSection("subagents", ga, "subagent")}
      </div>
      <div class="gaz-col">
        <h3>User Plugins <span class="count">${result.userPlugins.length} plugin${result.userPlugins.length === 1 ? "" : "s"}</span></h3>
        <p class="region-note">Installed under ~/.claude/plugins/ at user scope.</p>
        ${result.userPlugins.length ? result.userPlugins.map(pluginBlock).join("") : `<div class="muted">— no user plugins</div>`}
      </div>
      <div class="gaz-col">
        <h3>User MCPs <span class="count">${result.userMcps.length} server${result.userMcps.length === 1 ? "" : "s"}</span></h3>
        <p class="region-note">claude.ai remotes and ~/.claude.json mcpServers — user scope.</p>
        ${chipsOf(result.userMcps)}
      </div>
    </div>
  </section>`;
}

function projectCard(proj: ProjectInfo): string {
  const local = proj.localItems;
  const localSk = local.filter((i) => i.kind === "skill");
  const localCm = local.filter((i) => i.kind === "command");
  const localAg = local.filter((i) => i.kind === "subagent");
  const a = proj.activity;
  const lastTxt = a.last ? new Date(a.last * 1000).toISOString().slice(0, 10) : "—";
  const summary = a.total ? `${a.total} invocations · last ${lastTxt}` : "no recorded usage";
  const empty = !local.length && !proj.scopedPlugins.length && !proj.projectMcps.length;
  return `
  <div class="proj-card ${empty ? "empty" : ""}">
    <div class="proj-head">
      <span class="proj-path">${esc(home(proj.path))}</span>
      <span class="proj-activity" title="7d:${a.d7} 30d:${a.d30} 90d:${a.d90} total:${a.total}">${esc(summary)}</span>
    </div>
    ${kindSection("local skills", localSk, "skill")}
    ${kindSection("local commands", localCm, "command")}
    ${kindSection("local subagents", localAg, "subagent")}
    ${proj.projectMcps.length ? kindSection("project MCPs", proj.projectMcps, "mcp") : ""}
    ${proj.scopedPlugins.length ? `<div class="sublabel">scoped plugins <span class="ct">· ${proj.scopedPlugins.length}</span></div>${proj.scopedPlugins.map(pluginBlock).join("")}` : ""}
    ${empty ? `<div class="muted">global &amp; user-scope only</div>` : ""}
  </div>`;
}

function regionsBlock(result: CollectResult): string {
  if (!result.regions.length) return `<section class="plate"><h2 class="plate-title">Regions</h2><p class="muted">— no active projects found.</p></section>`;
  return result.regions.map((r) => `
    <section class="region">
      <h2>${esc(r.label)} <span class="sub">${r.projects.length} project${r.projects.length === 1 ? "" : "s"} · ${r.activity.total} invocations</span></h2>
      <div class="project-list">${r.projects.map(projectCard).join("")}</div>
    </section>`).join("");
}

export function renderAtlas(result: CollectResult): string {
  const t = result.tally;
  const tallyA = tallyRow("tally-counts", [
    { num: t.counts.mcp,      lbl: "MCPs" },
    { num: t.counts.skill,    lbl: "Skills" },
    { num: t.counts.command,  lbl: "Commands" },
    { num: t.counts.subagent, lbl: "Subagents" },
  ]);
  const tallyB = tallyRow("tally-stats", [
    { num: t.invocations7d,  lbl: "Invocations · 7d" },
    { num: t.invocations30d, lbl: "Invocations · 30d" },
    { num: t.contested,      lbl: "Contested names" },
    { num: t.dormant,        lbl: "Dormant projects" },
  ]);
  return `
${tallyA}
${tallyB}
${compassPlate()}
${gazetteer(result)}
<section class="plate">
  <h2 class="plate-title">Regions <span class="sub">· ${result.regions.length} province${result.regions.length === 1 ? "" : "s"}</span></h2>
  <p class="plate-note">Projects grouped by parent directory, sorted by aggregate activity. ${result.droppedProjects} missing dir${result.droppedProjects === 1 ? "" : "s"} dropped; ${result.dormantProjects} dormant project${result.dormantProjects === 1 ? "" : "s"} hidden.</p>
</section>
${regionsBlock(result)}
`;
}

export function renderFullPage(shellHtml: string, css: string, atlasFragment: string): string {
  // For --out: inline CSS and inline atlas fragment so the file is self-contained.
  let out = shellHtml.replace(
    /<link rel="stylesheet" href="\/atlas\.css">/,
    `<style>${css}</style>`,
  );
  out = out.replace(
    /<div id="atlas" class="atlas atlas-loading">[\s\S]*?<\/div>\s*(?=<footer)/,
    `<div id="atlas" class="atlas">${atlasFragment}</div>\n  `,
  );
  // Drop the runtime fetch script — atlas is already inlined.
  out = out.replace(/<script>\s*\(function \(\) \{[\s\S]*?\}\)\(\);[\s\S]*?<\/script>/, (m) => {
    // Keep only the date-stamp portion of the inline script.
    return `<script>
  (function () {
    var fmt = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" });
    var now = new Date();
    var stamp = document.getElementById("date-stamp");
    if (stamp) stamp.textContent = "the " + fmt.format(now);
    var col = document.getElementById("colophon-date");
    if (col) col.textContent = fmt.format(now);
  })();
</script>`;
  });
  return out;
}
