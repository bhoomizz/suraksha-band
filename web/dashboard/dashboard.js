const { api, live, esc, ago, clock, dist, duration, ALERT, STATUS, via, toast, beep } = Suraksha;

const UNITS = ["PCR Van 12", "PCR Van 04", "Tourist Police Unit 2", "108 Ambulance, Shillong", "SDRF Team, Umiam"];
const store = {
  get(k, d) { try { return localStorage.getItem("control." + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("control." + k, v); } catch { /* storage blocked */ } },
};

const state = {
  alerts: new Map(), tourists: new Map(), geofences: [], places: [], gateways: new Map(),
  tab: location.hash === "#tourists" ? "tourists" : "alerts", filter: "active", selected: null, fresh: new Set(), zoneMode: false,
  officer: store.get("officer", "Insp. R. Lyngdoh"),
};

// ------------------------------------------------------------------ duty officer
function drawOfficer() {
  document.getElementById("officerName").textContent = state.officer;
  const initials = state.officer.replace(/^(Insp|SI|ASI|Const|HC|Dy\.? ?SP)\.?\s+/i, "").split(/[\s.]+/).filter(Boolean);
  document.getElementById("officerInit").textContent = ((initials[0] || "?")[0] + (initials[initials.length - 1] || "")[0]).toUpperCase();
}
document.getElementById("officer").onclick = () => {
  const name = prompt("Duty officer name", state.officer);
  if (name && name.trim()) { state.officer = name.trim(); store.set("officer", state.officer); drawOfficer(); }
};
drawOfficer();

// ------------------------------------------------------------------ map
const map = L.map("map", { zoomControl: false }).setView([25.5700, 91.8800], 13);
L.control.zoom({ position: "topright" }).addTo(map);
Suraksha.tiles(map);
const layers = {
  zones: L.layerGroup().addTo(map), places: L.layerGroup().addTo(map), gateways: L.layerGroup().addTo(map),
  tourists: L.layerGroup().addTo(map), alerts: L.layerGroup().addTo(map), focus: L.layerGroup().addTo(map),
};
L.control.layers(null, {
  "Risk zones": layers.zones, "Police and hospitals": layers.places, "Mesh gateways": layers.gateways,
  "Tourists": layers.tourists, "Open alerts": layers.alerts,
}, { position: "topright" }).addTo(map);
const markers = { tourists: new Map(), alerts: new Map() };

const squareIcon = (color, label) => L.divIcon({ className: "", iconSize: [20, 20], html: `<div class="pin" style="width:20px;height:20px;border-radius:5px;background:${color}">${label}</div>` });

function drawZones() {
  layers.zones.clearLayers();
  for (const z of state.geofences) {
    const color = z.risk === "high" ? "#BA1A1A" : "#B7791F";
    L.circle([z.lat, z.lon], { radius: z.radius_m, color, weight: 1.5, fillOpacity: 0.08, dashArray: "5 5" })
      .bindPopup(`<b>${esc(z.name)}</b><br><span class="badge b-${z.risk}">${z.risk === "high" ? "High risk" : "Medium risk"}</span> <span class="muted">${dist(z.radius_m)} radius</span>
        <p style="margin:8px 0">${esc(z.description || "")}</p>
        <button class="btn-sm btn-danger-outline" onclick="deleteZone(${z.id})">Remove zone</button>`)
      .addTo(layers.zones);
  }
}

function drawPlaces() {
  layers.places.clearLayers();
  for (const p of state.places) {
    const police = p.kind === "police";
    L.marker([p.lat, p.lon], { icon: squareIcon(police ? "#2B6CB0" : "#8B3A62", police ? "P" : "H") })
      .bindPopup(`<b>${esc(p.name)}</b><br><a href="tel:${esc(p.phone)}">${esc(p.phone || "")}</a>`).addTo(layers.places);
  }
}

function drawGateways() {
  layers.gateways.clearLayers();
  for (const g of state.gateways.values()) {
    if (g.lat == null) continue;
    const online = Date.now() / 1000 - g.last_seen < 600;
    L.marker([g.lat, g.lon], {
      icon: L.divIcon({ className: "", iconSize: [16, 16], html: `<div class="pin" style="width:14px;height:14px;border-radius:3px;transform:rotate(45deg);background:${online ? "#00432A" : "#9AA39C"}"></div>` }),
    }).bindPopup(`<b>${esc(g.name)}</b><br>${online ? "Online" : "Offline"} · ${g.packets} messages relayed<br><span class="muted">Last heard ${ago(g.last_seen)}</span>`)
      .addTo(layers.gateways);
  }
}

function touristMarker(t) {
  if (t.last_lat == null) return;
  const alert = t.status === "alert";
  const icon = L.divIcon({ className: "", iconSize: [16, 16], html: `<div class="pin" style="width:14px;height:14px;background:${alert ? "#BA1A1A" : "#1E5B3F"}"></div>` });
  let m = markers.tourists.get(t.id);
  if (!m) {
    m = L.marker([t.last_lat, t.last_lon], { icon }).addTo(layers.tourists);
    m.on("click", () => select("tourist", t.id));
    markers.tourists.set(t.id, m);
  } else m.setLatLng([t.last_lat, t.last_lon]).setIcon(icon);
  m.bindTooltip(`${esc(t.name)} · ${esc(t.band_id || "no band")}`);
}

function alertMarker(a) {
  const old = markers.alerts.get(a.id);
  if (old) { layers.alerts.removeLayer(old); markers.alerts.delete(a.id); }
  if (a.status === "resolved" || a.lat == null) return;
  const meta = ALERT[a.type] || ALERT.SOS;
  const m = L.marker([a.lat, a.lon], {
    zIndexOffset: 1000,
    icon: L.divIcon({ className: "", iconSize: [26, 26], html: `<div class="pin ${a.status === "open" ? "pulse" : ""}" style="width:26px;height:26px;background:${meta.color}"><span class="ms" style="font-size:16px;color:#fff">priority_high</span></div>` }),
  }).addTo(layers.alerts);
  m.on("click", () => select("alert", a.id));
  markers.alerts.set(a.id, m);
}

// ------------------------------------------------------------------ metrics strip
async function loadStats() {
  const s = await api("/api/stats");
  document.getElementById("stats").innerHTML = `
    <span><b>${s.active_tourists}</b> tourists active</span>
    <span class="${s.open_alerts ? "hot" : ""}"><span class="dot" style="background:${s.open_alerts ? "var(--danger)" : "var(--ok)"}"></span><b>${s.open_alerts}</b> open alert${s.open_alerts === 1 ? "" : "s"}</span>
    <span><b>${s.acknowledged}</b> being handled</span>
    <span><b>${s.resolved_today}</b> closed today</span>
    <span class="push">Average response <b>${duration(s.avg_response_s)}</b></span>
    <span><span class="dot ${s.gateways_online ? "on" : "off"}"></span>Gateways <b>${s.gateways_online} of ${state.gateways.size || s.gateways_online}</b> online</span>`;
}
let statsTimer;
const refreshStats = () => { clearTimeout(statsTimer); statsTimer = setTimeout(loadStats, 250); };

// ------------------------------------------------------------------ list
function renderList() {
  const list = document.getElementById("list");
  const alerts = [...state.alerts.values()];
  const open = alerts.filter((a) => a.status !== "resolved").length;
  document.getElementById("openCount").textContent = open ? `(${open})` : "";

  if (state.tab === "alerts") {
    const shown = alerts
      .filter((a) => state.filter === "all" || (state.filter === "active" ? a.status !== "resolved" : a.status === "resolved"))
      .sort((a, b) => (b.status === "open") - (a.status === "open") || b.created_at - a.created_at);
    list.innerHTML = shown.length ? shown.map((a) => {
      const meta = ALERT[a.type] || ALERT.SOS;
      const sel = state.selected?.kind === "alert" && state.selected.id === a.id;
      return `<div class="item t-${a.type} st-${a.status} ${sel ? "sel" : ""} ${state.fresh.has(a.id) ? "fresh" : ""}" data-kind="alert" data-id="${a.id}">
        <div class="row"><div class="who"><span class="badge b-${a.type}">${meta.label}</span><span class="name">${esc(a.tourist?.name || a.band_id || "Unknown band")}</span></div><span class="time">${ago(a.created_at)}</span></div>
        <div class="msg">${esc(a.message || meta.text)}</div>
        <div class="row foot"><span>${via(a)}</span><b>${STATUS[a.status]}${a.assigned_to && a.status === "acknowledged" ? ` · ${esc(a.assigned_to)}` : ""}</b></div>
      </div>`;
    }).join("") : state.filter === "active"
      ? `<div class="empty-list"><span class="ms">verified_user</span>No open alerts. Everyone is marked safe.</div>`
      : `<div class="empty-list">Nothing here yet.</div>`;
  } else {
    const q = document.getElementById("touristSearch").value.trim().toLowerCase();
    const shown = [...state.tourists.values()]
      .filter((t) => !q || [t.name, t.band_id, t.id, t.home_state].some((v) => (v || "").toLowerCase().includes(q)))
      .sort((a, b) => (b.status === "alert") - (a.status === "alert") || a.name.localeCompare(b.name));
    list.innerHTML = shown.map((t) => {
      const sel = state.selected?.kind === "tourist" && state.selected.id === t.id;
      return `<div class="item tourist-${t.status} ${sel ? "sel" : ""}" data-kind="tourist" data-id="${t.id}">
        <div class="row"><span class="name">${esc(t.name)}</span><span class="badge b-${t.status}">${STATUS[t.status]}</span></div>
        <div class="msg">${esc(t.home_state || t.nationality || "")} · <span class="mono">${esc(t.band_id || "no band")}</span></div>
        <div class="row foot"><span class="${t.battery != null && t.battery < 20 ? "low" : ""}">Battery ${t.battery ?? "–"}%</span><span>Seen ${ago(t.last_seen)}</span></div>
      </div>`;
    }).join("") || `<div class="empty-list">No tourist matches that search.</div>`;
  }
}

document.getElementById("list").addEventListener("click", (e) => {
  const it = e.target.closest(".item");
  if (it) select(it.dataset.kind, it.dataset.kind === "alert" ? Number(it.dataset.id) : it.dataset.id);
});
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  document.querySelectorAll(".rail [data-tab-link]").forEach((x) => x.classList.toggle("active", x.dataset.tabLink === tab));
  document.getElementById("alertFilters").classList.toggle("hidden", tab !== "alerts");
  document.getElementById("touristFilters").classList.toggle("hidden", tab !== "tourists");
  history.replaceState(null, "", tab === "tourists" ? "#tourists" : location.pathname);
  renderList();
}
document.querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
document.querySelectorAll(".rail [data-tab-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); setTab(a.dataset.tabLink); }));
document.querySelectorAll("#alertFilters .chip").forEach((b) => b.addEventListener("click", () => {
  state.filter = b.dataset.f;
  document.querySelectorAll("#alertFilters .chip").forEach((x) => x.classList.toggle("active", x === b));
  renderList();
}));
document.getElementById("touristSearch").addEventListener("input", renderList);

// ------------------------------------------------------------------ case file
function emptyDetail() {
  document.getElementById("detail").innerHTML = `<div class="empty">
    <span class="ms">folder_open</span>
    <h3>No case selected</h3>
    <p>Pick an alert or a tourist from the list, or click a marker on the map.</p>
    <div class="channels">
      <div><span class="ms">hub</span><span><b>Mesh.</b> Passed from band to band over LoRa radio, then sent in by a gateway. Works without mobile network.</span></div>
      <div><span class="ms">smartphone</span><span><b>App.</b> Sent from the tourist's phone over the internet.</span></div>
      <div><span class="ms">sms</span><span><b>SMS.</b> Text message fallback when there is no data connection.</span></div>
      <div><span class="ms">radar</span><span><b>Automatic.</b> Raised by the server when a tourist enters a risk zone or goes quiet.</span></div>
    </div></div>`;
}

function select(kind, id) {
  state.selected = { kind, id };
  state.fresh.delete(id);
  renderList();
  renderDetail(true);
}

function battery(v) {
  if (v == null) return "–";
  return `<span class="battery ${v < 20 ? "lowbat" : ""}"><span class="bar"><i style="width:${Math.max(3, v)}%"></i></span><b>${v}%</b></span>`;
}

function helpBox(kind, p) {
  if (!p) return `<div class="box"><div class="kind ${kind}">${kind === "police" ? "Police station" : "Hospital"}</div><div class="sub">None nearby</div></div>`;
  return `<div class="box"><div class="kind ${kind}">${kind === "police" ? "Police station" : "Hospital"}</div>
    <div class="nm">${esc(p.name)}</div><div class="sub">${dist(p.distance_m)} away</div>
    ${p.phone ? `<a href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ""}</div>`;
}

function touristSection(t) {
  if (!t) return `<div class="sec"><span class="label">Tourist</span><p class="muted" style="margin:0">This band is not linked to a registered tourist.</p></div>`;
  return `<div class="sec"><span class="label">Tourist profile</span><div class="kv">
      <span class="k">Phone</span><span class="mono">${esc(t.phone || "–")}</span>
      <span class="k">From</span><span>${esc(t.home_state || "–")}${t.nationality && t.nationality !== "Indian" ? ` (${esc(t.nationality)})` : ""}</span>
      <span class="k">ID document</span><span class="mono">${esc(t.id_doc || "–")}</span>
      <span class="k">Blood group</span><span class="blood">${esc(t.blood_group || "–")}</span>
      <span class="k">Emergency contact</span><span>${esc(t.emergency_name || "–")}<br><span class="mono">${esc(t.emergency_phone || "")}</span></span>
      <span class="k">Trip</span><span>${esc(t.trip_start || "?")} to ${esc(t.trip_end || "?")}</span>
      <span class="k">Tourist ID</span><span class="mono" title="${esc(t.digital_id)}">${esc(t.id)}</span>
    </div>${t.medical_notes ? `<div class="medical"><span class="ms">medical_information</span><span><b>Medical:</b> ${esc(t.medical_notes)}</span></div>` : ""}</div>`;
}

async function renderDetail(focus = false) {
  const el = document.getElementById("detail");
  const sel = state.selected;
  if (!sel) return;
  layers.focus.clearLayers();

  if (sel.kind === "alert") {
    const a = state.alerts.get(sel.id);
    if (!a) return emptyDetail();
    const meta = ALERT[a.type] || ALERT.SOS;
    const hops = a.hops || [];
    const t = a.tourist;
    el.innerHTML = `
      <div class="case-head">
        <div class="tags"><span class="badge b-${a.type}">${meta.label}</span><span class="badge b-${a.status}">${STATUS[a.status]}</span><span class="mono muted" style="margin-left:auto">Case #${String(a.id).padStart(4, "0")}</span></div>
        <h2>${esc(t?.name || a.band_id || "Unknown band")}</h2>
        <p>${esc(a.message || meta.text)} · ${via(a)}</p>
      </div>
      <div class="sec"><span class="label">Response</span>
        ${a.status === "resolved" ? `<div class="box">Closed${a.assigned_to ? ` by ${esc(a.assigned_to)}` : ""}.${a.notes ? `<br><span class="muted">${esc(a.notes)}</span>` : ""}</div>` : `
        <div class="box">
          <label style="margin-top:0" for="responder">Unit</label>
          <input id="responder" list="units" placeholder="e.g. PCR Van 12" value="${esc(a.assigned_to || "")}">
          <datalist id="units">${UNITS.map((u) => `<option value="${esc(u)}">`).join("")}</datalist>
          <label for="notes">Notes</label>
          <textarea id="notes" rows="2" placeholder="What was done, who was contacted">${esc(a.notes || "")}</textarea>
          <div class="btn-row">
            ${a.status === "open" ? `<button class="btn-primary" onclick="actAlert(${a.id},'ack')"><span class="ms">local_police</span>Assign unit</button>` : ""}
            <button onclick="actAlert(${a.id},'resolve')"><span class="ms">task_alt</span>Close case</button>
          </div>
          ${t?.phone ? `<div class="btn-row"><a class="btn" href="tel:${esc(t.phone)}"><span class="ms">call</span>Call tourist</a>${t.emergency_phone ? `<a class="btn" href="tel:${esc(t.emergency_phone)}"><span class="ms">family_restroom</span>Call family</a>` : ""}</div>` : ""}
        </div>`}
      </div>
      <div class="sec"><span class="label">Timeline</span><div class="timeline">
        <div class="tl"><span class="t">${clock(a.created_at)}</span><span class="d"></span><span>Alert received ${a.gateway_id ? `through ${esc(state.gateways.get(a.gateway_id)?.name || a.gateway_id)}` : via(a)}</span></div>
        <div class="tl ${a.ack_at ? "" : "pending"}"><span class="t">${a.ack_at ? clock(a.ack_at) : "--:--"}</span><span class="d"></span><span>${a.ack_at ? `Assigned to ${esc(a.assigned_to || "control room")} (${duration(a.ack_at - a.created_at)})` : "Waiting for a unit"}</span></div>
        <div class="tl ${a.resolved_at ? "" : "pending"}"><span class="t">${a.resolved_at ? clock(a.resolved_at) : "--:--"}</span><span class="d"></span><span>${a.resolved_at ? "Case closed" : "Not closed yet"}</span></div>
      </div></div>
      <div class="sec"><span class="label">Location</span><div class="kv">
        <span class="k">Coordinates</span><span class="mono">${a.lat != null ? `${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}` : "Unknown"}</span>
        <span class="k">Band battery</span><span>${battery(a.battery ?? t?.battery)}</span>
        ${a.lat != null ? `<span class="k"></span><span><a target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lon}">Get directions</a></span>` : ""}
      </div></div>
      ${hops.length > 1 ? `<div class="sec"><span class="label">How it reached us · ${a.hop_count} hop${a.hop_count === 1 ? "" : "s"}</span>
        <div class="route">${hops.map((h, i) => `<span class="${h.startsWith("GW") ? "gw" : ""}">${esc(h.startsWith("GW") ? (state.gateways.get(h)?.name || h) : h)}</span>${i < hops.length - 1 ? '<span class="ms">arrow_forward</span>' : ""}`).join("")}</div></div>` : ""}
      ${touristSection(t)}
      <div class="sec"><span class="label">Closest help</span><div class="help-grid">${helpBox("police", a.nearest_police?.[0])}${helpBox("hospital", a.nearest_hospital?.[0])}</div></div>`;

    if (a.lat != null) {
      drawRoute(a);
      const p = a.nearest_police?.[0];
      if (p) L.polyline([[p.lat, p.lon], [a.lat, a.lon]], { color: "#2B6CB0", weight: 2, dashArray: "3 6" }).addTo(layers.focus);
      if (focus) map.flyTo([a.lat, a.lon], Math.max(map.getZoom(), 15), { duration: 0.7 });
    }
  } else {
    const t = state.tourists.get(sel.id);
    if (!t) return emptyDetail();
    const history = [...state.alerts.values()].filter((a) => a.tourist_id === t.id).sort((a, b) => b.created_at - a.created_at);
    el.innerHTML = `
      <div class="case-head">
        <div class="tags"><span class="badge b-${t.status}">${STATUS[t.status]}</span><span class="mono muted" style="margin-left:auto">${esc(t.band_id || "No band")}</span></div>
        <h2>${esc(t.name)}</h2>
        <p>Last seen ${ago(t.last_seen)} · battery ${t.battery ?? "–"}%</p>
      </div>
      <div class="sec"><div class="btn-row" style="margin-top:0">
        ${t.phone ? `<a class="btn" href="tel:${esc(t.phone)}"><span class="ms">call</span>Call tourist</a>` : ""}
        ${t.emergency_phone ? `<a class="btn" href="tel:${esc(t.emergency_phone)}"><span class="ms">family_restroom</span>Call family</a>` : ""}
      </div></div>
      ${touristSection(t)}
      <div class="sec"><span class="label">Alerts on this trip</span><div class="history">${history.map((a) => `<button onclick="select('alert',${a.id})"><span><span class="badge b-${a.type}">${(ALERT[a.type] || ALERT.SOS).label}</span> ${esc(a.message || "")}</span><span class="muted small">${ago(a.created_at)}</span></button>`).join("") || `<span class="muted">No alerts so far.</span>`}</div></div>
      <div class="sec"><span class="label">Route today</span><span class="muted small">Shown on the map as a green line.</span></div>`;
    const track = await api(`/api/tourists/${t.id}/track`);
    if (track.length > 1) L.polyline(track.map((p) => [p.lat, p.lon]), { color: "#1E5B3F", weight: 3, opacity: 0.8 }).addTo(layers.focus);
    if (focus && t.last_lat != null) map.flyTo([t.last_lat, t.last_lon], Math.max(map.getZoom(), 15), { duration: 0.7 });
  }
}

function drawRoute(a) {
  // Draw the relay chain through the nodes whose position we know (tourist bands and gateways).
  const pos = (id) => {
    const g = state.gateways.get(id);
    if (g && g.lat != null) return [g.lat, g.lon];
    const t = [...state.tourists.values()].find((x) => x.band_id === id);
    return t && t.last_lat != null ? [t.last_lat, t.last_lon] : null;
  };
  const pts = (a.hops || []).map(pos).filter(Boolean);
  if (pts.length) pts[0] = [a.lat, a.lon];
  if (pts.length > 1) L.polyline(pts, { color: "#1E5B3F", weight: 3, dashArray: "2 7", lineCap: "round" }).addTo(layers.focus);
}

window.select = select;
window.actAlert = async (id, action) => {
  const responder = document.getElementById("responder")?.value.trim();
  const notes = document.getElementById("notes")?.value.trim();
  if (action === "ack" && !responder) { document.getElementById("responder").focus(); toast("Enter the unit you are sending.", "warn"); return; }
  try {
    await api(`/api/alerts/${id}/${action}`, { method: "POST", body: { responder: responder || state.officer, notes: notes || null } });
    toast(action === "ack" ? `${esc(responder)} assigned. The tourist can see this on their phone.` : "Case closed.");
  } catch (e) { toast(esc(e.message), "danger"); }
};

// ------------------------------------------------------------------ dialogs
const modal = document.getElementById("modal");
const modalBody = document.getElementById("modalBody");
function openModal(html) { modalBody.innerHTML = html; modal.classList.add("show"); }
window.closeModal = () => modal.classList.remove("show");
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

document.getElementById("btnAdvisory").onclick = () => {
  openModal(`
    <h3>Send notice to tourists</h3><p class="muted" style="margin:0">It shows up at the top of every tourist's app straight away.</p>
    <label for="advMsg">Message</label><textarea id="advMsg" rows="3" placeholder="Heavy rain near Sohra after 4 PM. Avoid trekking routes today."></textarea>
    <label>Type</label>
    <div class="seg" style="margin:0" id="advLevel">
      <button class="seg-btn" data-v="info">Information</button><button class="seg-btn active" data-v="warning">Warning</button><button class="seg-btn" data-v="danger">Danger</button>
    </div>
    <div class="actions"><button onclick="closeModal()">Cancel</button><button class="btn-primary" id="advSend">Send to ${state.tourists.size} tourists</button></div>`);
  modalBody.querySelectorAll("#advLevel .seg-btn").forEach((b) => b.onclick = () => modalBody.querySelectorAll("#advLevel .seg-btn").forEach((x) => x.classList.toggle("active", x === b)));
};
modalBody.addEventListener("click", async (e) => {
  const id = e.target.closest("button")?.id;
  if (id === "advSend") {
    const message = document.getElementById("advMsg").value.trim();
    if (!message) return document.getElementById("advMsg").focus();
    const level = modalBody.querySelector("#advLevel .active").dataset.v;
    await api("/api/advisories", { method: "POST", body: { message: `${message}`, level } });
    closeModal(); toast("Notice sent to all tourists.");
  }
  if (id === "zoneSave") {
    const d = modalBody.dataset;
    const body = {
      name: document.getElementById("zName").value.trim() || "Unnamed zone",
      risk: document.getElementById("zRisk").value,
      radius_m: Number(document.getElementById("zRadius").value) || 300,
      description: document.getElementById("zDesc").value.trim(),
      lat: Number(d.lat), lon: Number(d.lon),
    };
    await api("/api/geofences", { method: "POST", body });
    closeModal(); toast("Risk zone saved. Tourist apps now warn people near it.");
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
  openModal(`<h3>Add risk zone</h3><p class="mono muted" style="margin:0">${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}</p>
    <label for="zName">Name</label><input id="zName" placeholder="Landslide-prone stretch, NH-6">
    <label for="zRisk">Level</label><select id="zRisk"><option value="high">High: alert police when a tourist enters</option><option value="medium">Medium: warn the tourist only</option></select>
    <label for="zRadius">Radius in metres: <b id="zRadiusV">400</b></label><input id="zRadius" type="range" min="50" max="3000" step="50" value="400" style="padding:0">
    <label for="zDesc">Advice for tourists</label><input id="zDesc" placeholder="Road closed after dark">
    <div class="actions"><button onclick="closeModal()">Cancel</button><button class="btn-primary" id="zoneSave">Save zone</button></div>`);
  modalBody.dataset.lat = e.latlng.lat;
  modalBody.dataset.lon = e.latlng.lng;
  const preview = L.circle(e.latlng, { radius: 400, color: "#BA1A1A", weight: 1.5, dashArray: "5 5", fillOpacity: 0.08 }).addTo(layers.focus);
  document.getElementById("zRadius").oninput = (ev) => { document.getElementById("zRadiusV").textContent = ev.target.value; preview.setRadius(Number(ev.target.value)); };
});
window.deleteZone = async (id) => {
  if (!confirm("Remove this risk zone?")) return;
  await api(`/api/geofences/${id}`, { method: "DELETE" });
  map.closePopup();
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
    toast(`<b>${meta.label}: ${esc(d.tourist?.name || d.band_id)}</b><br><span class="muted">${esc(d.message || meta.text)}, ${via(d)}</span>`, "danger", 8000);
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
  const s = state.selected;
  if (s && (ev.startsWith("alert") || ev === "tourist_update")) {
    if ((s.kind === "alert" && d.id === s.id) || (s.kind === "tourist" && (d.id === s.id || d.tourist_id === s.id))) renderDetail(false);
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
  const s = state.selected;
  if (s && !(s.kind === "alert" ? state.alerts.has(s.id) : state.tourists.has(s.id))) { state.selected = null; layers.focus.clearLayers(); }
  if (!state.selected) emptyDetail();
  renderList();
  loadStats();
}

emptyDetail();
setTab(state.tab);
live(onEvent, (ok) => {
  document.getElementById("liveDot").className = "dot " + (ok ? "on" : "off");
  document.getElementById("liveText").textContent = ok ? "Live" : "Reconnecting";
  if (ok) boot();
});
setInterval(() => { renderList(); loadStats(); drawGateways(); }, 30000);
