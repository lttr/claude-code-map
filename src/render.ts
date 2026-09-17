import { homedir } from "node:os";
import type {
  CollectResult,
  ContextKind,
  ContextSource,
  Item,
  Kind,
  PluginInfo,
  ProjectContext,
  ProjectInfo,
  WiringIssue,
} from "./collect.ts";
import { loadedContextLines } from "./collect.ts";

const HOME = homedir();
const home = (s: string) => (s.startsWith(HOME) ? "~" + s.slice(HOME.length) : s);

const esc = (s: unknown): string =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const KIND_SINGULAR: Record<Kind, string> = {
  mcp: "MCP",
  skill: "skill",
  command: "command",
  subagent: "subagent",
  hook: "hook",
};
const KIND_HUE: Record<Kind, string> = {
  skill: "var(--hue-skill)",
  command: "var(--hue-command)",
  subagent: "var(--hue-subagent)",
  mcp: "var(--hue-mcp)",
  hook: "var(--hue-hook)",
};

// Readable accessible name — the stats that sighted users get from the hover
// tooltip, spelled out for screen readers (the `title` is not reliably announced
// and is invisible to keyboard/touch).
function chipAria(item: Item): string {
  if (item.kind === "hook") {
    return `${item.name}, hook — passive, fires on this event, not invocation-counted`;
  }
  const u = item.usage;
  const last = u.last ? new Date(u.last * 1000).toISOString().slice(0, 10) : "never";
  const parts = [`${item.name}, ${KIND_SINGULAR[item.kind]}`];
  if (item.contested) parts.push("contested name");
  if (item.invocation === "user-only") parts.push("user-invoked only, Claude cannot invoke it");
  if (item.invocation === "model-only") parts.push("model-invoked only, no slash command");
  if (item.kind === "mcp" && item.transport) parts.push(`${item.transport} transport`);
  parts.push(`${u.total} invocation${u.total === 1 ? "" : "s"} total`);
  parts.push(`last used ${last}`);
  parts.push(`${u.d7} in 7 days, ${u.d30} in 30 days`);
  if (!u.total && item.usageAnywhere.total)
    parts.push(`${item.usageAnywhere.total} invocations from other working directories`);
  if (item.refsOut?.length) parts.push(`depends on ${item.refsOut.join(", ")}`);
  if (item.refsIn?.length) parts.push(`used by ${item.refsIn.join(", ")}`);
  return parts.join(", ");
}

function chip(item: Item): string {
  const cls = [`chip`, `k-${item.kind}`, `r-${item.recency}`];
  if (item.contested) cls.push("contested");
  if (item.invocation === "user-only") cls.push("inv-user");
  if (item.invocation === "model-only") cls.push("inv-model");
  const out = item.refsOut ?? [],
    inn = item.refsIn ?? [];
  if (out.length || inn.length) cls.push("has-rel");
  const u = item.usage;
  const lastTxt = u.last ? new Date(u.last * 1000).toISOString().slice(0, 10) : "never";
  // Detail shown in the click popover, carried as data-* (no clunky native title).
  // A project-scoped item can be invoked from another cwd; say so rather than
  // leaving a bare "total 0" that reads as dead.
  const elsewhere = !u.total && item.usageAnywhere.total ? item.usageAnywhere.total : 0;
  const usageLine =
    item.kind === "hook"
      ? ""
      : `7d ${u.d7} · 30d ${u.d30} · 90d ${u.d90} · total ${u.total} · last ${lastTxt}` +
        (elsewhere ? ` · ${elsewhere} elsewhere` : "");
  const extra =
    item.kind === "hook"
      ? "passive — fires on this event, not invocation-counted"
      : item.kind === "mcp"
        ? `${item.transport ?? "?"}${item.url ? ` · ${item.url}` : ""}${item.projectPath ? ` · @ ${home(item.projectPath)}` : ""}`
        : "";
  const data =
    ` data-name="${esc(item.name.toLowerCase())}" data-label="${esc(item.name)}" data-kind="${item.kind}"` +
    ` data-loc="${esc(item.location)}"${usageLine ? ` data-usage="${esc(usageLine)}"` : ""}${extra ? ` data-extra="${esc(extra)}"` : ""}` +
    `${out.length ? ` data-out="${esc(out.join(","))}"` : ""}${inn.length ? ` data-in="${esc(inn.join(","))}"` : ""}${item.contested ? ` data-contested="1"` : ""}${item.contestedWith?.length ? ` data-contested-with="${esc(item.contestedWith.join("; "))}"` : ""}` +
    `${item.invocation === "user-only" ? ` data-inv="/${esc(item.name)} — user-invoked only, disable-model-invocation: true"` : ""}${item.invocation === "model-only" ? ` data-inv="✳ model-invoked only (no slash command) — user-invocable: false"` : ""}`;
  const ext =
    item.kind === "mcp" && item.transport ? `<span class="ext">${esc(item.transport)}</span>` : "";
  // Route marker, revealed only in relations mode: →n outgoing, ←n incoming.
  const mark =
    out.length || inn.length
      ? `<span class="rel-mark" aria-hidden="true">${out.length ? `→${out.length}` : ""}${out.length && inn.length ? " " : ""}${inn.length ? `←${inn.length}` : ""}</span>`
      : "";
  return `<span class="${cls.join(" ")}"${data} role="button" tabindex="0" aria-label="${esc(chipAria(item))}">${esc(item.name)}${ext}${mark}</span>`;
}

function chipsOf(items: Item[]): string {
  if (!items.length) return `<div class="muted">— none</div>`;
  const sorted = [...items].sort((a, b) => {
    if (b.usage.total !== a.usage.total) return b.usage.total - a.usage.total;
    if ((b.usage.last ?? 0) !== (a.usage.last ?? 0))
      return (b.usage.last ?? 0) - (a.usage.last ?? 0);
    return a.name.localeCompare(b.name);
  });
  return `<div class="chips">${sorted.map(chip).join("")}</div>`;
}

function kindSection(label: string, items: Item[]): string {
  if (!items.length) return "";
  return `<div class="sublabel">${esc(label)} <span class="ct">· ${items.length}</span></div>${chipsOf(items)}`;
}

function pluginBlock(p: PluginInfo): string {
  const skills = p.items.filter((i) => i.kind === "skill");
  const commands = p.items.filter((i) => i.kind === "command");
  const subagents = p.items.filter((i) => i.kind === "subagent");
  const mcps = p.items.filter((i) => i.kind === "mcp");
  const hooks = p.items.filter((i) => i.kind === "hook");
  const empty = !p.items.length;
  return `
  <div class="plug">
    <div class="plug-head">
      <span class="plug-name">${esc(p.name)}</span>
      <span class="plug-status s-${p.status}" title="${esc(p.statusNote)}">${p.status}</span>
      ${useBadge(p.items)}
      <span class="plug-meta">@ ${esc(p.marketplace)}${p.version ? " · v" + esc(p.version) : ""}</span>
    </div>
    ${kindSection("skills", skills)}
    ${kindSection("commands", commands)}
    ${kindSection("subagents", subagents)}
    ${kindSection("MCPs", mcps)}
    ${kindSection("hooks", hooks)}
    ${empty ? `<div class="muted">— no items</div>` : ""}
  </div>`;
}

function tallyRow(rowClass: string, cells: { num: number | string; lbl: string }[]): string {
  return `<div class="tally ${rowClass}">${cells.map((c) => `<div><div class="num">${esc(c.num)}</div><div class="lbl">${esc(c.lbl)}</div></div>`).join("")}</div>`;
}

// ---- Ledger: derived health findings ----
// Hooks are passive (never invoked by name), so every usage-based finding excludes
// them — otherwise they'd read as dead code.
const counted = (items: Item[]): Item[] => items.filter((i) => i.kind !== "hook");

// "Used" means used at all, anywhere — a project-scoped plugin skill invoked from
// a sibling repo is not dead weight, it is just attributed elsewhere.
function usageFrac(items: Item[]): { used: number; total: number } {
  const c = counted(items);
  return { used: c.filter((i) => i.usageAnywhere.total > 0).length, total: c.length };
}

// Small "used/total" badge for a plugin or project's installed surface. Empty when
// the source ships nothing countable. Red when nothing's ever been invoked.
function useBadge(items: Item[]): string {
  const { used, total } = usageFrac(items);
  if (!total) return "";
  const cls = used === 0 ? "use-badge none" : used === total ? "use-badge full" : "use-badge";
  return `<span class="${cls}" title="${used} of ${total} ever invoked">${used}/${total} used</span>`;
}

function flattenItems(result: CollectResult): Item[] {
  const out: Item[] = [...result.globalItems, ...result.userMcps];
  for (const p of result.userPlugins) out.push(...p.items);
  for (const r of result.regions) {
    for (const proj of r.projects) {
      out.push(...proj.localItems, ...proj.projectMcps);
      for (const sp of proj.scopedPlugins) out.push(...sp.items);
    }
  }
  return out;
}

// Never-invoked instances grouped by the source that ships them — surfaces whole
// dead installs (a plugin where 0/15 commands were ever called).
type DeadSource = {
  label: string;
  dead: number;
  total: number;
  items: { name: string; kind: Kind }[];
};
function deadBySource(result: CollectResult): DeadSource[] {
  const roll = new Map<
    string,
    { dead: number; total: number; items: { name: string; kind: Kind }[] }
  >();
  // One plugin can be installed into several projects; each install re-ships the
  // same names. Count a name once per source, or the row reads "15/18" with every
  // skill listed twice.
  const seen = new Map<string, Set<string>>();
  const add = (label: string, items: Item[]) => {
    for (const it of counted(items)) {
      if (!seen.has(label)) seen.set(label, new Set());
      const key = `${it.kind}:${it.name.toLowerCase()}`;
      if (seen.get(label)!.has(key)) continue;
      seen.get(label)!.add(key);
      const e = roll.get(label) ?? { dead: 0, total: 0, items: [] };
      e.total++;
      if (it.usageAnywhere.total === 0) {
        e.dead++;
        e.items.push({ name: it.name, kind: it.kind });
      }
      roll.set(label, e);
    }
  };
  add("global", result.globalItems);
  if (result.userMcps.length) add("user MCPs", result.userMcps);
  for (const p of result.userPlugins) add(`plugin · ${p.name}`, p.items);
  for (const r of result.regions) {
    for (const proj of r.projects) {
      add(home(proj.path), [...proj.localItems, ...proj.projectMcps]);
      for (const sp of proj.scopedPlugins) add(`plugin · ${sp.name}`, sp.items);
    }
  }
  return [...roll.entries()]
    .map(([label, e]) => ({ label, ...e }))
    .filter((e) => e.dead > 0)
    .sort((a, b) => b.dead - a.dead || b.total - a.total);
}

// Top items by lifetime invocations, deduped by kind+name.
function topUsed(items: Item[], n: number): Item[] {
  const best = new Map<string, Item>();
  for (const it of counted(items)) {
    if (it.usage.total === 0) continue;
    const k = `${it.kind}:${it.name.toLowerCase()}`;
    const cur = best.get(k);
    if (!cur || it.usage.total > cur.usage.total) best.set(k, it);
  }
  return [...best.values()].sort((a, b) => b.usage.total - a.usage.total).slice(0, n);
}

// Contested names with their full origin set. Each item carries contestedWith =
// every origin but its own; the union across a name's items is the full set.
function contestedGroups(items: Item[]): { name: string; kind: Kind; origins: string[] }[] {
  const g = new Map<string, { kind: Kind; origins: Set<string> }>();
  for (const it of items) {
    if (!it.contested) continue;
    const key = it.name.toLowerCase();
    const e = g.get(key) ?? { kind: it.kind, origins: new Set<string>() };
    for (const o of it.contestedWith ?? []) e.origins.add(o);
    g.set(key, e);
  }
  return [...g.entries()]
    .map(([name, e]) => ({ name, kind: e.kind, origins: [...e.origins].sort() }))
    .sort((a, b) => b.origins.length - a.origins.length || a.name.localeCompare(b.name));
}

function archivedPlugins(result: CollectResult): { name: string; where: string }[] {
  const out: { name: string; where: string }[] = [];
  for (const p of result.userPlugins)
    if (p.status === "archived") out.push({ name: p.name, where: "user scope" });
  for (const r of result.regions) {
    for (const proj of r.projects) {
      for (const sp of proj.scopedPlugins)
        if (sp.status === "archived") out.push({ name: sp.name, where: home(proj.path) });
    }
  }
  return out;
}

function lfRow(k: string, v: string, bad = false): string {
  return `<li><span class="lf-k">${esc(k)}</span><span class="lf-v${bad ? " bad" : ""}">${esc(v)}</span></li>`;
}

// A button that scrolls to and flashes the matching map chip(s) — reuses the
// popover's delegated `.pop-link` handler, so clicking jumps to the item.
function flashLink(name: string, kind?: Kind): string {
  const cls = kind ? ` k-${kind}` : "";
  return `<button type="button" class="pop-link${cls}" data-target="${esc(name.toLowerCase())}">${esc(name)}</button>`;
}

function ledgerPlate(result: CollectResult): string {
  const all = flattenItems(result);
  const countedAll = counted(all);
  const deadCount = countedAll.filter((i) => i.usageAnywhere.total === 0).length;
  const totalCount = countedAll.length;

  // Dead weight by source
  const dead = deadBySource(result);
  const deadShown = dead.slice(0, 8);
  const deadRows = deadShown
    .map((d) => {
      const allCold = d.dead === d.total;
      const links = [...d.items]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => flashLink(i.name, i.kind))
        .join("");
      // Each row opens to the exact cold items — click one to jump to it on the
      // map and check its last-used date before pruning.
      return (
        `<li class="lf-exp"><details>` +
        `<summary><span class="lf-k">${esc(d.label)}</span><span class="lf-v${allCold ? " bad" : ""}">${d.dead}/${d.total}</span></summary>` +
        `<div class="lf-items">${links}</div></details></li>`
      );
    })
    .join("");
  const deadMore =
    dead.length > deadShown.length
      ? `<div class="lf-more">+ ${dead.length - deadShown.length} more source${dead.length - deadShown.length === 1 ? "" : "s"} with dead items</div>`
      : "";

  // Concentration
  const top = topUsed(all, 6);
  const totalInv = topUsed(all, 1e9).reduce((s, i) => s + i.usage.total, 0);
  const topInv = top.reduce((s, i) => s + i.usage.total, 0);
  const share = totalInv ? Math.round((topInv / totalInv) * 100) : 0;
  const topRows = top
    .map(
      (i) =>
        `<li><span class="lf-k">${flashLink(i.name, i.kind)}<span class="lf-sub">· ${KIND_SINGULAR[i.kind]}</span></span><span class="lf-v">${i.usage.total}</span></li>`,
    )
    .join("");

  // Contested
  const groups = contestedGroups(all);
  const cShown = groups.slice(0, 10);
  const cRows = cShown
    .map(
      (g) =>
        `<li class="lf-clash"><span class="lf-k k-${g.kind}">${esc(g.name)}</span><span class="lf-origins">${g.origins.map((o) => `<span class="lf-origin">${esc(o)}</span>`).join("")}</span></li>`,
    )
    .join("");
  const cMore =
    groups.length > cShown.length
      ? `<div class="lf-more">+ ${groups.length - cShown.length} more contested name${groups.length - cShown.length === 1 ? "" : "s"}</div>`
      : "";

  // Frayed lines — declared wiring whose far end doesn't exist
  const ISSUE_LABEL: Record<WiringIssue["issue"], string> = {
    "hook-script": "hook → missing script",
    binary: "binary not on PATH",
    import: "unresolved @import",
    phantom: "phantom reference",
  };
  const wiring = result.wiring;
  const wShown = wiring.slice(0, 10);
  const wRows = wShown
    .map(
      (w) =>
        `<li class="lf-clash"><span class="lf-k">${w.fromKind === "hook" ? esc(w.from) : flashLink(w.from, w.fromKind)}<span class="lf-sub">· ${esc(ISSUE_LABEL[w.issue])}</span></span>` +
        `<span class="lf-origins"><span class="lf-origin">${esc(w.detail)}</span><span class="lf-origin">${esc(w.where)}</span></span></li>`,
    )
    .join("");
  const wMore =
    wiring.length > wShown.length
      ? `<div class="lf-more">+ ${wiring.length - wShown.length} more frayed line${wiring.length - wShown.length === 1 ? "" : "s"}</div>`
      : "";

  // Attrition / cruft
  const archived = archivedPlugins(result);
  const cruftRows = [
    lfRow("dormant projects", `${result.dormantProjects}`, result.dormantProjects > 0),
    lfRow("missing dirs (dropped)", `${result.droppedProjects}`, result.droppedProjects > 0),
    lfRow("archived plugins still installed", `${archived.length}`, archived.length > 0),
  ].join("");
  const archNote = archived.length
    ? `<div class="lf-more">${archived.map((a) => `${esc(a.name)} (${esc(a.where)})`).join(", ")}</div>`
    : "";

  return `
  <section class="plate ledger-plate">
    <h2 class="plate-title">Surveyor's Ledger <span class="sub">· health &amp; attrition</span></h2>
    <p class="plate-note">Derived findings — what the map says once you stop reading it as a map. Hooks excluded from usage counts (they fire passively).</p>
    <div class="ledger-grid">
      <div class="ledger-find">
        <div class="lf-head"><span class="lf-num">${deadCount}</span><span class="lf-cap">never invoked · of ${totalCount}</span></div>
        <p class="lf-note">Installed items with zero recorded use, by source. Prune candidates — a source showing <code>n/n</code> is entirely cold. Open a row for its cold items; click one to find it on the map.</p>
        <ul class="lf-list">${deadRows}</ul>${deadMore}
        <details class="lf-how">
          <summary>How to prune</summary>
          <ul>
            <li><strong>Plugin sources</strong> (<code>plugin · name</code>) — open the <code>/plugin</code> manager to disable or uninstall, or drop its marketplace from <code>~/.claude/settings.json</code>. One removal clears the whole <code>n/n</code> block.</li>
            <li><strong>Global</strong> — delete the folder: <code>~/.claude/skills/&lt;name&gt;/</code> (skill) or the file <code>~/.claude/commands/&lt;name&gt;.md</code> (command).</li>
            <li><strong>Project paths</strong> — same items under that repo's <code>.claude/</code>.</li>
          </ul>
          <p class="lf-warn">Never-invoked ≠ useless. A freshly installed tool and a rare-but-critical one look identical here. Open each chip on the map and check its <code>last</code> date before deleting.</p>
        </details>
      </div>
      <div class="ledger-find">
        <div class="lf-head"><span class="lf-num">${share}%</span><span class="lf-cap">from the top ${top.length}</span></div>
        <p class="lf-note">Concentration of all ${totalInv} recorded invocations. A small active core carries the setup.</p>
        <ul class="lf-list">${topRows}</ul>
        <p class="lf-hint">These are the workhorses — protect them. Everything <em>outside</em> this core is fair game for the dead-weight panel.</p>
      </div>
      <div class="ledger-find">
        <div class="lf-head"><span class="lf-num">${result.tally.contested}</span><span class="lf-cap">contested names</span></div>
        <p class="lf-note">A name resolving to 2+ implementations — resolution is ambiguous. Dedupe to control which one wins.</p>
        <ul class="lf-list">${cRows || `<li class="muted">— none</li>`}</ul>${cMore}
        <details class="lf-how">
          <summary>How to resolve</summary>
          <p>Rename or remove one of the listed origins so the token resolves to a single item. More-local scope generally wins (project &gt; user &gt; plugin), but confirm which actually fires before relying on it — invoke it once and check the map's heat.</p>
        </details>
      </div>
      <div class="ledger-find">
        <div class="lf-head"><span class="lf-num">${wiring.length}</span><span class="lf-cap">frayed lines</span></div>
        <p class="lf-note">Declared wiring whose far end doesn't exist: hook scripts, <code>allowed-tools</code> binaries, <code>@imports</code>, and namespaced <code>/plugin:command</code> mentions that resolve to nothing known. Static checks only — nothing was executed.</p>
        <ul class="lf-list">${wRows || `<li class="muted">— every declared line holds</li>`}</ul>${wMore}
        <details class="lf-how">
          <summary>How to mend</summary>
          <ul>
            <li><strong>Missing script / import</strong> — the file moved or was deleted; fix the path in the hook entry or body, or restore the file.</li>
            <li><strong>Binary not on PATH</strong> — install it, or drop the <code>Bash(…)</code> entry if the skill no longer shells out to it. Checked against this process's PATH — a shell-only PATH addition can read as missing.</li>
            <li><strong>Phantom reference</strong> — the mentioned item was renamed or removed; update the mention. Only backticked <code>/ns:slug</code> forms are scanned (plain <code>/slug</code> collides with URL routes), so a documentation example can still show up here falsely.</li>
          </ul>
        </details>
      </div>
      <div class="ledger-find">
        <div class="lf-head"><span class="lf-num">${result.dormantProjects + result.droppedProjects + archived.length}</span><span class="lf-cap">attrition &amp; cruft</span></div>
        <p class="lf-note">Stale wiring: projects with no activity, vanished directories, plugins from archived marketplaces.</p>
        <ul class="lf-list">${cruftRows}</ul>${archNote}
        <details class="lf-how">
          <summary>How to clear</summary>
          <ul>
            <li><strong>Archived plugins</strong> — the upstream marketplace is archived; remove it through the <code>/plugin</code> manager.</li>
            <li><strong>Dormant projects</strong> — just directories with past usage and no Claude config. Nothing to clean unless you delete the repo itself.</li>
            <li><strong>Missing dirs</strong> — already auto-dropped from the atlas; no action needed.</li>
          </ul>
        </details>
      </div>
    </div>
  </section>`;
}

function compassPlate(): string {
  // Four-point rose, one symbol per kind; three nested location rings.
  return `
  <div class="compass-wrap">
    <svg class="compass-svg" viewBox="-110 -110 220 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
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
      <div class="leg-col">
        <div class="leg-group">
          <p class="leg-head">Kinds</p>
          <span class="leg-sample"><span class="swatch" style="background:${KIND_HUE.skill}"></span></span><span class="leg-desc">skill</span>
          <span class="leg-sample"><span class="swatch" style="background:${KIND_HUE.command}"></span></span><span class="leg-desc">command</span>
          <span class="leg-sample"><span class="swatch" style="background:${KIND_HUE.subagent}"></span></span><span class="leg-desc">subagent</span>
          <span class="leg-sample"><span class="swatch" style="background:${KIND_HUE.mcp}"></span></span><span class="leg-desc">MCP</span>
          <span class="leg-sample"><span class="swatch" style="background:${KIND_HUE.hook}"></span></span><span class="leg-desc">hook</span>
        </div>
      </div>
      <div class="leg-col">
        <div class="leg-group">
          <p class="leg-head">Ink density · recency</p>
          <span class="leg-sample"><span class="chip k-skill r-hot">hot</span></span><span class="leg-desc">≤ 7 days</span>
          <span class="leg-sample"><span class="chip k-skill r-warm">warm</span></span><span class="leg-desc">≤ 30 days</span>
          <span class="leg-sample"><span class="chip k-skill r-cool">cool</span></span><span class="leg-desc">≤ 90 days</span>
          <span class="leg-sample"><span class="chip k-skill r-stale">stale</span></span><span class="leg-desc">older</span>
          <span class="leg-sample"><span class="chip k-skill r-none">none</span></span><span class="leg-desc">never invoked</span>
          <span class="leg-sample"><span class="chip k-hook">hook</span></span><span class="leg-desc">passive · not counted</span>
        </div>
      </div>
      <div class="leg-col">
        <div class="leg-group">
          <p class="leg-head">Marks</p>
          <span class="leg-sample"><span class="chip k-skill r-warm contested">name</span></span><span class="leg-desc">contested · 2+ items share this name</span>
          <span class="leg-sample"><span class="chip k-skill r-warm inv-user">name</span></span><span class="leg-desc">user-invoked only · drawn as the /slash it's typed with</span>
          <span class="leg-sample"><span class="chip k-skill r-warm inv-model">name</span></span><span class="leg-desc">model-invoked only · no slash command</span>
        </div>
      </div>
    </div>
  </div>`;
}

function relationsPlate(result: CollectResult): string {
  const rels = result.relations;
  const rows = rels
    .map((r) => {
      const refs = r.refs
        .map(
          (ref) =>
            `<span class="rel-to k-${ref.kind}${ref.ambiguous ? " amb" : ""}"${ref.ambiguous ? ` title="contested name — resolves to 2+ items"` : ""}>${esc(ref.name)}${ref.ambiguous ? '<span class="q">?</span>' : ""}</span>`,
        )
        .join("");
      return `<div class="rel-row">
      <span class="rel-from k-${r.fromKind}">${esc(r.from)}</span>
      <span class="rel-arrow">→</span>
      <span class="rel-refs">${refs}</span>
    </div>`;
    })
    .join("");
  return `
  <section class="plate relations-plate">
    <h2 class="plate-title">Relations <span class="sub">· declared references</span>
      <label class="rel-knob"><input type="checkbox" id="rel-toggle"><span class="rel-knob-track"></span><span class="rel-knob-label">show routes</span></label>
    </h2>
    <p class="plate-note">Static scrape of skill, command &amp; subagent bodies for <code>/slug</code> and <code>\`slug\`</code> mentions that resolve to a known item. ${rels.length} edge${rels.length === 1 ? "" : "s"}; usage not consulted. Both ends are tinted by kind (<span class="amb-key" style="color:var(--hue-skill)">skill</span> · <span class="amb-key" style="color:var(--hue-command)">command</span> · <span class="amb-key" style="color:var(--hue-subagent)">subagent</span>, see compass). <span class="amb-key amb">name?</span> = contested target.</p>
    <div class="rel-body">${rels.length ? rows : `<div class="muted">— no declared references found</div>`}</div>
  </section>`;
}

function gazetteer(result: CollectResult): string {
  const global = result.globalItems;
  const gs = global.filter((i) => i.kind === "skill");
  const gc = global.filter((i) => i.kind === "command");
  const ga = global.filter((i) => i.kind === "subagent");
  const gh = global.filter((i) => i.kind === "hook");
  return `
  <section class="plate">
    <h2 class="plate-title">Global &amp; User Inventory <span class="sub">· Gazetteer</span></h2>
    <p class="plate-note">What rides with every project: ~/.claude/ contents, user-scope plugins, and user-scope MCPs.</p>
    <div class="gaz-grid">
      <div class="gaz-col">
        <h3>Global <span class="count">${global.length} item${global.length === 1 ? "" : "s"}</span></h3>
        <p class="region-note">~/.claude/{skills,commands,agents} plus hooks from ~/.claude/settings.json — present in every bay.</p>
        ${kindSection("skills", gs)}
        ${kindSection("commands", gc)}
        ${kindSection("subagents", ga)}
        ${kindSection("hooks", gh)}
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

// ---- Standing context: briefing stamp + baseline strip ----
const CTX_LABEL: Record<ContextKind, string> = {
  "claude-md": "CLAUDE.md",
  "claude-local": "CLAUDE.local",
  rule: "rule",
  "memory-index": "memory",
};

// Marginal standing context a card contributes, on top of the global baseline.
// A muted marginalia stamp (not a kind hue — standing context is a separate axis
// from servitors), collapsed by default, opening to each source.
function briefingStamp(ctx: ProjectContext | undefined): string {
  if (!ctx) return "";
  const ticks = [
    ctx.hasOverflow ? "overflow" : "",
    ctx.hasOverCliff ? "long CLAUDE.md" : "",
    ctx.onDemandRules
      ? `${ctx.onDemandRules} on-demand rule${ctx.onDemandRules === 1 ? "" : "s"}`
      : "",
  ]
    .filter(Boolean)
    .map((t) => `<span class="briefing-tick">${esc(t)}</span>`)
    .join("");
  const rows = ctx.sources
    .map((s) => {
      const load =
        s.loadMode === "on-demand"
          ? "on-demand"
          : s.loadMode === "overflow-truncated"
            ? `${s.lines} ln · head only`
            : `${s.lines} ln`;
      const imp = s.importLines ? ` +${s.importLines} imported${s.importsDeep ? "…" : ""}` : "";
      return (
        `<div class="briefing-src"><span class="bs-kind">${esc(CTX_LABEL[s.kind])}</span>` +
        `<span class="bs-scope">${esc(s.scope)}</span>` +
        `<span class="bs-lines">${esc(load)}${esc(imp)}</span></div>`
      );
    })
    .join("");
  return (
    `<details class="briefing"><summary class="briefing-stamp">` +
    `<span class="orn" aria-hidden="true">❧</span> briefing ${ctx.alwaysLines} ln${ticks}</summary>` +
    `<div class="briefing-list">${rows}</div></details>`
  );
}

// The global standing context every project loads, stated once so a card's stamp
// reads as marginal on top of this.
function baselineStrip(baseline: ContextSource[]): string {
  if (!baseline.length) return "";
  const load = (arr: ContextSource[]) => arr.reduce((n, s) => n + loadedContextLines(s), 0);
  const userMd = baseline.filter((s) => s.scope === "user" && s.kind === "claude-md");
  const userRules = baseline.filter((s) => s.scope === "user" && s.kind === "rule");
  const managed = baseline.filter((s) => s.scope === "managed");
  const parts: string[] = [];
  if (userMd.length) parts.push(`user CLAUDE.md (${load(userMd)})`);
  if (userRules.length) parts.push(`user rules (${load(userRules)} across ${userRules.length})`);
  if (managed.length) parts.push(`managed policy (${load(managed)})`);
  if (!parts.length) return "";
  return (
    `<div class="baseline-strip"><span class="orn" aria-hidden="true">❧</span> ` +
    `Every project also loads <strong>${load(baseline)} ln</strong> of standing context — ${parts.join(" · ")}.</div>`
  );
}

function projectCard(proj: ProjectInfo): string {
  const local = proj.localItems;
  const localSk = local.filter((i) => i.kind === "skill");
  const localCm = local.filter((i) => i.kind === "command");
  const localAg = local.filter((i) => i.kind === "subagent");
  const localHk = local.filter((i) => i.kind === "hook");
  const a = proj.activity;
  const lastTxt = a.last ? new Date(a.last * 1000).toISOString().slice(0, 10) : "—";
  const summary = a.total ? `${a.total} invocations · last ${lastTxt}` : "no recorded usage";
  const empty =
    !local.length && !proj.scopedPlugins.length && !proj.projectMcps.length && !proj.context;
  return `
  <div class="proj-card ${empty ? "empty" : ""}">
    <div class="proj-head">
      <span class="proj-path">${esc(home(proj.path))}</span>
      <span class="proj-activity" title="7d:${a.d7} 30d:${a.d30} 90d:${a.d90} total:${a.total}">${esc(summary)}</span>
      ${useBadge([...local, ...proj.projectMcps, ...proj.scopedPlugins.flatMap((sp) => sp.items)])}
      ${briefingStamp(proj.context)}
    </div>
    ${kindSection("local skills", localSk)}
    ${kindSection("local commands", localCm)}
    ${kindSection("local subagents", localAg)}
    ${kindSection("local hooks", localHk)}
    ${proj.projectMcps.length ? kindSection("project MCPs", proj.projectMcps) : ""}
    ${proj.scopedPlugins.length ? `<div class="sublabel">scoped plugins <span class="ct">· ${proj.scopedPlugins.length}</span></div>${proj.scopedPlugins.map(pluginBlock).join("")}` : ""}
    ${empty ? `<div class="muted">global &amp; user-scope only</div>` : ""}
  </div>`;
}

function regionsBlock(result: CollectResult): string {
  if (!result.regions.length)
    return `<section class="plate"><h2 class="plate-title">Regions</h2><p class="muted">— no active projects found.</p></section>`;
  return result.regions
    .map(
      (r) => `
    <section class="region">
      <h2>${esc(r.label)} <span class="sub">${r.projects.length} project${r.projects.length === 1 ? "" : "s"} · ${r.activity.total} invocations</span></h2>
      <div class="project-list">${r.projects.map(projectCard).join("")}</div>
    </section>`,
    )
    .join("");
}

export function renderAtlas(result: CollectResult): string {
  const t = result.tally;
  const tallyA = tallyRow("tally-counts", [
    { num: t.counts.mcp, lbl: "MCPs" },
    { num: t.counts.skill, lbl: "Skills" },
    { num: t.counts.command, lbl: "Commands" },
    { num: t.counts.subagent, lbl: "Subagents" },
    { num: t.counts.hook, lbl: "Hooks" },
  ]);
  const tallyB = tallyRow("tally-stats", [
    { num: t.invocations7d, lbl: "Invocations · 7d" },
    { num: t.invocations30d, lbl: "Invocations · 30d" },
    { num: t.contested, lbl: "Contested names" },
    { num: t.dormant, lbl: "Dormant projects" },
  ]);
  return `
${tallyA}
${tallyB}
${baselineStrip(result.baseline)}
${compassPlate()}
${ledgerPlate(result)}
${gazetteer(result)}
${relationsPlate(result)}
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
  return out;
}
