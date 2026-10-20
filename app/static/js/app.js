document.addEventListener("DOMContentLoaded", function () {
  var toggle = document.getElementById("themeToggle");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var root = document.documentElement;
      var next = root.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
      root.setAttribute("data-bs-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      document.dispatchEvent(new Event("themechange"));
    });
  }
  // <form data-confirm="Are you sure?"> asks before submitting (inline handlers are blocked by CSP).
  document.addEventListener("submit", function (e) {
    var msg = e.target.getAttribute && e.target.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) e.preventDefault();
  });
  // Selects marked data-autosubmit reload the page with the new filter.
  document.querySelectorAll("[data-autosubmit]").forEach(function (el) {
    el.addEventListener("change", function () { el.form.submit(); });
  });
});
