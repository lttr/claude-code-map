// ── The Astrolabe ──────────────────────────────────────────────────────
// Ctrl+K opens a sighting instrument: a modal with one input and a live
// list of every charted thing — servitors (chips), projects, regions and
// plates. Typing narrows by subsequence match; Enter takes the bearing,
// scrolling the target into view, flashing it and moving focus there.
// The index is built from the DOM on first open, so it works for both the
// live fetch and the inlined --out build.
(function () {
  interface Landmark {
    el: HTMLElement;
    name: string;
    kind: string;
    where: string;
  }
  interface Hit {
    it: Landmark;
    score: number;
    marks: number[];
  }

  let scrim: HTMLDivElement | null = null;
  let input: HTMLInputElement | null = null;
  let list: HTMLUListElement | null = null;
  let rows: Hit[] = [];
  let sel = 0;
  let index: Landmark[] = [];

  // ---- index ----------------------------------------------------------
  function collect(): Landmark[] {
    const out: Landmark[] = [];
    document.querySelectorAll<HTMLElement>("#atlas .chip").forEach((el) => {
      // Legend samples inside the compass plate are decorations, not servitors.
      if (el.closest(".compass-legend")) return;
      // Local servitors repeat across projects — qualify them with the card's path.
      const card = el.closest(".proj-card");
      const path = card && card.querySelector(".proj-path");
      const loc = el.dataset.loc || "";
      out.push({
        el: el,
        name: el.dataset.label || el.textContent.trim(),
        kind: el.dataset.kind || "servitor",
        where: path ? loc + " · " + (path.textContent || "").trim() : loc,
      });
    });
    document.querySelectorAll<HTMLElement>("#atlas .proj-card").forEach((el) => {
      const p = el.querySelector(".proj-path");
      if (!p) return;
      const region = el.closest(".region");
      const h = region && region.querySelector("h2");
      out.push({
        el: el,
        name: (p.textContent || "").trim(),
        kind: "project",
        where: h?.firstChild?.textContent?.trim() || "",
      });
    });
    document.querySelectorAll<HTMLElement>("#atlas .region > h2").forEach((el) => {
      out.push({
        el: el.parentNode as HTMLElement,
        name: el.firstChild?.textContent?.trim() || "",
        kind: "region",
        where: "",
      });
    });
    document.querySelectorAll<HTMLElement>("#atlas .plate-title").forEach((el) => {
      out.push({
        el: el.parentNode as HTMLElement,
        name: el.firstChild?.textContent?.trim() || "",
        kind: "plate",
        where: "",
      });
    });
    return out;
  }

  // ---- matching -------------------------------------------------------
  // Subsequence match over the name; returns {score, marks} or null.
  // Contiguous runs and start-of-name/word hits score higher.
  function match(name: string, q: string): { score: number; marks: number[] } | null {
    if (!q) return { score: 0, marks: [] };
    const lname = name.toLowerCase();
    const marks: number[] = [];
    let score = 0;
    let i = 0;
    let run = 0;
    for (let k = 0; k < q.length; k++) {
      const at = lname.indexOf(q[k], i);
      if (at < 0) return null;
      run = at === i && k > 0 ? run + 1 : 0;
      score += 10 + run * 6;
      if (at === 0) score += 25;
      else if (/[^a-z0-9]/.test(lname[at - 1])) score += 12;
      marks.push(at);
      i = at + 1;
    }
    return { score: score - lname.length * 0.2, marks: marks };
  }

  const KIND_RANK: Record<string, number> = {
    skill: 0,
    command: 0,
    subagent: 0,
    mcp: 1,
    hook: 1,
    project: 2,
    region: 3,
    plate: 3,
  };

  function search(q: string): Hit[] {
    const hits: Hit[] = [];
    index.forEach((it) => {
      let m = match(it.name, q);
      if (!m && q) m = match(it.where, q) ? { score: -60, marks: [] } : null;
      if (m) hits.push({ it: it, score: m.score, marks: m.marks });
    });
    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ka = KIND_RANK[a.it.kind] ?? 4;
      const kb = KIND_RANK[b.it.kind] ?? 4;
      if (ka !== kb) return ka - kb;
      return a.it.name.localeCompare(b.it.name);
    });
    return hits.slice(0, 60);
  }

  // ---- rendering ------------------------------------------------------
  function esc(s: string): string {
    return String(s).replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c as "&" | "<" | ">"],
    );
  }

  function highlight(name: string, marks: number[]): string {
    if (!marks.length) return esc(name);
    let out = "";
    let prev = 0;
    marks.forEach((at) => {
      out += esc(name.slice(prev, at)) + "<b>" + esc(name[at]) + "</b>";
      prev = at + 1;
    });
    return out + esc(name.slice(prev));
  }

  function draw() {
    const q = input!.value.trim().toLowerCase();
    rows = search(q);
    sel = 0;
    if (!rows.length) {
      list!.innerHTML = '<li class="astro-empty">No such landmark on this chart.</li>';
      return;
    }
    list!.innerHTML = rows
      .map(
        (h, i) =>
          '<li class="astro-row" role="option" data-i="' +
          i +
          '" aria-selected="' +
          (i === 0) +
          '">' +
          '<span class="astro-name k-' +
          h.it.kind +
          '">' +
          highlight(h.it.name, h.marks) +
          "</span>" +
          '<span class="astro-kind">' +
          esc(h.it.kind) +
          "</span>" +
          (h.it.where ? '<span class="astro-where">' + esc(h.it.where) + "</span>" : "") +
          "</li>",
      )
      .join("");
  }

  function move(delta: number) {
    if (!rows.length) return;
    const items = list!.querySelectorAll(".astro-row");
    items[sel].setAttribute("aria-selected", "false");
    sel = (sel + delta + rows.length) % rows.length;
    items[sel].setAttribute("aria-selected", "true");
    items[sel].scrollIntoView({ block: "nearest" });
  }

  // ---- taking the bearing ---------------------------------------------
  function sail(hit: Hit) {
    const el = hit.it.el;
    close();
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const chip = el.classList.contains("chip");
    el.classList.add(chip ? "flash" : "astro-flash");
    setTimeout(() => el.classList.remove(chip ? "flash" : "astro-flash"), 1600);
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  }

  // ---- open / close ----------------------------------------------------
  function close() {
    if (!scrim) return;
    scrim.remove();
    scrim = input = list = null;
    rows = [];
  }

  function open() {
    if (scrim) {
      input!.select();
      return;
    }
    index = collect();
    scrim = document.createElement("div");
    scrim.className = "astro-scrim";
    scrim.innerHTML =
      '<div class="astro" role="dialog" aria-modal="true" aria-label="Astrolabe">' +
      '<div class="astro-head">' +
      '<span class="astro-title"><span class="orn" aria-hidden="true">✶</span> Astrolabe</span>' +
      '<input class="astro-input" type="text" autocomplete="off" spellcheck="false" ' +
      'placeholder="sight a servitor, project, or plate…" aria-label="Search the atlas" ' +
      'role="combobox" aria-expanded="true" aria-controls="astro-list" />' +
      "</div>" +
      '<ul class="astro-list" id="astro-list" role="listbox"></ul>' +
      '<div class="astro-foot"><span>↑↓ sight</span><span>↵ sail there</span><span>esc dismiss</span>' +
      "<span>" +
      index.length +
      " landmarks · chips, projects, regions, plates</span></div>" +
      "</div>";
    document.body.appendChild(scrim);
    input = scrim.querySelector<HTMLInputElement>(".astro-input");
    list = scrim.querySelector<HTMLUListElement>(".astro-list");
    draw();
    input!.focus();

    input!.addEventListener("input", draw);
    scrim.addEventListener("mousedown", (e) => {
      if (!(e.target instanceof Element && e.target.closest(".astro"))) close();
    });
    list!.addEventListener("click", (e) => {
      const row = e.target instanceof Element ? e.target.closest<HTMLElement>(".astro-row") : null;
      if (row) sail(rows[+(row.dataset.i || 0)]);
    });
    scrim.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (rows.length) sail(rows[sel]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (scrim) close();
      else open();
    }
  });
  const btn = document.getElementById("astro-open");
  if (btn) btn.addEventListener("click", open);
})();
