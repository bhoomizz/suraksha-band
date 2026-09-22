// Browser simulation of the band LoRa mesh: managed flooding with TTL and duplicate suppression.
// A gateway that hears a packet uploads it to /api/gateway/ingest, the same endpoint the ESP32 gateway uses.
const { api, esc, clock, haversine, toast } = Suraksha;

const FALLS = [25.5400, 91.8230];
const COLORS = { SOS: "#ef4444", FALL: "#ec4899", HEALTH: "#a855f7", HEARTBEAT: "#22c55e", CANCEL: "#94a3b8" };
const cfg = { range: 1800, ttl: 8, delay: 600, showRange: false };
const counters = { tx: 0, relayed: 0, delivered: 0, dropped: 0, latency: null };
const nodes = [];
const deliveries = new Map(); // msg_id -> first delivery info
let lastPath = [];
let relaySeq = 2001;
let addMode = false;

const map = L.map("map").setView([25.5620, 91.8600], 13);
Suraksha.tiles(map);
const fx = L.layerGroup().addTo(map);
const rangeLayer = L.layerGroup().addTo(map);

const layoutGet = () => { try { return JSON.parse(localStorage.getItem("sim.layout")) || null; } catch { return null; } };
const layoutSave = () => {
  try {
    localStorage.setItem("sim.layout", JSON.stringify({
      pos: Object.fromEntries(nodes.map((n) => [n.id, [n.lat, n.lon]])),
      relays: nodes.filter((n) => n.kind === "relay").map((n) => ({ id: n.id, lat: n.lat, lon: n.lon })),
    }));
  } catch { /* storage unavailable */ }
};

// ------------------------------------------------------------------ log + counters
function log(html, cls = "") {
  const el = document.createElement("div");
  el.className = cls;
  el.innerHTML = `<span class="t">${clock(Date.now() / 1000)}</span>${html}`;
  const box = document.getElementById("log");
  box.prepend(el);
  while (box.children.length > 250) box.lastChild.remove();
}
function drawCounters() {
  document.getElementById("counters").innerHTML = [
    ["Transmissions", counters.tx], ["Relays", counters.relayed], ["Delivered", counters.delivered],
    ["Last latency", counters.latency == null ? "–" : (counters.latency / 1000).toFixed(1) + " s"],
  ].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join("");
}

// ------------------------------------------------------------------ nodes
function nodeIcon(n) {
  const color = n.kind === "gateway" ? "#2dd4bf" : n.kind === "band" ? (n.alert ? "#ef4444" : "#22c55e") : "#a78bfa";
  const size = n.kind === "gateway" ? 18 : n.kind === "band" ? 18 : 13;
  const cls = ["node", n.kind === "gateway" ? "gw" : "", !n.alive ? "off" : "", n.kind === "gateway" && !n.online ? "nonet" : "", n.rx ? "rx" : ""].join(" ");
  return L.divIcon({ className: "", iconSize: [size, size], html: `<div class="${cls}" style="width:${size}px;height:${size}px;background:${color}"><span></span></div>` });
}

function addNode(n) {
  Object.assign(n, { alive: true, online: true, seen: new Set(), buffer: [], rx: false });
  n.marker = L.marker([n.lat, n.lon], { icon: nodeIcon(n), draggable: true, zIndexOffset: n.kind === "relay" ? 0 : 500 }).addTo(map);
  n.marker.bindTooltip(n.label || n.id, { permanent: n.kind !== "relay", direction: "top", offset: [0, -10], className: "node-label" });
  n.marker.on("dragend", (e) => { const p = e.target.getLatLng(); n.lat = p.lat; n.lon = p.lng; layoutSave(); drawRanges(); });
  n.marker.on("click", () => openPopup(n));
  nodes.push(n);
  return n;
}
const refresh = (n) => n.marker.setIcon(nodeIcon(n));
const byId = (id) => nodes.find((n) => n.id === id);

function openPopup(n) {
  const btn = (act, label, cls = "") => `<button class="btn-sm ${cls}" onclick="nodeAction('${n.id}','${act}')">${label}</button>`;
  let body = `<b>${esc(n.label || n.id)}</b><br><span class="muted mono">${n.id}${n.tourist ? " · " + esc(n.tourist) : ""}</span>`;
  if (n.kind === "band") {
    body += `<div class="popup-actions">${btn("SOS", "SOS", "btn-danger")}${btn("FALL", "Fall")}${btn("HEALTH", "Heart rate 172")}${btn("CANCEL", "Cancel alert")}${btn("HEARTBEAT", "Heartbeat")}${btn("power", n.alive ? "Power off" : "Power on")}</div>`;
  } else if (n.kind === "relay") {
    body += `<div class="popup-actions">${btn("power", n.alive ? "Power off" : "Power on")}${btn("remove", "Remove")}</div>`;
  } else {
    body += `<br>Internet: <b>${n.online ? "connected" : "down"}</b>${n.buffer.length ? ` · ${n.buffer.length} stored` : ""}<div class="popup-actions">${btn("net", n.online ? "Cut internet" : "Restore internet")}${btn("power", n.alive ? "Power off" : "Power on")}</div>`;
  }
  L.popup({ offset: [0, -6] }).setLatLng([n.lat, n.lon]).setContent(body).openOn(map);
}

window.nodeAction = (id, act) => {
  const n = byId(id);
  map.closePopup();
  if (act === "power") { n.alive = !n.alive; refresh(n); log(`${n.id} powered ${n.alive ? "on" : "off"}`, "warn"); drawRanges(); }
  else if (act === "remove") { map.removeLayer(n.marker); nodes.splice(nodes.indexOf(n), 1); layoutSave(); drawRanges(); }
  else if (act === "net") setGatewayNet(n, !n.online);
  else originate(n, act, act === "HEALTH" ? { heart_rate: 172 } : {});
};

// ------------------------------------------------------------------ radio effects
function flash(from, color) {
  const c = L.circle([from.lat, from.lon], { radius: cfg.range, color, weight: 1, fillColor: color, fillOpacity: 0.12, interactive: false }).addTo(fx);
  let o = 0.12;
  const iv = setInterval(() => { o -= 0.02; if (o <= 0) { clearInterval(iv); fx.removeLayer(c); } else c.setStyle({ fillOpacity: o, opacity: o * 5 }); }, 60);
}
function link(a, b, color) {
  const l = L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { color, weight: 3, opacity: 0.9, dashArray: "6 6", interactive: false }).addTo(fx);
  setTimeout(() => fx.removeLayer(l), cfg.delay + 700);
}
function pulse(n) { n.rx = true; refresh(n); setTimeout(() => { n.rx = false; refresh(n); }, 350); }

function drawRanges() {
  rangeLayer.clearLayers();
  if (!cfg.showRange) return;
  nodes.filter((n) => n.alive).forEach((n) => L.circle([n.lat, n.lon], { radius: cfg.range, color: n.kind === "gateway" ? "#2dd4bf" : "#64748b", weight: 1, fillOpacity: 0.03, interactive: false }).addTo(rangeLayer));
}

// ------------------------------------------------------------------ mesh protocol
function transmit(node, pkt) {
  if (!node.alive) return;
  counters.tx++;
  const color = COLORS[pkt.type] || "#fff";
  flash(node, color);
  const heard = nodes.filter((n) => n !== node && n.alive && haversine([node.lat, node.lon], [n.lat, n.lon]) <= cfg.range);
  for (const n of heard) {
    link(node, n, color);
    setTimeout(() => receive(n, pkt), cfg.delay * (0.7 + Math.random() * 0.6));
  }
  drawCounters();
}

function receive(node, pkt) {
  if (!node.alive || node.seen.has(pkt.msg_id)) return; // duplicate suppression
  node.seen.add(pkt.msg_id);
  pulse(node);
  const p = { ...pkt, hops: [...pkt.hops, node.id], ttl: pkt.ttl - 1 };
  if (node.kind === "gateway") return upload(node, p);
  if (p.ttl <= 0) { counters.dropped++; return; }
  counters.relayed++;
  if (pkt.type !== "HEARTBEAT") log(`<b>${node.id}</b> relays ${pkt.type} <span class="muted">(ttl ${p.ttl})</span>`, "relay");
  transmit(node, p);
}

function originate(node, type, extra = {}) {
  if (!node.alive) { toast(`${node.id} is powered off`, "warn"); return; }
  const pkt = {
    msg_id: `${node.id}-${Date.now().toString(36)}`, band_id: node.id, type,
    lat: +node.lat.toFixed(6), lon: +node.lon.toFixed(6), battery: node.battery, ts: Date.now() / 1000,
    hops: [node.id], ttl: cfg.ttl, t0: performance.now(), ...extra,
  };
  node.seen.add(pkt.msg_id);
  if (type === "SOS" || type === "FALL" || type === "HEALTH") { node.alert = true; refresh(node); }
  if (type === "CANCEL") { node.alert = false; refresh(node); }
  if (type !== "HEARTBEAT") {
    log(`<b>${node.id}</b> broadcasts <b style="color:${COLORS[type]}">${type}</b> ${pkt.lat.toFixed(4)}, ${pkt.lon.toFixed(4)} · no internet on band`, "tx");
    setTimeout(() => {
      if (!deliveries.has(pkt.msg_id)) log(`${type} from ${node.id} has not reached any gateway yet. Move nodes closer, raise the range or add relays. (The phone app would now offer SMS.)`, "warn");
    }, cfg.delay * (cfg.ttl + 3) + 1500);
  }
  transmit(node, pkt);
}

async function upload(gw, p) {
  const { ttl, t0, ...packet } = p;
  const hopsCount = packet.hops.length - 1;
  if (!deliveries.has(p.msg_id)) {
    deliveries.set(p.msg_id, { gw: gw.id, hops: packet.hops });
    counters.delivered++;
    counters.latency = performance.now() - t0;
    if (p.type !== "HEARTBEAT") lastPath = packet.hops;
  }
  if (p.type !== "HEARTBEAT") log(`<b>${gw.id}</b> heard ${p.type} after ${hopsCount} hop${hopsCount === 1 ? "" : "s"}: ${packet.hops.join(" → ")}`, "gw");
  if (!gw.online) {
    gw.buffer.push(packet);
    if (p.type !== "HEARTBEAT") log(`${gw.id} has no internet. Packet stored (${gw.buffer.length} waiting) and will be forwarded later.`, "warn");
    drawCounters();
    return;
  }
  await send(gw, [packet]);
  drawCounters();
}

async function send(gw, packets) {
  try {
    const r = await api("/api/gateway/ingest", { method: "POST", body: { gateway_id: gw.id, gateway_lat: gw.lat, gateway_lon: gw.lon, packets } });
    r.results.forEach((res, i) => {
      const pk = packets[i];
      if (pk.type === "HEARTBEAT") {
        if (res.zones && res.zones.length) log(`Server: ${pk.band_id} is inside <b>${esc(res.zones.join(", "))}</b>, geofence check done`, "warn");
        return;
      }
      if (res.duplicate) log(`Server: duplicate of alert #${res.alert_id} ignored (${gw.id})`, "");
      else if (res.alert_id) log(`Server: alert <b>#${res.alert_id}</b> created. The control room was notified.`, "ok");
      else if (res.cancelled != null) log(`Server: ${res.cancelled} alert(s) cancelled`, "ok");
      else if (!res.tourist_id) log(`Server: ${pk.band_id} is not linked to a registered tourist`, "warn");
    });
  } catch (e) {
    gw.buffer.push(...packets);
    log(`${gw.id} upload failed (${esc(e.message)}). The packet is kept and will be retried.`, "warn");
  }
}

function setGatewayNet(gw, on) {
  gw.online = on;
  refresh(gw);
  log(`${gw.id} internet ${on ? "restored" : "cut"}`, "warn");
  if (on && gw.buffer.length) {
    const pending = gw.buffer.splice(0);
    log(`${gw.id} forwarding ${pending.length} stored packet(s)`, "gw");
    send(gw, pending);
  }
}

// ------------------------------------------------------------------ scenarios
function kenji() { return byId("BAND-1004") || nodes.find((n) => n.kind === "band"); }

document.getElementById("scLost").onclick = () => {
  const n = kenji();
  n.lat = FALLS[0]; n.lon = FALLS[1];
  n.marker.setLatLng(FALLS);
  layoutSave();
  map.flyTo([25.5580, 91.8540], 14);
  log(`${n.label} moved to Elephant Falls, about ${(haversine(FALLS, [25.5770, 91.8855]) / 1000).toFixed(1)} km from the nearest gateway. There is no mobile network here.`, "warn");
  setTimeout(() => originate(n, "HEARTBEAT"), 400);
};
document.getElementById("scSos").onclick = () => originate(kenji(), "SOS");
document.getElementById("scBreak").onclick = () => {
  const mids = lastPath.slice(1, -1).map(byId).filter((n) => n && n.kind !== "gateway" && n.alive);
  if (!mids.length) { toast("Send an SOS first (scenario 2) so there is a path to break.", "warn"); return; }
  const victim = mids[Math.floor(mids.length / 2)];
  victim.alive = false; refresh(victim);
  log(`${victim.id} battery died. The mesh will route around it.`, "warn");
  setTimeout(() => originate(kenji(), "SOS"), 800);
};
document.getElementById("scGwDown").onclick = () => {
  const gws = nodes.filter((n) => n.kind === "gateway");
  gws.forEach((g) => setGatewayNet(g, false));
  setTimeout(() => originate(kenji(), "SOS"), 500);
  const wait = cfg.delay * (cfg.ttl + 2) + 4000;
  log(`Internet will be restored in ${(wait / 1000).toFixed(0)} s`, "");
  setTimeout(() => gws.forEach((g) => setGatewayNet(g, true)), wait);
};

document.getElementById("hbAll").onclick = () => nodes.filter((n) => n.kind === "band" && n.alive).forEach((n, i) => setTimeout(() => originate(n, "HEARTBEAT"), i * 250));
let hbTimer;
document.getElementById("autoHb").onchange = (e) => {
  clearInterval(hbTimer);
  if (e.target.checked) hbTimer = setInterval(() => document.getElementById("hbAll").click(), 20000);
};

const hint = document.getElementById("hint");
document.getElementById("addRelay").onclick = () => { addMode = true; hint.classList.remove("hidden"); };
document.getElementById("hintCancel").onclick = () => { addMode = false; hint.classList.add("hidden"); };
map.on("click", (e) => {
  if (!addMode) return;
  addNode({ id: `BAND-${relaySeq++}`, kind: "relay", lat: e.latlng.lat, lon: e.latlng.lng, battery: 90 });
  layoutSave(); drawRanges();
});
document.getElementById("resetLayout").onclick = () => { try { localStorage.removeItem("sim.layout"); } catch { /* ignore */ } location.reload(); };
document.getElementById("clearLog").onclick = () => (document.getElementById("log").innerHTML = "");

// Sliders
const bind = (id, key, fmt) => {
  const el = document.getElementById(id), out = document.getElementById(id + "V");
  const upd = () => { cfg[key] = Number(el.value); out.textContent = fmt(cfg[key]); drawRanges(); };
  el.oninput = upd; upd();
};
bind("range", "range", (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " km" : v + " m"));
bind("ttl", "ttl", (v) => v);
bind("delay", "delay", (v) => v + " ms");
document.getElementById("showRange").onchange = (e) => { cfg.showRange = e.target.checked; drawRanges(); };

// ------------------------------------------------------------------ boot
function defaultRelays() {
  // Two roughly parallel chains between Elephant Falls and Police Bazar so the mesh has redundant paths,
  // plus a few bands scattered around town.
  const a = FALLS, b = [25.5770, 91.8855];
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const f = i / 6;
    out.push([a[0] + (b[0] - a[0]) * f + 0.0015 * Math.sin(i * 2), a[1] + (b[1] - a[1]) * f]);
    if (i < 5) out.push([a[0] + (b[0] - a[0]) * (f + 0.08) - 0.0065, a[1] + (b[1] - a[1]) * (f + 0.08) + 0.0035]);
  }
  out.push([25.5880, 91.8800], [25.5650, 91.9120], [25.5900, 91.9050], [25.5560, 91.8950]);
  return out.map(([lat, lon]) => ({ id: `BAND-${relaySeq++}`, lat, lon }));
}

async function boot() {
  const saved = layoutGet();
  let tourists = [], gateways = [];
  try { [tourists, gateways] = await Promise.all([api("/api/tourists"), api("/api/gateways")]); }
  catch (e) { toast("Backend not reachable. Start the server first.", "danger", 10000); }

  gateways.filter((g) => g.lat != null).forEach((g) => addNode({ id: g.id, kind: "gateway", label: g.name.replace("Gateway - ", "GW "), lat: g.lat, lon: g.lon }));
  tourists.filter((t) => t.band_id).forEach((t) => addNode({
    id: t.band_id, kind: "band", tourist: t.name, label: t.name.split(" ")[0], battery: t.battery ?? 80,
    lat: t.last_lat ?? 25.5788, lon: t.last_lon ?? 91.8933, alert: t.status === "alert",
  }));
  const relays = saved ? saved.relays : defaultRelays();
  relays.forEach((r) => { addNode({ ...r, kind: "relay", battery: 90 }); relaySeq = Math.max(relaySeq, Number(r.id.split("-")[1]) + 1); });
  if (saved) nodes.forEach((n) => { const p = saved.pos[n.id]; if (p) { n.lat = p[0]; n.lon = p[1]; n.marker.setLatLng(p); } });
  layoutSave();
  drawCounters();
  log(`Mesh ready: ${nodes.filter((n) => n.kind === "band").length} tourist bands, ${nodes.filter((n) => n.kind === "relay").length} relays, ${nodes.filter((n) => n.kind === "gateway").length} gateways.`, "ok");
}
boot();
