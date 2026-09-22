const { api, esc, clock, duration, ALERT, STATUS, via } = Suraksha;

let days = 1;
let alerts = [];
const tip = document.getElementById("tip");
const tables = new Set();

function periodStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime() / 1000;
}

function showTip(e, text) {
  tip.textContent = text;
  tip.style.left = e.clientX + "px";
  tip.style.top = e.clientY + "px";
  tip.classList.remove("hidden");
}
document.addEventListener("mouseover", (e) => { const t = e.target.closest("[data-tip]"); if (!t) tip.classList.add("hidden"); });
document.addEventListener("mousemove", (e) => { const t = e.target.closest("[data-tip]"); if (t) showTip(e, t.dataset.tip); });

function simpleTable(head, rows) {
  return `<table class="ztable"><thead><tr>${head.map((h, i) => `<th${i ? ' style="text-align:right"' : ""}>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${i ? "n" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

// Single series column chart: one hue, value labels only on the peak, exact values on hover.
function columns(el, points, fmt = (v) => v) {
  const max = Math.max(...points.map((p) => p.v), 0);
  if (!max) { el.innerHTML = `<div class="no-data">No data in this period yet.</div>`; return; }
  const peak = points.findIndex((p) => p.v === max);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const lines = [];
  for (let v = step; v <= top; v += step) lines.push(`<div class="gridline" style="bottom:${(v / top) * 100}%"><span>${fmt(v)}</span></div>`);
  const every = points.length > 12 ? Math.ceil(points.length / 8) : 1;
  el.innerHTML = `<div class="cols-chart">
    <div class="cols-plot">${lines.join("")}${points.map((p, i) => `<div class="col" data-tip="${esc(p.label)}: ${esc(fmt(p.v))}">
      ${i === peak ? `<span class="peak">${fmt(p.v)}</span>` : ""}<div class="bar ${p.v ? "" : "zero"}" style="height:${(p.v / top) * 100}%"></div></div>`).join("")}</div>
    <div class="cols-x">${points.map((p, i) => `<span>${i % every === 0 ? esc(p.short) : ""}</span>`).join("")}</div></div>`;
}
function niceStep(max) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag); // counts and seconds are whole numbers
}

function render() {
  const from = periodStart();
  const list = alerts.filter((a) => a.created_at >= from);
  const d = new Date();
  document.getElementById("dayLabel").textContent = days === 1
    ? d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${new Date(from * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} to ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`;

  // Tiles
  const acked = list.filter((a) => a.ack_at);
  const avg = acked.length ? acked.reduce((s, a) => s + (a.ack_at - a.created_at), 0) / acked.length : null;
  const sos = list.filter((a) => a.type === "SOS" || a.type === "FALL").length;
  const mesh = list.filter((a) => a.source === "mesh").length;
  document.getElementById("tiles").innerHTML = [
    ["Alerts", list.length, `${list.filter((a) => a.status !== "resolved").length} still open`],
    ["SOS and falls", sos, "Pressed by tourists or detected by the band"],
    ["Average time to assign", duration(avg), acked.length ? `Across ${acked.length} assigned case${acked.length === 1 ? "" : "s"}` : "No cases assigned yet"],
    ["Came through the mesh", mesh, list.length ? `${Math.round((mesh / list.length) * 100)}% of alerts had no internet` : "–"],
  ].map(([k, v, s]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

  // By type: horizontal bars sorted by count, one hue, value at the end of each bar.
  const types = Object.keys(ALERT).map((k) => ({ k, label: ALERT[k].label, v: list.filter((a) => a.type === k).length })).sort((a, b) => b.v - a.v);
  const tmax = Math.max(...types.map((t) => t.v), 0);
  const byType = document.getElementById("byType");
  byType.innerHTML = !tmax ? `<div class="no-data">No alerts in this period.</div>` : tables.has("byType")
    ? simpleTable(["Type", "Alerts"], types.map((t) => [t.label, t.v]))
    : `<div class="hbars">${types.map((t) => `<div class="hbar" data-tip="${esc(t.label)}: ${t.v} alert${t.v === 1 ? "" : "s"}"><span>${esc(t.label)}</span><div class="track"><div class="fill" style="width:${(t.v / tmax) * 100}%${t.v ? "" : ";min-width:0"}"></div></div><span class="n">${t.v}</span></div>`).join("")}</div>`;

  // By hour of day
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, "0")}:00 to ${String(h + 1).padStart(2, "0")}:00`, short: String(h).padStart(2, "0"), v: 0 }));
  list.forEach((a) => hours[new Date(a.created_at * 1000).getHours()].v++);
  const byHour = document.getElementById("byHour");
  if (tables.has("byHour")) byHour.innerHTML = simpleTable(["Hour", "Alerts"], hours.filter((h) => h.v).map((h) => [h.label, h.v]));
  else columns(byHour, hours, (v) => v);

  // Time to assign, per day (always the last 7 days so there is a trend to read)
  const dayPts = [];
  for (let i = 6; i >= 0; i--) {
    const s = new Date(); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - i);
    const start = s.getTime() / 1000, end = start + 86400;
    const inDay = alerts.filter((a) => a.ack_at && a.created_at >= start && a.created_at < end);
    const v = inDay.length ? Math.round(inDay.reduce((sum, a) => sum + (a.ack_at - a.created_at), 0) / inDay.length) : 0;
    dayPts.push({ label: s.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" }) + (inDay.length ? ` (${inDay.length} cases)` : " (no cases)"), short: i === 0 ? "Today" : s.toLocaleDateString("en-IN", { weekday: "short" }), v });
  }
  const byDay = document.getElementById("byDay");
  if (tables.has("byDay")) byDay.innerHTML = simpleTable(["Day", "Average"], dayPts.map((p) => [p.label, duration(p.v || null)]));
  else columns(byDay, dayPts, (v) => duration(v));

  // Busiest zones
  const zoneCount = new Map();
  list.forEach((a) => {
    const m = (a.message || "").match(/^(?:Entered (.+) area|No signal for \d+ min near (.+))$/);
    const z = m && (m[1] || m[2]);
    if (z) zoneCount.set(z, (zoneCount.get(z) || 0) + 1);
  });
  const zones = [...zoneCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  document.getElementById("zones").innerHTML = zones.length
    ? `<table class="ztable"><thead><tr><th>Zone</th><th style="text-align:right">Alerts</th></tr></thead><tbody>${zones.map(([z, n], i) => `<tr><td><span class="rank">${i + 1}</span>${esc(z)}</td><td class="n">${n}</td></tr>`).join("")}</tbody></table>`
    : `<div class="no-data">No risk-zone alerts in this period.</div>`;

  // Full list
  document.getElementById("alertTotal").textContent = `${list.length} alert${list.length === 1 ? "" : "s"}`;
  document.getElementById("alertTable").innerHTML = list.length ? `<thead><tr><th>Time</th><th>Type</th><th>Tourist</th><th>What happened</th><th>Channel</th><th>Status</th><th>Unit</th><th style="text-align:right">To assign</th></tr></thead>
    <tbody>${list.map((a) => `<tr>
      <td class="mono">${new Date(a.created_at * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ${clock(a.created_at)}</td>
      <td><span class="badge b-${a.type}">${(ALERT[a.type] || ALERT.SOS).label}</span></td>
      <td>${esc(a.tourist?.name || a.band_id || "")}</td>
      <td>${esc(a.message || (ALERT[a.type] || ALERT.SOS).text)}</td>
      <td>${via(a)}</td>
      <td><span class="badge b-${a.status}">${STATUS[a.status]}</span></td>
      <td>${esc(a.assigned_to || "–")}</td>
      <td class="n">${a.ack_at ? duration(a.ack_at - a.created_at) : "–"}</td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="muted">No alerts in this period. Run the mesh simulator to create some.</td></tr></tbody>`;
}

document.querySelectorAll("[data-table]").forEach((b) => b.addEventListener("click", () => {
  const k = b.dataset.table;
  tables.has(k) ? tables.delete(k) : tables.add(k);
  b.textContent = tables.has(k) ? "Show chart" : "Show table";
  render();
}));
document.querySelectorAll("#range .seg-btn").forEach((b) => b.addEventListener("click", () => {
  days = Number(b.dataset.days);
  document.querySelectorAll("#range .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  render();
}));
document.getElementById("btnPrint").onclick = () => window.print();
document.getElementById("btnCsv").onclick = () => {
  const from = periodStart();
  const rows = [["id", "time", "type", "tourist", "band", "message", "channel", "status", "unit", "lat", "lon", "seconds_to_assign"]];
  alerts.filter((a) => a.created_at >= from).forEach((a) => rows.push([
    a.id, new Date(a.created_at * 1000).toISOString(), a.type, a.tourist?.name || "", a.band_id || "", a.message || "",
    a.source, a.status, a.assigned_to || "", a.lat ?? "", a.lon ?? "", a.ack_at ? Math.round(a.ack_at - a.created_at) : "",
  ]));
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `suraksha-alerts-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
};

async function load() {
  try { alerts = await api("/api/alerts?limit=1000"); } catch (e) { alerts = []; }
  render();
}
load();
setInterval(load, 30000);
