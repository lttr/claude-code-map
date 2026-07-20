// Runtime fetch of the atlas fragment. Served mode only — the --out build
// inlines the fragment instead and this script is omitted entirely.
void (async function () {
  const atlas = document.getElementById("atlas")!;
  try {
    const res = await fetch("/atlas.html", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();
    atlas.classList.remove("atlas-loading");
    atlas.innerHTML = html;
  } catch (e) {
    atlas.classList.remove("atlas-loading");
    atlas.innerHTML =
      '<div class="atlas-error">Survey failed: ' +
      String(e).replace(
        /[&<>]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c as "&" | "<" | ">"],
      ) +
      "</div>";
  }
})();
