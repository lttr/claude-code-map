// Chip detail popover: click (or Enter/Space) a chip to open a readable card
// with its usage and declared references; reference names are buttons that
// scroll to and flash the matching chip(s). Delegated, so it covers chips
// injected by the runtime fetch as well as the inlined --out build.
(function () {
  let pop: HTMLDivElement | null = null;
  let anchor: HTMLElement | null = null;

  function close() {
    if (pop) {
      pop.remove();
      pop = null;
    }
    if (anchor) {
      anchor.classList.remove("sel");
      anchor = null;
    }
  }

  function flash(name: string) {
    const hits = Array.from(document.querySelectorAll<HTMLElement>(".chip")).filter(
      (c) => c.dataset.name === name,
    );
    if (!hits.length) return;
    hits[0].scrollIntoView({ behavior: "smooth", block: "center" });
    hits.forEach((c) => {
      c.classList.add("flash");
      setTimeout(() => c.classList.remove("flash"), 1500);
    });
  }

  function linkRow(label: string, csv: string | undefined) {
    const names = (csv || "").split(",").filter(Boolean);
    if (!names.length) return "";
    const links = names
      .map(
        (n) => '<button type="button" class="pop-link" data-target="' + n + '">' + n + "</button>",
      )
      .join("");
    return (
      '<div class="pop-sec"><span class="pop-lbl">' +
      label +
      '</span><span class="pop-links">' +
      links +
      "</span></div>"
    );
  }

  function open(chip: HTMLElement) {
    close();
    const d = chip.dataset;
    pop = document.createElement("div");
    pop.className = "chip-pop";
    const linkable = d.kind === "skill" || d.kind === "command";
    pop.innerHTML =
      '<div class="pop-head"><span class="pop-name k-' +
      d.kind +
      '">' +
      (d.label || "") +
      "</span>" +
      '<span class="pop-kind">' +
      d.kind +
      (d.contested ? " · contested" : "") +
      (d.loc ? " · " + d.loc : "") +
      "</span></div>" +
      (d.inv ? '<div class="pop-meta pop-inv">' + d.inv + "</div>" : "") +
      (d.extra ? '<div class="pop-meta">' + d.extra + "</div>" : "") +
      (d.usage ? '<div class="pop-meta">' + d.usage + "</div>" : "") +
      (d.contestedWith
        ? '<div class="pop-meta pop-contested">name also at — ' + d.contestedWith + "</div>"
        : "") +
      linkRow("depends on", d.out) +
      linkRow("used by", d.in) +
      (linkable && !d.out && !d.in ? '<div class="pop-none">no declared references</div>' : "");
    document.body.appendChild(pop);

    const r = chip.getBoundingClientRect();
    const top = window.scrollY + r.bottom + 6;
    let left = window.scrollX + r.left;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 12;
    if (left > maxLeft) left = Math.max(window.scrollX + 12, maxLeft);
    pop.style.top = top + "px";
    pop.style.left = left + "px";

    anchor = chip;
    chip.classList.add("sel");
  }

  document.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const link = target.closest<HTMLElement>(".pop-link");
    if (link) {
      flash(link.dataset.target || "");
      return;
    }
    const chip = target.closest<HTMLElement>(".chip");
    if (chip) {
      e.preventDefault();
      open(chip);
      return;
    }
    if (pop && !target.closest(".chip-pop")) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    const target = e.target instanceof HTMLElement ? e.target : null;
    if ((e.key === "Enter" || e.key === " ") && target && target.classList.contains("chip")) {
      e.preventDefault();
      open(target);
    }
  });
})();
