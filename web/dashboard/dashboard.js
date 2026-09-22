const { api, live, esc, ago, clock, dist, duration, ALERT, toast, beep } = Suraksha;

const state = {
  alerts: new Map(), tourists: new Map(), geofences: [], places: [], gateways: new Map(),
  tab: "alerts", filter: "active", selected: null, fresh: new Set(), zoneMode: false,
};

// ------------------------------------------------------------------ map
const map = L.map("map", { zoomControl: true }).setView([25.5788, 91.8933], 13);
Suraksha.tiles(map);
const layers = {
  zones: L.layerGroup().addTo(map),
  places: L.layerGroup().addTo(map),
  gateways: L.layerGroup().addTo(map),
  tourists: L.layerGroup().addTo(map),
  alerts: L.layerGroup().addTo(map),
  focus: L.layerGroup().addTo(map),
};
L.control.layers(null, {
  "Risk zones": layers.zones, "Police &amp; hospitals": layers.places, "Mesh gateways": layers.gateways,
  "Tourists": layers.tourists, "Active alerts": layers.alerts,
}, { collapsed: true }).addTo(map);

const markers = { tourists: new Map(), alerts: new Map() };

function squareIcon(color, label) {
  return L.divIcon({ className: "", iconSize: [22, 22], html: `<div class="pin" style="width:22px;height:22px;border-radius:6px;background:${color}">${label}</div>` });
}

function drawZones() {
  layers.zones.clearLayers();
  for (const z of state.geofences) {
    const color = z.risk === "high" ? "#ef4444" : "#f59e0b";
    L.circle([z.lat, z.lon], { radius: z.radius_m, color, weight: 1.5, fillOpacity: 0.12, dashArray: "6 5" })
      .bindPopup(`<b>${esc(z.name)}</b><br><span class="badge b-${z.risk}">${z.risk} risk</span> · ${dist(z.radius_m)} radius
        <p class="muted" style="margin:6px 0">${esc(z.description || "")}</p>
        <button class="btn-sm btn-danger" onclick="deleteZone(${z.id})">Delete zone</button>`)
      .addTo(layers.zones);
  }
}

function drawPlaces() {
  layers.places.clearLayers();
  for (const p of state.places) {
    const police = p.kind === "police";
    L.marker([p.lat, p.lon], { icon: squareIcon(police ? "#3b82f6" : "#ec4899", police ? "P" : "H") })
      .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.phone || "")}`).addTo(layers.places);
  }
}

function drawGateways() {
  layers.gateways.clearLayers();
  for (const g of state.gateways.values()) {
    if (g.lat == null) continue;
    const online = Date.now() / 1000 - g.last_seen < 600;
    L.marker([g.lat, g.lon], {
      icon: L.divIcon({ className: "", iconSize: [18, 18], html: `<div class="pin" style="width:16px;height:16px;border-radius:3px;transform:rotate(45deg);background:${online ? "#2dd4bf" : "#64748b"}"></div>` }),
    }).bindPopup(`<b>${esc(g.name)}</b><br>${online ? "Online" : "Offline"} · ${g.packets} packets<br><span class="muted">Last seen ${ago(g.last_seen)}</span>`)
      .addTo(layers.gateways);
  }
}

function touristMarker(t) {
  if (t.last_lat == null) return;
  const alert = t.status === "alert";
  const icon = L.divIcon({
    className: "", iconSize: [18, 18],
    html: `<div class="pin ${alert ? "pulse" : ""}" style="width:16px;height:16px;background:${alert ? "#ef4444" : "#22c55e"}"></div>`,
  });
  let m = markers.tourists.get(t.id);
  if (!m) {
    m = L.marker([t.last_lat, t.last_lon], { icon }).addTo(layers.tourists);
    m.on("click", () => select("tourist", t.id));
    markers.tourists.set(t.id, m);
  } else {
    m.setLatLng([t.last_lat, t.last_lon]).setIcon(icon);
  }
  m.bindTooltip(`${esc(t.name)} · ${esc(t.band_id || "no band")}`);
}

function alertMarker(a) {
  const old = markers.alerts.get(a.id);
  if (old) { layers.alerts.removeLayer(old); markers.alerts.delete(a.id); }
  if (a.status === "resolved" || a.lat == null) return;
  const meta = ALERT[a.type] || ALERT.SOS;
  const m = L.marker([a.lat, a.lon], {
    zIndexOffset: 1000,
    icon: L.divIcon({ className: "", iconSize: [30, 30], html: `<div class="pin ${a.status === "open" ? "pulse" : ""}" style="width:30px;height:30px;background:${meta.color}">!</div>` }),
  }).addTo(layers.alerts);
  m.on("click", () => select("alert", a.id));
  markers.alerts.set(a.id, m);
}

// ------------------------------------------------------------------ header stats
async function loadStats() {
  const s = await api("/api/stats");
  const tiles = [
    ["Active tourists", s.active_tourists, `${s.tourists} registered`],
    ["Open alerts", s.open_alerts, "", s.open_alerts > 0],
    ["Responding", s.acknowledged],
    ["Resolved today", s.resolved_today],
    ["Avg response", duration(s.avg_response_s)],
    ["Gateways online", s.gateways_online],
  ];
  document.getElementById("stats").innerHTML = tiles.map(([k, v, sub, hot]) =>
    `<div class="stat ${hot ? "hot" : ""}" title="${esc(sub || "")}"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");
}
let statsTimer;
const refreshStats = () => { clearTimeout(statsTimer); statsTimer = setTimeout(loadStats, 250); };

// ------------------------------------------------------------------ side list
function renderList() {
  const list = document.getElementById("list");
  const alerts = [...state.alerts.values()];
  const activeCount = alerts.filter((a) => a.status !== "resolved").length;
  document.getElementById("alertCount").textContent = activeCount || "";
  document.getElementById("touristCount").textContent = state.tourists.size;

  if (state.tab === "alerts") {
    const shown = alerts
      .filter((a) => state.filter === "all" || (state.filter === "active" ? a.status !== "resolved" : a.status === "resolved"))
      .sort((a, b) => (a.status === "open") - (b.status === "open") || a.created_at - b.created_at).reverse();
    list.innerHTML = shown.length ? shown.map((a) => {
      const meta = ALERT[a.type] || ALERT.SOS;
      const via = a.source === "mesh" ? `Mesh · ${a.hop_count} hop${a.hop_count === 1 ? "" : "s"}` : a.source.toUpperCase();
      return `<div class="item ${state.selected?.id === a.id && state.selected.kind === "alert" ? "sel" : ""} ${state.fresh.has(a.id) ? "fresh" : ""}" data-kind="alert" data-id="${a.id}">
        <div class="row"><span class="badge b-${a.type}">${meta.label}</span><span class="badge b-${a.status}">${a.status}</span></div>
        <div class="name">${esc(a.tourist?.name || a.band_id || "Unknown band")}</div>
        <div class="meta">${esc(a.message || meta.text)}</div>
        <div class="row meta"><span>${via}</span><span>${ago(a.created_at)}</span></div>
      </div>`;
    }).join("") : `<div class="empty-list">${state.filter === "active" ? "No active alerts. All tourists are safe." : "Nothing here yet."}</div>`;
  } else {
    const q = document.getElementById("touristSearch").value.trim().toLowerCase();
    const shown = [...state.tourists.values()]
      .filter((t) => !q || [t.name, t.band_id, t.id, t.nationality].some((v) => (v || "").toLowerCase().includes(q)))
      .sort((a, b) => (b.status === "alert") - (a.status === "alert") || a.name.localeCompare(b.name));
    list.innerHTML = shown.map((t) => `<div class="item ${state.selected?.id === t.id ? "sel" : ""}" data-kind="tourist" data-id="${t.id}">
        <div class="row"><span class="name">${esc(t.name)}</span><span class="badge b-${t.status}">${t.status}</span></div>
        <div class="meta">${esc(t.nationality || "")} · ${esc(t.band_id || "no band")} · <span class="mono">${esc(t.id)}</span></div>
        <div class="row meta"><span class="${t.battery != null && t.battery < 20 ? "battery-low" : ""}">Battery ${t.battery ?? "–"}%</span><span>Seen ${ago(t.last_seen)}</span></div>
      </div>`).join("") || `<div class="empty-list">No tourists match.</div>`;
  }
}

document.getElementById("list").addEventListener("click", (e) => {
  const it = e.target.closest(".item");
  if (it) select(it.dataset.kind, it.dataset.kind === "alert" ? Number(it.dataset.id) : it.dataset.id);
});
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
  state.tab = b.dataset.tab;
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
  document.getElementById("alertFilters").classList.toggle("hidden", state.tab !== "alerts");
  document.getElementById("touristFilters").classList.toggle("hidden", state.tab !== "tourists");
  renderList();
}));
document.querySelectorAll("#alertFilters .chip").forEach((b) => b.addEventListener("click", () => {
  state.filter = b.dataset.f;
  document.querySelectorAll("#alertFilters .chip").forEach((x) => x.classList.toggle("active", x === b));
  renderList();
}));
document.getElementById("touristSearch").addEventListener("input", renderList);

// ------------------------------------------------------------------ detail panel
function select(kind, id) {
  state.selected = { kind, id };
  state.fresh.delete(id);
  renderList();
  renderDetail(true);
}

function helpRows(items) {
  return (items || []).map((p) => `<div class="help"><span>${esc(p.name)}<br><span class="muted">${esc(p.phone || "")}</span></span><b>${dist(p.distance_m)}</b></div>`).join("") || `<span class="muted">None nearby</span>`;
}

function touristBlock(t) {
  if (!t) return `<div class="d-sec"><h4>Tourist</h4><span class="muted">This band is not linked to a registered tourist.</span></div>`;
  return `<div class="d-sec"><h4>Tourist</h4><div class="kv">
      <span class="k">Name</span><span><b>${esc(t.name)}</b></span>
      <span class="k">Nationality</span><span>${esc(t.nationality || "–")}</span>
      <span class="k">Phone</span><span>${esc(t.phone || "–")}</span>
      <span class="k">ID document</span><span class="mono">${esc(t.id_doc || "–")}</span>
      <span class="k">Blood group</span><span><b>${esc(t.blood_group || "–")}</b></span>
      <span class="k">Band</span><span class="mono">${esc(t.band_id || "–")} · ${t.battery ?? "–"}%</span>
      <span class="k">Emergency</span><span>${esc(t.emergency_name || "–")}<br>${esc(t.emergency_phone || "")}</span>
      <span class="k">Trip</span><span>${esc(t.trip_start || "?")} → ${esc(t.trip_end || "?")}</span>
      <span class="k">Digital ID</span><span class="mono" title="${esc(t.digital_id)}">${esc(t.id)} · ${esc((t.digital_id || "").slice(0, 12))}…</span>
    </div>${t.medical_notes ? `<div class="medical"><b>Medical:</b> ${esc(t.medical_notes)}</div>` : ""}</div>`;
}

async function renderDetail(focus = false) {
  const el = document.getElementById("detail");
  const sel = state.selected;
  if (!sel) return;
  layers.focus.clearLayers();

  if (sel.kind === "alert") {
    const a = state.alerts.get(sel.id);
    if (!a) return;
    const meta = ALERT[a.type] || ALERT.SOS;
    const hops = a.hops || [];
    el.innerHTML = `
      <div class="d-head">
        <div class="row" style="display:flex;gap:6px"><span class="badge b-${a.type}">${meta.label}</span><span class="badge b-${a.status}">${a.status}</span></div>
        <h2>${esc(a.tourist?.name || a.band_id || "Unknown band")}</h2>
        <div class="muted">${esc(a.message || meta.text)}</div>
      </div>
      <div class="d-sec"><h4>Response</h4>
        ${a.status === "resolved" ? `<div class="muted">Resolved${a.notes ? ": " + esc(a.notes) : ""}</div>` : `
        <input id="responder" placeholder="Responder / unit (e.g. PCR Van 12)" value="${esc(a.assigned_to || "")}">
        <textarea id="notes" rows="2" placeholder="Notes" style="margin-top:8px">${esc(a.notes || "")}</textarea>
        <div class="actions-row" style="margin-top:10px">
          ${a.status === "open" ? `<button class="btn-primary" onclick="actAlert(${a.id},'ack')">Acknowledge &amp; dispatch</button>` : ""}
          <button onclick="actAlert(${a.id},'resolve')">Mark resolved</button>
          ${a.tourist?.phone ? `<a class="btn" href="tel:${esc(a.tourist.phone)}">Call tourist</a>` : ""}
        </div>`}
      </div>
      <div class="d-sec"><h4>Timeline</h4><div class="timeline">
        <div><span class="t">${clock(a.created_at)}</span><span>Alert received via <b>${esc(a.source)}</b>${a.gateway_id ? ` (${esc(a.gateway_id)})` : ""}</span></div>
        ${a.ack_at ? `<div><span class="t">${clock(a.ack_at)}</span><span>Acknowledged by ${esc(a.assigned_to || "Control Room")} · ${duration(a.ack_at - a.created_at)}</span></div>` : ""}
        ${a.resolved_at ? `<div><span class="t">${clock(a.resolved_at)}</span><span>Resolved</span></div>` : ""}
      </div></div>
      <div class="d-sec"><h4>Location</h4><div class="kv">
        <span class="k">Coordinates</span><span class="mono">${a.lat != null ? `${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}` : "Unknown"}</span>
        <span class="k">Band battery</span><span class="${a.battery != null && a.battery < 20 ? "battery-low" : ""}">${a.battery ?? "–"}%</span>
      </div>
      ${a.lat != null ? `<div class="actions-row" style="margin-top:8px"><a class="btn btn-sm" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}">Navigate</a></div>` : ""}
      </div>
      ${hops.length ? `<div class="d-sec"><h4>Mesh path · ${a.hop_count} radio hop${a.hop_count === 1 ? "" : "s"}</h4>
        <div class="path">${hops.map((h, i) => `<span class="${h.startsWith("GW") ? "gw" : ""}">${esc(h)}</span>${i < hops.length - 1 ? "<b>→</b>" : ""}`).join("")}</div></div>` : ""}
      ${touristBlock(a.tourist)}
      <div class="d-sec"><h4>Nearest police</h4>${helpRows(a.nearest_police)}</div>
      <div class="d-sec"><h4>Nearest hospital</h4>${helpRows(a.nearest_hospital)}</div>`;

    if (a.lat != null) {
      drawMeshPath(a);
      if (a.nearest_police?.[0]) {
        const p = a.nearest_police[0];
        L.polyline([[p.lat, p.lon], [a.lat, a.lon]], { color: "#3b82f6", weight: 2, dashArray: "4 6" }).addTo(layers.focus);
      }
      if (focus) map.flyTo([a.lat, a.lon], Math.max(map.getZoom(), 15), { duration: 0.8 });
    }
  } else {
    const t = state.tourists.get(sel.id);
    if (!t) return;
    const history = [...state.alerts.values()].filter((a) => a.tourist_id === t.id).sort((a, b) => b.created_at - a.created_at);
    el.innerHTML = `
      <div class="d-head"><span class="badge b-${t.status}">${t.status}</span><h2>${esc(t.name)}</h2>
        <div class="muted">Last seen ${ago(t.last_seen)}</div></div>
      ${touristBlock(t)}
      <div class="d-sec"><h4>Alert history</h4>${history.map((a) => `<div class="help" style="cursor:pointer" onclick="select('alert',${a.id})"><span><span class="badge b-${a.type}">${a.type}</span> ${esc(a.message || "")}</span><span class="muted">${ago(a.created_at)}</span></div>`).join("") || `<span class="muted">No alerts</span>`}</div>
      <div class="d-sec"><h4>Movement</h4><span class="muted">The track is drawn on the map in teal.</span></div>`;
    const track = await api(`/api/tourists/${t.id}/track`);
    if (track.length > 1) L.polyline(track.map((p) => [p.lat, p.lon]), { color: "#2dd4bf", weight: 3, opacity: 0.8 }).addTo(layers.focus);
    if (focus && t.last_lat != null) map.flyTo([t.last_lat, t.last_lon], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }
}

function drawMeshPath(a) {
  // Plot the relay chain for nodes whose positions we know (tourist bands and gateways).
  const pos = (id) => {
    const g = state.gateways.get(id);
    if (g && g.lat != null) return [g.lat, g.lon];
    const t = [...state.tourists.values()].find((x) => x.band_id === id);
    return t && t.last_lat != null ? [t.last_lat, t.last_lon] : null;
  };
  const pts = (a.hops || []).map(pos).filter(Boolean);
  if (pts.length) pts[0] = [a.lat, a.lon];
  if (pts.length > 1) L.polyline(pts, { color: "#2dd4bf", weight: 3, dashArray: "2 8", lineCap: "round" }).addTo(layers.focus);
}

window.select = select;
window.actAlert = async (id, action) => {
  const responder = document.getElementById("responder")?.value.trim();
  const notes = document.getElementById("notes")?.value.trim();
  try {
    await api(`/api/alerts/${id}/${action}`, { method: "POST", body: { responder: responder || null, notes: notes || null } });
    toast(action === "ack" ? "Alert acknowledged. The tourist has been notified." : "Alert resolved.");
  } catch (e) { toast(esc(e.message), "danger"); }
};

// ------------------------------------------------------------------ modals
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modalBody");
function openModal(html) { modalBody.innerHTML = html; modal.classList.add("show"); }
window.closeModal = () => modal.classList.remove("show");
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

document.getElementById("btnAdvisory").onclick = () => openModal(`
  <h3>Broadcast advisory</h3><p class="muted">Sent live to every tourist app, e.g. weather or landslide warnings.</p>
  <label>Message</label><textarea id="advMsg" rows="3" placeholder="Heavy rain expected near Cherrapunji after 4 PM. Avoid trekking routes."></textarea>
  <label>Level</label><select id="advLevel"><option value="warning">Warning</option><option value="danger">Danger</option><option value="info">Info</option></select>
  <div class="actions"><button onclick="closeModal()">Cancel</button><button class="btn-primary" id="advSend">Send to all tourists</button></div>`);
modalBody.addEventListener("click", async (e) => {
  if (e.target.id === "advSend") {
    const message = document.getElementById("advMsg").value.trim();
    if (!message) return;
    await api("/api/advisories", { method: "POST", body: { message, level: document.getElementById("advLevel").value } });
    closeModal(); toast("Advisory broadcast to all tourists.");
  }
  if (e.target.id === "zoneSave") {
    const d = modalBody.dataset;
    const body = {
      name: document.getElementById("zName").value.trim() || "Unnamed zone",
      risk: document.getElementById("zRisk").value,
      radius_m: Number(document.getElementById("zRadius").value) || 300,
      description: document.getElementById("zDesc").value.trim(),
      lat: Number(d.lat), lon: Number(d.lon),
    };
    await api("/api/geofences", { method: "POST", body });
    closeModal(); toast("Risk zone created. Tourist apps have been updated.");
  }
});

function setZoneMode(on) {
  state.zoneMode = on;
  document.getElementById("zoneHint").classList.toggle("hidden", !on);
  document.getElementById("map").style.cursor = on ? "crosshair" : "";
}
document.getElementById("btnZone").onclick = () => setZoneMode(true);
document.getElementById("zoneCancel").onclick = () => setZoneMode(false);
map.on("click", (e) => {
  if (!state.zoneMode) return;
  setZoneMode(false);
  openModal(`<h3>New risk zone</h3><p class="muted mono">${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</p>
    <label>Name</label><input id="zName" placeholder="Landslide-prone road">
    <label>Risk level</label><select id="zRisk"><option value="high">High: raises an alert on entry</option><option value="medium">Medium: warns the tourist</option></select>
    <label>Radius (m)</label><input id="zRadius" type="number" value="400" min="50">
    <label>Advice shown to tourists</label><input id="zDesc" placeholder="Road closed after dark">
    <div class="actions"><button onclick="closeModal()">Cancel</button><button class="btn-primary" id="zoneSave">Create zone</button></div>`);
  modalBody.dataset.lat = e.latlng.lat;
  modalBody.dataset.lon = e.latlng.lng;
});
window.deleteZone = async (id) => {
  if (!confirm("Delete this risk zone?")) return;
  await api(`/api/geofences/${id}`, { method: "DELETE" });
  map.closePopup();
};

document.getElementById("btnReset").onclick = async () => {
  if (!confirm("Clear all alerts and mark every tourist safe? (demo only)")) return;
  await api("/api/demo/reset", { method: "POST" });
};

// ------------------------------------------------------------------ live events
function upsertAlert(a) {
  state.alerts.set(a.id, a);
  if (a.tourist) state.tourists.set(a.tourist.id, a.tourist);
  alertMarker(a);
}

function onEvent(ev, d) {
  if (ev === "alert_new") {
    upsertAlert(d);
    state.fresh.add(d.id);
    const meta = ALERT[d.type] || ALERT.SOS;
    beep(d.type === "SOS" || d.type === "FALL" ? 4 : 2);
    toast(`<b>${meta.label}: ${esc(d.tourist?.name || d.band_id)}</b><br><span class="muted">${esc(d.message || meta.text)} · via ${esc(d.source)}${d.source === "mesh" ? ` (${d.hop_count} hops)` : ""}</span>`, "danger", 8000);
    if (!state.selected || state.alerts.get(state.selected.id)?.status === "resolved") select("alert", d.id);
    if (state.tab === "alerts" && state.filter === "resolved") document.querySelector('[data-f="active"]').click();
  } else if (ev === "alert_update") {
    upsertAlert(d);
  } else if (ev === "tourist_update" && d) {
    state.tourists.set(d.id, d);
    touristMarker(d);
  } else if (ev === "geofences_changed") {
    state.geofences = d; drawZones();
  } else if (ev === "gateway_update" && d) {
    state.gateways.set(d.id, d); drawGateways();
  } else if (ev === "reset") {
    return boot();
  }
  renderList();
  if (state.selected && (ev.startsWith("alert") || ev === "tourist_update")) {
    const s = state.selected;
    if ((s.kind === "alert" && d.id === s.id) || (s.kind === "tourist" && (d.id === s.id || d.tourist_id === s.id)) || ev === "alert_new") renderDetail(false);
  }
  refreshStats();
}

async function boot() {
  const [alerts, tourists, geofences, places, gateways] = await Promise.all([
    api("/api/alerts?limit=300"), api("/api/tourists"), api("/api/geofences"), api("/api/places"), api("/api/gateways"),
  ]);
  state.alerts.clear(); state.tourists.clear(); state.gateways.clear();
  markers.alerts.forEach((m) => layers.alerts.removeLayer(m)); markers.alerts.clear();
  tourists.forEach((t) => { state.tourists.set(t.id, t); touristMarker(t); });
  alerts.forEach(upsertAlert);
  gateways.forEach((g) => state.gateways.set(g.id, g));
  state.geofences = geofences; state.places = places;
  drawZones(); drawPlaces(); drawGateways();
  if (state.selected && !(state.selected.kind === "alert" ? state.alerts.has(state.selected.id) : state.tourists.has(state.selected.id))) {
    state.selected = null;
    layers.focus.clearLayers();
    document.getElementById("detail").innerHTML = `<div class="empty"><h3>No alert selected</h3><p class="muted">Pick an alert or tourist from the list.</p></div>`;
  }
  renderList();
  loadStats();
}

live(onEvent, (ok) => {
  document.getElementById("liveDot").className = "dot " + (ok ? "on" : "off");
  document.getElementById("liveText").textContent = ok ? "Live feed connected" : "Reconnecting…";
  if (ok) boot();
});
setInterval(() => { renderList(); loadStats(); drawGateways(); }, 30000);
