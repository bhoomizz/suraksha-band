const { api, live, esc, ago, dist, haversine, ALERT, toast } = Suraksha;

// Number of the GSM gateway / SMS webhook that forwards to /api/sms/inbound. Change it for your setup.
const SMS_GATEWAY = "+919000000000";
// Nordic UART Service, the same UUIDs the band firmware advertises.
const BLE_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BLE_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const DEFAULT_POS = [25.5788, 91.8933];

// ------------------------------------------------------------------ storage
const store = {
  get(k, d = null) { try { const v = localStorage.getItem("suraksha." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("suraksha." + k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem("suraksha." + k); } catch { /* ignore */ } },
};

let me = store.get("me");
let pos = store.get("pos");
let activeAlert = store.get("activeAlert");
let geofences = store.get("geofences", []);
let places = store.get("places", []);
let queue = store.get("queue", []);
let online = navigator.onLine;
let battery = null;
let lastSent = { ts: 0, lat: 0, lon: 0 };
let map, meMarker, zoneLayer, placeLayer;

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ views
function show(view) {
  $("viewRegister").classList.toggle("hidden", view !== "register");
  $("viewHome").classList.toggle("hidden", view !== "home");
}

$("langBtn").onclick = () => {
  LANG = LANG === "en" ? "hi" : "en";
  try { localStorage.setItem("suraksha.lang", LANG); } catch { /* ignore */ }
  applyI18n(); renderHome();
};

function setNet(state) {
  online = state;
  $("net").querySelector(".dot").className = "dot " + (online ? "on" : "off");
  $("netText").textContent = t(online ? "online" : "offline");
  if (online) flushQueue();
}
window.addEventListener("online", () => setNet(true));
window.addEventListener("offline", () => setNet(false));

// ------------------------------------------------------------------ registration
$("regForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const body = { ...f, language: LANG, band_id: (f.band_id || "").trim().toUpperCase() || null,
    itinerary: (f.itinerary || "").split(",").map((s) => s.trim()).filter(Boolean) };
  for (const k of Object.keys(body)) if (body[k] === "") body[k] = null;
  try {
    me = await api("/api/tourists", { method: "POST", body });
    store.set("me", me);
    toast(`Digital ID created: <b>${esc(me.id)}</b>`);
    startHome();
  } catch (err) { toast(esc(err.message), "danger"); }
};

$("loginBtn").onclick = async () => {
  const id = $("loginId").value.trim().toUpperCase();
  if (!id) return;
  try { me = await api(`/api/tourists/${encodeURIComponent(id)}`); store.set("me", me); startHome(); }
  catch (err) { toast(esc(err.message), "danger"); }
};

$("logout").onclick = () => {
  if (!confirm("Sign out of this device?")) return;
  ["me", "activeAlert", "queue"].forEach(store.del);
  location.reload();
};

// ------------------------------------------------------------------ home
function renderHome() {
  if (!me) return;
  $("meName").textContent = me.name;
  const st = me.status === "alert" ? "alert" : "safe";
  $("meStatus").className = "badge b-" + st;
  $("meStatus").textContent = t(st);
  $("bandId").textContent = me.band_id || t("noBand");
  $("bandState").className = "badge " + (me.band_id ? "b-safe" : "b-acknowledged");
  $("bandState").textContent = me.band_id ? t("bandLinked") : t("bandNone");
  $("bandInfo").textContent = me.battery != null ? `Battery ${me.battery}% · seen ${ago(me.last_seen)}` : "";
  $("contactName").textContent = me.emergency_name || "–";
  $("callContact").href = me.emergency_phone ? "tel:" + me.emergency_phone : "#";

  $("idInfo").innerHTML = `
    <span class="k">ID</span><span class="mono">${esc(me.id)}</span>
    <span class="k">Name</span><span>${esc(me.name)}</span>
    <span class="k">Blood</span><span>${esc(me.blood_group || "–")}</span>
    <span class="k">Valid</span><span>${esc(me.trip_start || "?")} → ${esc(me.trip_end || "?")}</span>
    <span class="k">Hash</span><span class="mono" title="${esc(me.digital_id)}">${esc((me.digital_id || "").slice(0, 16))}…</span>`;
  const qr = $("qr");
  if (window.QRCode && !qr.dataset.for) {
    qr.innerHTML = "";
    new QRCode(qr, { text: JSON.stringify({ tid: me.id, name: me.name, blood: me.blood_group, h: (me.digital_id || "").slice(0, 16), v: location.origin + "/api/tourists/" + me.id }), width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
    qr.dataset.for = me.id;
  }
  renderAlertCard();
  renderQueue();
  renderNearby();
}

function renderQueue() {
  $("queueCard").classList.toggle("hidden", !queue.length);
  $("queueCount").textContent = queue.length;
  const last = queue.find((p) => p.type !== "CANCEL") || queue[0];
  if (last) {
    const b = me.band_id || me.id;
    const loc = last.lat != null ? ` ${last.lat.toFixed(5)},${last.lon.toFixed(5)}` : "";
    const body = `${last.type} ${b}${loc}${battery != null ? " B" + battery : ""}`;
    const sep = /iPhone|iPad/.test(navigator.userAgent) ? "&" : "?";
    $("smsFallback").href = `sms:${SMS_GATEWAY}${sep}body=${encodeURIComponent(body)}`;
  }
}

// ------------------------------------------------------------------ SOS hold button
const HOLD_MS = 3000;
let holdStart = 0, holdRaf = 0;
const sosBtn = $("sosBtn");

function holdTick() {
  const p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
  sosBtn.style.setProperty("--p", p * 100 + "%");
  if (p >= 1) { endHold(); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); sendAlert("SOS"); return; }
  holdRaf = requestAnimationFrame(holdTick);
}
function startHold(e) {
  e.preventDefault();
  holdStart = performance.now();
  sosBtn.classList.add("holding");
  if (navigator.vibrate) navigator.vibrate(40);
  holdRaf = requestAnimationFrame(holdTick);
}
function endHold() {
  cancelAnimationFrame(holdRaf);
  sosBtn.classList.remove("holding");
  sosBtn.style.setProperty("--p", "0%");
}
sosBtn.addEventListener("pointerdown", startHold);
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => sosBtn.addEventListener(ev, endHold));
sosBtn.addEventListener("contextmenu", (e) => e.preventDefault());
sosBtn.addEventListener("keydown", (e) => { if (e.key === "Enter" && confirm("Send SOS now?")) sendAlert("SOS"); });

// ------------------------------------------------------------------ sending alerts
function packet(type, extra = {}) {
  return {
    msg_id: `APP-${me.id}-${Date.now().toString(36)}`, tourist_id: me.id, band_id: me.band_id, type,
    lat: pos ? pos.lat : null, lon: pos ? pos.lon : null, battery, ts: Date.now() / 1000, ...extra,
  };
}

async function sendAlert(type, extra) {
  const p = packet(type, extra);
  if (type !== "CANCEL") {
    activeAlert = { msg_id: p.msg_id, type, status: "sending", ts: p.ts };
    store.set("activeAlert", activeAlert);
  }
  renderAlertCard();
  try {
    if (!online) throw new Error("offline");
    const r = await api("/api/sos", { method: "POST", body: p });
    if (type === "CANCEL") {
      activeAlert = null; store.del("activeAlert");
      toast("Alert cancelled.");
    } else {
      activeAlert = { ...activeAlert, alert_id: r.alert_id, status: "open" };
      store.set("activeAlert", activeAlert);
      toast(`<b>${t("sosSent")}</b>`, "danger");
    }
  } catch (err) {
    if (err.message !== "offline" && online) toast(esc(err.message), "danger");
    queue.push(p); store.set("queue", queue);
    if (activeAlert && type !== "CANCEL") { activeAlert.status = "queued"; store.set("activeAlert", activeAlert); }
    if (type === "CANCEL") { activeAlert = null; store.del("activeAlert"); }
  }
  renderHome();
}

async function flushQueue() {
  if (!queue.length || !me) return;
  const pending = [...queue];
  for (const p of pending) {
    try {
      const r = await api("/api/sos", { method: "POST", body: p });
      queue = queue.filter((q) => q.msg_id !== p.msg_id);
      store.set("queue", queue);
      if (activeAlert && activeAlert.msg_id === p.msg_id) {
        activeAlert = { ...activeAlert, alert_id: r.alert_id, status: "open" };
        store.set("activeAlert", activeAlert);
      }
    } catch (e) { break; }
  }
  if (pending.length !== queue.length) toast(`${pending.length - queue.length} saved message(s) delivered.`);
  renderHome();
}
setInterval(() => online && flushQueue(), 15000);

function renderAlertCard() {
  const card = $("alertCard");
  if (!activeAlert) { card.classList.add("hidden"); sosBtn.classList.remove("sent"); return; }
  const a = activeAlert, s = a.status;
  sosBtn.classList.toggle("sent", s !== "resolved");
  card.classList.remove("hidden", "ack", "done");
  if (s === "acknowledged") card.classList.add("ack");
  if (s === "resolved") card.classList.add("done");
  const meta = ALERT[a.type] || ALERT.SOS;
  const title = s === "queued" ? t("sosQueued") : s === "resolved" ? t("resolved") : s === "acknowledged" ? t("helpComing") : s === "sending" ? "…" : t("sosSent");
  const reached = ["open", "acknowledged", "resolved"].includes(s);
  card.innerHTML = `
    <div class="card-head"><h3>${esc(title)}</h3><span class="badge b-${a.type}">${meta.label}</span></div>
    ${s === "queued" ? `<p class="muted small">${t("sosQueuedSub")}</p>` : ""}
    <div class="steps">
      <div class="step ${reached ? "done" : ""}"><i></i>${t("stepSent")}</div>
      <div class="step ${s === "acknowledged" || s === "resolved" ? "done" : ""}"><i></i>${t("stepAck")}${a.assigned_to ? `: <b>${esc(a.assigned_to)}</b>` : ""}</div>
      <div class="step ${s === "resolved" ? "done" : ""}"><i></i>${t("stepDone")}</div>
    </div>
    ${s === "resolved" ? `<button class="wide" id="dismissAlert">OK</button>` : `<button class="wide" id="cancelAlert">${t("cancel")}</button>`}`;
  const c = $("cancelAlert");
  if (c) c.onclick = () => confirm(t("cancel") + "?") && sendAlert("CANCEL");
  const d = $("dismissAlert");
  if (d) d.onclick = () => { activeAlert = null; store.del("activeAlert"); renderHome(); };
}

// ------------------------------------------------------------------ location
function initMap() {
  map = L.map("map", { zoomControl: false, attributionControl: false }).setView(pos ? [pos.lat, pos.lon] : DEFAULT_POS, 14);
  Suraksha.tiles(map);
  zoneLayer = L.layerGroup().addTo(map);
  placeLayer = L.layerGroup().addTo(map);
  meMarker = L.marker(pos ? [pos.lat, pos.lon] : DEFAULT_POS, { icon: L.divIcon({ className: "", iconSize: [16, 16], html: '<div class="me-dot"></div>' }) }).addTo(map);
  map.on("click", (e) => { if ($("demoLoc").checked) setPos(e.latlng.lat, e.latlng.lng, "demo", true); });
  drawZones();
}

function drawZones() {
  if (!zoneLayer) return;
  zoneLayer.clearLayers();
  for (const z of geofences) {
    L.circle([z.lat, z.lon], { radius: z.radius_m, color: z.risk === "high" ? "#ef4444" : "#f59e0b", weight: 1.5, fillOpacity: 0.15 })
      .bindPopup(`<b>${esc(z.name)}</b><br>${esc(z.description || "")}`).addTo(zoneLayer);
  }
}

function renderNearby() {
  if (!pos) { $("nearby").innerHTML = `<p class="muted small">${t("locating")}</p>`; return; }
  const withDist = places.map((p) => ({ ...p, d: Math.round(haversine([pos.lat, pos.lon], [p.lat, p.lon])) })).sort((a, b) => a.d - b.d);
  const pick = [withDist.find((p) => p.kind === "police"), withDist.find((p) => p.kind === "hospital")].filter(Boolean);
  $("nearby").innerHTML = pick.map((p) => `<div class="near"><span><span class="k ${p.kind}">${t(p.kind + "_s")}</span>${esc(p.name)} · ${dist(p.d)}</span>${p.phone ? `<a class="btn btn-sm" href="tel:${esc(p.phone)}">Call</a>` : ""}</div>`).join("");
  if (placeLayer) {
    placeLayer.clearLayers();
    pick.forEach((p) => L.circleMarker([p.lat, p.lon], { radius: 6, color: p.kind === "police" ? "#3b82f6" : "#ec4899", fillOpacity: 0.9 }).bindPopup(esc(p.name)).addTo(placeLayer));
  }
}

function showZones(zones) {
  const b = $("zoneBanner");
  if (!zones.length) { b.classList.add("hidden"); return; }
  const z = zones.find((x) => x.risk === "high") || zones[0];
  b.className = "banner " + (z.risk === "high" ? "danger" : "warn");
  b.innerHTML = `<b>${t("zoneIn")}: ${esc(z.name)}</b>${esc(z.description || "")}`;
  if (b.dataset.zone !== String(z.id) && navigator.vibrate) navigator.vibrate([300, 150, 300]);
  b.dataset.zone = z.id;
}

async function setPos(lat, lon, source, force = false) {
  pos = { lat, lon, ts: Date.now() / 1000 };
  store.set("pos", pos);
  $("coords").textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  if (meMarker) { meMarker.setLatLng([lat, lon]); if (force || source === "gps-first") map.panTo([lat, lon]); }
  // Check zones locally so warnings work offline too.
  showZones(geofences.filter((z) => haversine([lat, lon], [z.lat, z.lon]) <= z.radius_m));
  renderNearby();

  const moved = haversine([lat, lon], [lastSent.lat, lastSent.lon]);
  const due = Date.now() - lastSent.ts > 30000 || moved > 25 || force;
  if ($("shareLoc").checked && online && me && due) {
    lastSent = { ts: Date.now(), lat, lon };
    try { await api(`/api/tourists/${me.id}/location`, { method: "POST", body: { lat, lon, battery, source: source === "demo" ? "demo" : "app" } }); }
    catch (e) { /* retried on the next position */ }
  }
}

function startGeolocation() {
  if (!navigator.geolocation) return fallbackPos();
  let first = true;
  navigator.geolocation.watchPosition(
    (p) => { if (!$("demoLoc").checked) { setPos(p.coords.latitude, p.coords.longitude, first ? "gps-first" : "gps"); first = false; } },
    () => fallbackPos(),
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
  );
}
function fallbackPos() {
  if (pos) return setPos(pos.lat, pos.lon, "cached");
  toast("GPS is unavailable here, so a demo location near Shillong is used. Turn on 'Demo: tap map to move' to change it.", "warn", 7000);
  $("demoLoc").checked = true;
  setPos(DEFAULT_POS[0] + (Math.random() - 0.5) * 0.01, DEFAULT_POS[1] + (Math.random() - 0.5) * 0.01, "demo", true);
}
setInterval(() => pos && setPos(pos.lat, pos.lon, "heartbeat"), 30000);

// ------------------------------------------------------------------ band (Bluetooth + manual)
$("bandEdit").onclick = async () => {
  const id = prompt(t("bandPrompt"), me.band_id || "BAND-");
  if (id == null) return;
  try { me = await api(`/api/tourists/${me.id}/band`, { method: "POST", body: { band_id: id } }); store.set("me", me); renderHome(); }
  catch (e) { toast(esc(e.message), "danger"); }
};

$("btConnect").onclick = async () => {
  if (!navigator.bluetooth) {
    toast("Web Bluetooth needs Chrome on Android or desktop over HTTPS or localhost. Use Edit to enter the band ID instead.", "warn", 7000);
    return;
  }
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "SURAKSHA" }], optionalServices: [BLE_SERVICE, "battery_service"] });
    const server = await device.gatt.connect();
    const tx = await (await server.getPrimaryService(BLE_SERVICE)).getCharacteristic(BLE_TX);
    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged", (e) => onBandMessage(new TextDecoder().decode(e.target.value)));
    const bandId = device.name.replace(/^SURAKSHA-?/, "BAND-");
    if (bandId !== me.band_id) { me = await api(`/api/tourists/${me.id}/band`, { method: "POST", body: { band_id: bandId } }); store.set("me", me); }
    $("bandState").textContent = t("connected");
    toast(`Band ${esc(bandId)} connected over Bluetooth.`);
    device.addEventListener("gattserverdisconnected", () => { toast("Band disconnected", "warn"); renderHome(); });
  } catch (e) { if (e.name !== "NotFoundError") toast(esc(e.message), "danger"); }
};

// Band sends plain text lines: "SOS", "FALL", "CANCEL", "BAT:82", "HR:142"
function onBandMessage(msg) {
  msg = msg.trim().toUpperCase();
  if (msg.startsWith("BAT:")) { battery = parseInt(msg.slice(4), 10); return; }
  if (msg.startsWith("HR:")) { const hr = parseInt(msg.slice(3), 10); if (hr > 150 || hr < 40) sendAlert("HEALTH", { heart_rate: hr }); return; }
  if (msg === "SOS" || msg === "FALL" || msg === "CANCEL") sendAlert(msg);
}

// ------------------------------------------------------------------ fall detection (phone sensors)
let fallTimer = null;
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || fallTimer) return;
  const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
  if (g > 30) fallCountdown(); // about 3g impact
}
$("fallDetect").onchange = async (e) => {
  if (e.target.checked) {
    if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) {
      try { if ((await DeviceMotionEvent.requestPermission()) !== "granted") { e.target.checked = false; return; } } catch { e.target.checked = false; return; }
    }
    window.addEventListener("devicemotion", onMotion);
    toast("Fall detection is on. Use 'Test' to try it.");
  } else window.removeEventListener("devicemotion", onMotion);
  $("fallTest").classList.toggle("hidden", !e.target.checked);
};
const testBtn = document.createElement("button");
testBtn.id = "fallTest"; testBtn.className = "btn-sm hidden"; testBtn.textContent = "Test";
testBtn.style.marginLeft = "auto";
testBtn.onclick = (e) => { e.preventDefault(); fallCountdown(); };
$("fallDetect").parentElement.appendChild(testBtn);

function fallCountdown() {
  let n = 15;
  if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
  const modal = $("modal");
  const draw = () => {
    $("modalBody").innerHTML = `<h3>${t("fallQ")}</h3><p class="muted">${t("fallSub")}</p><div class="count-big">${n}</div>
      <div class="actions"><button class="btn-primary" id="fOk">${t("imOk")}</button><button class="btn-danger" id="fSend">${t("sendNow")}</button></div>`;
    $("fOk").onclick = () => stop();
    $("fSend").onclick = () => { stop(); sendAlert("FALL"); };
  };
  const stop = () => { clearInterval(fallTimer); fallTimer = null; modal.classList.remove("show"); };
  draw(); modal.classList.add("show");
  fallTimer = setInterval(() => { n--; if (n <= 0) { stop(); sendAlert("FALL"); } else draw(); }, 1000);
}

// ------------------------------------------------------------------ advisories + live updates
function showAdvisory(a) {
  if (!a) return;
  const b = $("advisory");
  b.className = "banner " + (a.level === "danger" ? "danger" : a.level === "warning" ? "warn" : "");
  b.innerHTML = `<b>${t("advisory")}</b>${esc(a.message)} <span class="muted small">· ${ago(a.created_at)}</span>`;
  store.set("advisory", a);
}

function onEvent(ev, d) {
  if (!me) return;
  if ((ev === "alert_new" || ev === "alert_update") && d.tourist_id === me.id) {
    if (["SOS", "FALL", "HEALTH", "INACTIVITY"].includes(d.type) && (ev === "alert_update" ? activeAlert && activeAlert.alert_id === d.id : !activeAlert || activeAlert.msg_id === d.msg_id)) {
      activeAlert = { ...(activeAlert || {}), msg_id: d.msg_id, alert_id: d.id, type: d.type, status: d.status, assigned_to: d.assigned_to };
      store.set("activeAlert", activeAlert);
      if (d.status === "acknowledged" && navigator.vibrate) navigator.vibrate([100, 50, 100]);
    }
    if (d.tourist) { me = { ...me, ...d.tourist }; store.set("me", me); }
    renderHome();
  } else if (ev === "tourist_update" && d && d.id === me.id) {
    me = { ...me, ...d }; store.set("me", me); renderHome();
  } else if (ev === "advisory") {
    showAdvisory(d);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } else if (ev === "geofences_changed") {
    geofences = d; store.set("geofences", d); drawZones(); if (pos) setPos(pos.lat, pos.lon, "zones");
  } else if (ev === "reset") {
    activeAlert = null; store.del("activeAlert"); renderHome();
  }
}

async function refreshFromServer() {
  try {
    const [fresh, gf, pl, adv] = await Promise.all([
      api(`/api/tourists/${me.id}`), api("/api/geofences"), api("/api/places"), api("/api/advisories?limit=1"),
    ]);
    me = fresh; geofences = gf; places = pl;
    store.set("me", me); store.set("geofences", gf); store.set("places", pl);
    if (adv[0]) showAdvisory(adv[0]);
    if (activeAlert && activeAlert.alert_id) {
      const a = await api(`/api/alerts/${activeAlert.alert_id}`).catch(() => null);
      if (a) activeAlert = { ...activeAlert, status: a.status, assigned_to: a.assigned_to };
      else activeAlert = null;
      activeAlert ? store.set("activeAlert", activeAlert) : store.del("activeAlert");
    }
    drawZones();
  } catch (e) { /* offline: keep cached data */ }
  renderHome();
}

// ------------------------------------------------------------------ boot
function startHome() {
  show("home");
  applyI18n();
  if (!map) initMap();
  renderHome();
  showAdvisory(store.get("advisory"));
  refreshFromServer();
  startGeolocation();
  if (navigator.getBattery) navigator.getBattery().then((b) => { battery = Math.round(b.level * 100); b.onlevelchange = () => (battery = Math.round(b.level * 100)); });
}

applyI18n();
setNet(navigator.onLine);
live(onEvent, (ok) => { if (ok && me) refreshFromServer(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
me ? startHome() : show("register");
