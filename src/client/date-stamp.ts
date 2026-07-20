// Stamp today's date into the cartouche subtitle and the colophon.
(function () {
  const fmt = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const now = new Date();
  const stamp = document.getElementById("date-stamp");
  if (stamp) stamp.textContent = "the " + fmt.format(now);
  const col = document.getElementById("colophon-date");
  if (col) col.textContent = fmt.format(now);
})();
