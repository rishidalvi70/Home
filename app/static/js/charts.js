// Draws charts from JSON in each canvas's data-chart attribute (no inline scripts, CSP-safe).
(function () {
  var PALETTE = ["#6366f1", "#16a34a", "#e11d48", "#f59e0b", "#0ea5e9", "#a855f7", "#14b8a6", "#f97316", "#64748b"];
  var charts = [];

  function css(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function build(canvas) {
    var cfg = JSON.parse(canvas.getAttribute("data-chart"));
    var text = css("--bs-secondary-color", "#6b7280");
    var grid = css("--bs-border-color", "#e5e7eb");
    var isDoughnut = cfg.type === "doughnut";
    var datasets = cfg.datasets.map(function (d, i) {
      var o = { label: d.label, data: d.data };
      if (isDoughnut) { o.backgroundColor = PALETTE; o.borderWidth = 0; }
      else { o.backgroundColor = d.color || PALETTE[i]; o.borderRadius = 6; }
      return o;
    });
    var options = {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: isDoughnut ? "right" : "bottom", labels: { color: text, boxWidth: 12 } },
        tooltip: { callbacks: { label: function (c) {
          var v = isDoughnut ? c.parsed : c.parsed.y;
          return (c.dataset.label || c.label) + ": ₹" + Number(v).toLocaleString("en-IN");
        } } }
      }
    };
    if (!isDoughnut) {
      options.scales = {
        x: { ticks: { color: text }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: text, callback: function (v) { return "₹" + Number(v).toLocaleString("en-IN"); } }, grid: { color: grid } }
      };
    }
    return new Chart(canvas, { type: cfg.type, data: { labels: cfg.labels, datasets: datasets }, options: options });
  }

  function draw() {
    charts.forEach(function (c) { c.destroy(); });
    charts = [];
    document.querySelectorAll("canvas[data-chart]").forEach(function (cv) { charts.push(build(cv)); });
  }

  document.addEventListener("DOMContentLoaded", draw);
  document.addEventListener("themechange", draw);
})();
