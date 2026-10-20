// Runs before first paint to avoid a light/dark flash. Only a UI preference is stored here.
(function () {
  var saved = null;
  try { saved = localStorage.getItem("theme"); } catch (e) {}
  var dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-bs-theme", dark ? "dark" : "light");
})();
