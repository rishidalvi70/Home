// Draws charts from JSON in each canvas's data-chart attribute (works offline: Chart.js is bundled).
const PALETTE = ["#6366f1", "#16a34a", "#e11d48", "#f59e0b", "#0ea5e9", "#a855f7", "#14b8a6", "#f97316", "#64748b"];
let charts = [];

const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const rupee = (v) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });

function build(canvas) {
  const cfg = JSON.parse(canvas.getAttribute("data-chart"));
  const text = css("--bs-secondary-color", "#6b7280");
  const grid = css("--bs-border-color", "#e5e7eb");
  const dough = cfg.type === "doughnut";
  const datasets = cfg.datasets.map((d, i) => dough
    ? { label: d.label, data: d.data, backgroundColor: PALETTE, borderWidth: 0 }
    : { label: d.label, data: d.data, backgroundColor: d.color || PALETTE[i], borderRadius: 6 });
  const options = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: dough ? "right" : "bottom", labels: { color: text, boxWidth: 12 } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label || c.label}: ${rupee(dough ? c.parsed : c.parsed.y)}` } },
    },
  };
  if (!dough) options.scales = {
    x: { ticks: { color: text }, grid: { display: false } },
    y: { beginAtZero: true, ticks: { color: text, callback: rupee }, grid: { color: grid } },
  };
  return new window.Chart(canvas, { type: cfg.type, data: { labels: cfg.labels, datasets }, options });
}

export function drawCharts(root = document) {
  charts.forEach((c) => c.destroy());
  charts = [];
  if (!window.Chart) return;
  root.querySelectorAll("canvas[data-chart]").forEach((cv) => charts.push(build(cv)));
}
document.addEventListener("themechange", () => drawCharts());
