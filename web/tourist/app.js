const { api, live, esc, ago, clock, dist, haversine, ALERT, toast } = Suraksha;

// Number of the GSM gateway / SMS webhook that forwards to /api/sms/inbound. Change it for your setup.
const SMS_GATEWAY = "+919000000000";
// Nordic UART Service, the same UUIDs the band firmware advertises.
const BLE_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const BLE_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
const DEFAULT_POS = [25.5788, 91.8933];
const STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry"];
const PLACES = ["Police Bazar", "Elephant Falls", "Umiam Lake", "Shillong Peak", "Laitlum Canyon", "Sohra (Cherrapunji)", "Nohkalikai Falls", "Double Decker Root Bridge", "Mawlynnong", "Dawki", "Mawsmai Cave", "Ward's Lake"];

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
let bandConnected = false;
let lastSent = { ts: 0, lat: 0, lon: 0 };
let map, meMarker, zoneLayer, placeLayer;

const $ = (id) => document.getElementById(id);
const shortTime = (ts) => new Date(ts * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

// ------------------------------------------------------------------ language
function setLang(l) {
  LANG = l;
  try { localStorage.setItem("suraksha.lang", l); } catch { /* ignore */ }
  applyI18n();
  document.querySelectorAll("[data-lang]").forEach((b) => b.classList.toggle("on", b.dataset.lang === l));
  setNet(online);
  if (me) renderAll();
  else regStep(step);
}
document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

function setNet(state) {
  online = state;
  $("net").classList.toggle("off", !online);
  $("netIcon").textContent = online ? "signal_cellular_alt" : "signal_cellular_nodata";
  $("netText").textContent = t(online ? "online" : "offline");
  $("offlineBanner").classList.toggle("hidden", online || !me);
  if (online) flushQueue();
}
window.addEventListener("online", () => setNet(true));
window.addEventListener("offline", () => setNet(false));

// ------------------------------------------------------------------ registration (3 steps)
let step = 1;
const itinerary = [];
$("fState").innerHTML = STATES.map((s) => `<option${s === "Delhi" ? " selected" : ""}>${s}</option>`).join("");
$("placeList").innerHTML = PLACES.map((p) => `<option value="${esc(p)}">`).join("");
$("bloodPick").innerHTML = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((b) => `<button type="button" data-b="${b}">${b.replace("-", "−")}</button>`).join("");
$("bloodPick").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $("fBlood").value = b.dataset.b;
  $("bloodPick").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
};
function drawChips() {
  $("placeChips").innerHTML = itinerary.map((p, i) => `<span class="chip-x">${esc(p)}<button type="button" aria-label="Remove ${esc(p)}" data-i="${i}"><span class="ms">close</span></button></span>`).join("");
}
$("placeChips").onclick = (e) => { const b = e.target.closest("button"); if (b) { itinerary.splice(Number(b.dataset.i), 1); drawChips(); } };
function addPlace() {
  const v = $("placeInput").value.trim();
  if (v && !itinerary.includes(v)) itinerary.push(v);
  $("placeInput").value = ""; drawChips();
}
$("placeInput").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addPlace(); } });
$("placeInput").addEventListener("change", () => { if (PLACES.includes($("placeInput").value)) addPlace(); });
const today = new Date();
$("fStart").value = today.toISOString().slice(0, 10);
$("fEnd").value = new Date(today.getTime() + 6 * 86400000).toISOString().slice(0, 10);

function regStep(n) {
  step = n;
  document.querySelectorAll(".step").forEach((s) => s.classList.toggle("hidden", Number(s.dataset.step) !== n));
  document.querySelectorAll("#stepInd li").forEach((li, i) => { li.classList.toggle("on", i + 1 === n); li.classList.toggle("done", i + 1 < n); });
  $("regBack").classList.toggle("hidden", n === 1);
  $("regNextText").textContent = n === 3 ? t("create") : t("continue");
}
$("regBack").onclick = () => regStep(step - 1);
$("regNext").onclick = async () => {
  if (step === 1 && !$("fName").value.trim()) { $("fName").focus(); toast(t("needName"), "warn"); return; }
  if (step < 3) { regStep(step + 1); window.scrollTo(0, 0); return; }
  addPlace();
  const f = Object.fromEntries(new FormData($("regForm")));
  const phone = (p) => (p || "").trim() ? "+91 " + p.trim() : null;
  const body = {
    ...f, phone: phone(f.phone), emergency_phone: phone(f.emergency_phone), language: LANG,
    band_id: (f.band_id || "").trim().toUpperCase() || null, itinerary: [...itinerary],
  };
  for (const k of Object.keys(body)) if (body[k] === "") body[k] = null;
  $("regNext").disabled = true;
  try {
    me = await api("/api/tourists", { method: "POST", body });
    store.set("me", me);
    toast(`${t("idCreated")} <b>${esc(me.id)}</b>`);
    startApp();
  } catch (err) { toast(esc(err.message), "danger"); }
  $("regNext").disabled = false;
};
$("scanBand").onclick = async () => {
  const id = await connectBand();
  if (id) $("fBand").value = id;
};

$("loginBtn").onclick = async () => {
  const id = $("loginId").value.trim().toUpperCase();
  if (!id) return;
  try { me = await api(`/api/tourists/${encodeURIComponent(id)}`); store.set("me", me); startApp(); }
  catch (err) { toast(esc(err.message), "danger"); }
};
$("logout").onclick = () => {
  if (!confirm(t("logoutQ"))) return;
  ["me", "activeAlert", "queue"].forEach(store.del);
  location.reload();
};

// ------------------------------------------------------------------ tabs
let tab = "home";
function go(name) {
  tab = name;
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + name));
  document.querySelectorAll("#bottomNav button").forEach((b) => b.classList.toggle("active", b.dataset.go === name));
  if (name === "trip" && map) setTimeout(() => { map.invalidateSize(); if (pos) map.setView([pos.lat, pos.lon]); }, 30);
  window.scrollTo(0, 0);
}
document.querySelectorAll("#bottomNav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));

// ------------------------------------------------------------------ rendering
function renderAll() { renderHome(); renderTrip(); renderId(); renderSettings(); }

function firstName() { return (me.name || "").split(" ")[0]; }

function renderHome() {
  if (!me) return;
  const inAlert = me.status === "alert" || (activeAlert && activeAlert.status !== "resolved");
  $("helloName").textContent = `${t("hi")} ${firstName()}`;
  $("helloStatus").className = "badge " + (inAlert ? "b-SOS" : "b-safe");
  $("helloStatus").innerHTML = `<span class="ms fill" style="font-size:14px">${inAlert ? "e911_emergency" : "verified_user"}</span>${t(inAlert ? "alertActive" : "markedSafe")}`;
  $("helloLine").textContent = inAlert ? t("lineAlert") : !me.band_id ? t("lineNoBand") : $("shareLoc").checked ? t("lineShare") : t("lineNoShare");

  const b = me.battery ?? battery;
  $("bandId").textContent = me.band_id || t("noBand");
  $("bandBattery").textContent = b != null ? b + "%" : "–";
  $("bandDot").className = "dot " + (bandConnected ? "on" : me.band_id ? "" : "off");
  $("bandLine").textContent = bandConnected ? t("bandBt") : me.band_id ? `${t("bandSeen")} ${ago(me.last_seen)}` : t("bandAdd");
  $("barBattery").classList.toggle("hidden", b == null);
  $("barBatteryText").textContent = b != null ? b + "%" : "";

  const contact = (me.emergency_name || "").trim();
  $("contactLabel").textContent = contact ? contact.replace(/\s*\(.*\)/, "").split(" ")[0] + (contact.match(/\((.*)\)/) ? ` (${contact.match(/\((.*)\)/)[1]})` : "") : t("family");
  $("callContact").href = me.emergency_phone ? "tel:" + me.emergency_phone.replace(/\s/g, "") : "#";

  renderAlertCard();
  renderQueue();
}

function nearestPlace(kind) {
  if (!pos) return null;
  return places.filter((p) => p.kind === kind).map((p) => ({ ...p, d: Math.round(haversine([pos.lat, pos.lon], [p.lat, p.lon])) })).sort((a, b) => a.d - b.d)[0] || null;
}

function renderAlertCard() {
  const card = $("alertCard");
  const showSos = !activeAlert || activeAlert.status === "queued" || activeAlert.status === "sending";
  $("sosWrap").classList.toggle("hidden", !showSos);
  if (!activeAlert || activeAlert.status === "queued") { card.classList.add("hidden"); return; }
  const a = activeAlert, s = a.status;
  card.classList.remove("hidden");
  if (s === "sending") { card.innerHTML = `<div class="status"><div class="status-top"><div><span class="label">${t("sending")}</span></div></div></div>`; return; }

  const police = nearestPlace("police");
  const done = s === "resolved", ack = s === "acknowledged" || done;
  const title = done ? t("resolvedT") : ack ? t("helpComing") : t("alertSent");
  const sub = done ? t("resolvedSub") : ack ? `${esc(a.assigned_to || t("aUnit"))} ${t("isComing")}` : police ? `${esc(police.name)} ${t("hasLoc")}` : t("alertSentSub");
  const routeFact = a.source === "mesh" ? `<span><span class="ms">hub</span>${t("sentThrough")} ${a.hop_count} ${t(a.hop_count === 1 ? "bandOne" : "bandMany")}</span>` : a.source === "sms" ? `<span><span class="ms">sms</span>${t("sentSms")}</span>` : `<span><span class="ms">smartphone</span>${t("sentApp")}</span>`;
  card.innerHTML = `
    <div class="status ${done ? "done" : ack ? "ack" : ""}">
      <div class="status-top">
        <div><span class="label">${done ? t("closedLabel") : t("activeLabel")}</span><h2>${title}</h2><p>${sub}</p></div>
        <span class="status-icon"><span class="ms fill">${done ? "done_all" : "e911_emergency"}</span></span>
      </div>
      ${done ? `${a.notes ? `<div class="officer-note"><span class="label">${t("officerNote")}</span>${esc(a.notes)}</div>` : ""}
        <button class="btn-primary" id="dismissAlert">${t("done")}</button>` : `
      <div class="tl">
        <div class="tl-row done"><span class="tl-dot"><span class="ms">check</span></span><span>${t("stepReceived")}</span><time>${a.created_at ? shortTime(a.created_at) : ""}</time></div>
        <div class="tl-row ${ack ? "done" : "now"}"><span class="tl-dot"><span class="ms">local_police</span></span><span>${ack ? `<b>${t("stepAssigned")}: ${esc(a.assigned_to || "")}</b>` : `<b>${t("stepWaiting")}</b>`}</span><time>${a.ack_at ? shortTime(a.ack_at) : ""}</time></div>
        <div class="tl-row todo"><span class="tl-dot"><span class="ms">radio_button_unchecked</span></span><span>${t("stepClosed")}</span><time>--:--</time></div>
      </div>
      <div class="facts">${routeFact}<span><span class="ms">my_location</span>${t("locShared")}</span>${me.battery != null ? `<span><span class="ms">battery_5_bar</span>${t("band")} ${me.battery}%</span>` : ""}</div>
      <div class="tip-box"><span class="ms">info</span>${t("stayPut")}</div>
      <a class="btn btn-danger-outline" href="tel:112"><span class="ms">call</span>${t("call112")}</a>
      <button class="text-btn" id="cancelAlert">${t("cancel")}</button>`}
    </div>`;
  const c = $("cancelAlert");
  if (c) c.onclick = () => confirm(t("cancelQ")) && sendAlert("CANCEL");
  const d = $("dismissAlert");
  if (d) d.onclick = () => { activeAlert = null; store.del("activeAlert"); renderHome(); };
}

function renderQueue() {
  const card = $("queueCard");
  if (!queue.length) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const last = queue.find((p) => p.type !== "CANCEL") || queue[0];
  const b = me.band_id || me.id;
  const loc = last.lat != null ? ` ${last.lat.toFixed(5)},${last.lon.toFixed(5)}` : "";
  const body = `${last.type} ${b}${loc}${battery != null ? " B" + battery : ""}`;
  const sep = /iPhone|iPad/.test(navigator.userAgent) ? "&" : "?";
  card.innerHTML = `
    <div class="queued">
      <h3><span class="ms">sync_problem</span>${t("queuedT")}</h3>
      <p>${t("queuedSub")}</p>
      <div class="mesh">
        <div class="node"><i class="me"><span class="ms">watch</span></i>${t("yourBand")}</div><span class="line"></span>
        <div class="node"><i><span class="ms">groups</span></i>${t("otherBands")}</div><span class="line"></span>
        <div class="node"><i><span class="ms">router</span></i>${t("gateway")}</div><span class="line"></span>
        <div class="node"><i class="pol"><span class="ms">local_police</span></i>${t("policeWord")}</div>
      </div>
      ${queue.map((p) => `<div class="outbox"><span><b>${p.type === "CANCEL" ? t("cancelMsg") : (ALERT[p.type] || ALERT.SOS).label}</b><span class="mono">${shortTime(p.ts)}${p.lat != null ? ` · ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}` : ""}</span></span><span class="badge b-neutral">${t("waiting")}</span></div>`).join("")}
      <a class="btn btn-primary" href="sms:${SMS_GATEWAY}${sep}body=${encodeURIComponent(body)}"><span class="ms">sms</span>${t("sendSms")}</a>
      <a class="btn" href="tel:112"><span class="ms">call</span>${t("call112")}</a>
    </div>`;
}

function renderTrip() {
  if (!me) return;
  if (!pos) { $("nearby").innerHTML = `<p class="muted small">${t("locating")}</p>`; }
  else {
    const withD = places.map((p) => ({ ...p, d: Math.round(haversine([pos.lat, pos.lon], [p.lat, p.lon])) })).sort((a, b) => a.d - b.d);
    const pick = [...withD.filter((p) => p.kind === "police").slice(0, 2), ...withD.filter((p) => p.kind === "hospital").slice(0, 2)];
    $("nearby").innerHTML = pick.map((p) => `<div class="place-row"><span><span class="kind ${p.kind}">${t(p.kind + "_s")}</span><b>${esc(p.name)}</b><span class="sub">${dist(p.d)} ${t("away")}</span></span>${p.phone ? `<a class="btn btn-sm btn-primary" href="tel:${esc(p.phone)}"><span class="ms">call</span>${t("callWord")}</a>` : ""}</div>`).join("");
    if (placeLayer) {
      placeLayer.clearLayers();
      pick.forEach((p) => L.circleMarker([p.lat, p.lon], { radius: 7, color: "#fff", weight: 2, fillColor: p.kind === "police" ? "#2B6CB0" : "#8B3A62", fillOpacity: 1 }).bindPopup(esc(p.name)).addTo(placeLayer));
    }
    const zs = geofences.map((z) => ({ ...z, d: Math.max(0, Math.round(haversine([pos.lat, pos.lon], [z.lat, z.lon]) - z.radius_m)) })).sort((a, b) => a.d - b.d).slice(0, 5);
    $("zonesNear").innerHTML = zs.map((z) => `<div class="place-row"><span><span class="badge b-${z.risk}">${t(z.risk === "high" ? "highRisk" : "medRisk")}</span><b>${esc(z.name)}</b><span class="sub">${z.d === 0 ? t("youAreHere") : `${dist(z.d)} ${t("away")}`} · ${esc(z.description || "")}</span></span></div>`).join("") || `<p class="muted small">${t("noZones")}</p>`;
  }
  $("tripDates").textContent = me.trip_start ? `${fmtDate(me.trip_start)} ${t("to")} ${fmtDate(me.trip_end)}` : "";
  $("itinerary").innerHTML = (me.itinerary || []).map((p) => `<span class="chip-plain">${esc(p)}</span>`).join("") || `<span class="muted small">${t("noPlan")}</span>`;
}
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "?");

function renderId() {
  if (!me) return;
  $("idName").textContent = me.name;
  $("idTid").textContent = me.id;
  $("idBlood").textContent = `${t("blood")} ${me.blood_group || "–"}`;
  $("idState").textContent = me.home_state || me.nationality || "";
  $("idValid").textContent = `${t("valid")} ${fmtDate(me.trip_start)} ${t("to")} ${fmtDate(me.trip_end)}`;
  $("idHash").textContent = (me.digital_id || "").slice(0, 12) + "…";
  $("idHash").title = me.digital_id || "";
  $("idEmergency").innerHTML = `
    <span class="k">${t("phoneW")}</span><span class="mono">${esc(me.phone || "–")}</span>
    <span class="k">${t("medicalW")}</span><span>${esc(me.medical_notes || t("none"))}</span>
    <span class="k">${t("contactW")}</span><span>${esc(me.emergency_name || "–")}<br><span class="mono">${esc(me.emergency_phone || "")}</span></span>
    <span class="k">${t("idDocW")}</span><span class="mono">${esc(me.id_doc || "–")}</span>`;
  const qr = $("qr");
  if (window.QRCode && qr.dataset.for !== me.id) {
    qr.innerHTML = "";
    new QRCode(qr, { text: JSON.stringify({ tid: me.id, name: me.name, blood: me.blood_group, h: (me.digital_id || "").slice(0, 16), v: location.origin + "/api/tourists/" + me.id }), width: 220, height: 220, colorDark: "#1B1C19", correctLevel: QRCode.CorrectLevel.M });
    qr.dataset.for = me.id;
  }
}

function renderSettings() {
  if (!me) return;
  $("setBandId").textContent = me.band_id || t("noBand");
}

async function checkLedger() {
  try {
    const r = await api("/api/ledger/verify");
    $("idVerified").className = "badge " + (r.valid ? "b-safe" : "b-SOS");
    $("idVerified").innerHTML = `<span class="ms" style="font-size:14px">${r.valid ? "verified" : "error"}</span>${t(r.valid ? "verified" : "notVerified")}`;
  } catch { $("idVerified").textContent = t("offline"); }
}

// ------------------------------------------------------------------ SOS hold button
const HOLD_MS = 3000, RING = 295.3;
let holdStart = 0, holdRaf = 0;
const sosBtn = $("sosBtn");
function holdTick() {
  const p = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
  $("sosRing").style.strokeDashoffset = RING * (1 - p);
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
  $("sosRing").style.strokeDashoffset = RING;
}
sosBtn.addEventListener("pointerdown", startHold);
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => sosBtn.addEventListener(ev, endHold));
sosBtn.addEventListener("contextmenu", (e) => e.preventDefault());
sosBtn.addEventListener("keydown", (e) => { if (e.key === "Enter" && confirm(t("sendSosQ"))) sendAlert("SOS"); });

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
    activeAlert = { msg_id: p.msg_id, type, status: "sending", created_at: p.ts, source: "app" };
    store.set("activeAlert", activeAlert);
  }
  renderHome();
  try {
    if (!online) throw new Error("offline");
    const r = await api("/api/sos", { method: "POST", body: p });
    if (type === "CANCEL") {
      activeAlert = null; store.del("activeAlert");
      toast(t("cancelled"));
    } else {
      activeAlert = { ...activeAlert, alert_id: r.alert_id, status: "open" };
      store.set("activeAlert", activeAlert);
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
  const before = queue.length;
  for (const p of [...queue]) {
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
  if (before !== queue.length) toast(t("delivered"));
  renderHome();
}
setInterval(() => online && flushQueue(), 15000);

// ------------------------------------------------------------------ location
function initMap() {
  map = L.map("map", { zoomControl: false }).setView(pos ? [pos.lat, pos.lon] : DEFAULT_POS, 14);
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
    L.circle([z.lat, z.lon], { radius: z.radius_m, color: z.risk === "high" ? "#BA1A1A" : "#B7791F", weight: 1.5, dashArray: "5 5", fillOpacity: 0.1 })
      .bindPopup(`<b>${esc(z.name)}</b><br>${esc(z.description || "")}`).addTo(zoneLayer);
  }
}

function showZones(zones) {
  const b = $("zoneBanner");
  if (!zones.length) { b.classList.add("hidden"); b.dataset.zone = ""; return; }
  const z = zones.find((x) => x.risk === "high") || zones[0];
  b.className = "notice " + (z.risk === "high" ? "danger" : "warn");
  b.innerHTML = `<div class="notice-top"><b>${t("zoneIn")}</b><span class="ms">warning</span></div><p>${t("nearZone")} ${esc(z.name)}. ${esc(z.description || "")}</p>`;
  if (b.dataset.zone !== String(z.id) && navigator.vibrate) navigator.vibrate([300, 150, 300]);
  b.dataset.zone = z.id;
}

async function setPos(lat, lon, source, force = false) {
  pos = { lat, lon, ts: Date.now() / 1000 };
  store.set("pos", pos);
  $("coords").textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  if (meMarker) { meMarker.setLatLng([lat, lon]); if (force || source === "gps-first") map.panTo([lat, lon]); }
  showZones(geofences.filter((z) => haversine([lat, lon], [z.lat, z.lon]) <= z.radius_m)); // works offline too
  renderTrip();

  const moved = haversine([lat, lon], [lastSent.lat, lastSent.lon]);
  const due = Date.now() - lastSent.ts > 30000 || moved > 25 || force;
  if ($("shareLoc").checked && online && me && due) {
    lastSent = { ts: Date.now(), lat, lon };
    try { await api(`/api/tourists/${me.id}/location`, { method: "POST", body: { lat, lon, battery, source: source === "demo" ? "demo" : "app" } }); }
    catch (e) { /* retried with the next position */ }
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
  toast(t("noGps"), "warn", 7000);
  $("demoLoc").checked = true;
  setPos(DEFAULT_POS[0] + (Math.random() - 0.5) * 0.01, DEFAULT_POS[1] + (Math.random() - 0.5) * 0.01, "demo", true);
}
setInterval(() => pos && setPos(pos.lat, pos.lon, "heartbeat"), 30000);
$("shareLoc").onchange = () => renderHome();

// ------------------------------------------------------------------ band (Bluetooth + manual)
async function linkBand(id) {
  me = await api(`/api/tourists/${me.id}/band`, { method: "POST", body: { band_id: id } });
  store.set("me", me); renderAll();
}
$("bandEdit").onclick = async () => {
  const id = prompt(t("bandPrompt"), me.band_id || "BAND-");
  if (id == null) return;
  try { await linkBand(id); } catch (e) { toast(esc(e.message), "danger"); }
};

async function connectBand() {
  if (!navigator.bluetooth) { toast(t("noBt"), "warn", 7000); return null; }
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "SURAKSHA" }], optionalServices: [BLE_SERVICE, "battery_service"] });
    const server = await device.gatt.connect();
    const tx = await (await server.getPrimaryService(BLE_SERVICE)).getCharacteristic(BLE_TX);
    await tx.startNotifications();
    tx.addEventListener("characteristicvaluechanged", (e) => onBandMessage(new TextDecoder().decode(e.target.value)));
    bandConnected = true;
    device.addEventListener("gattserverdisconnected", () => { bandConnected = false; toast(t("bandLost"), "warn"); renderHome(); });
    return device.name.replace(/^SURAKSHA-?/, "BAND-");
  } catch (e) { if (e.name !== "NotFoundError") toast(esc(e.message), "danger"); return null; }
}
$("btConnect").onclick = async () => {
  const id = await connectBand();
  if (!id) return;
  if (id !== me.band_id) { try { await linkBand(id); } catch (e) { toast(esc(e.message), "danger"); return; } }
  toast(`${esc(id)} ${t("connected")}`);
  renderHome();
};

// The band sends plain text lines: "SOS", "FALL", "CANCEL", "BAT:82", "HR:142"
function onBandMessage(msg) {
  msg = msg.trim().toUpperCase();
  if (msg.startsWith("BAT:")) { battery = parseInt(msg.slice(4), 10); renderHome(); return; }
  if (msg.startsWith("HR:")) { const hr = parseInt(msg.slice(3), 10); if (hr > 150 || hr < 40) sendAlert("HEALTH", { heart_rate: hr }); return; }
  if (msg === "FALL") return fallCountdown();
  if (msg === "SOS" || msg === "CANCEL") sendAlert(msg);
}

// ------------------------------------------------------------------ fall detection (phone sensors)
let fallTimer = null;
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || fallTimer) return;
  const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
  if (g > 30) fallCountdown(); // roughly a 3g impact
}
$("fallDetect").onchange = async (e) => {
  if (e.target.checked) {
    if (typeof DeviceMotionEvent !== "undefined" && DeviceMotionEvent.requestPermission) {
      try { if ((await DeviceMotionEvent.requestPermission()) !== "granted") { e.target.checked = false; return; } } catch { e.target.checked = false; return; }
    }
    window.addEventListener("devicemotion", onMotion);
  } else window.removeEventListener("devicemotion", onMotion);
  $("fallTest").classList.toggle("hidden", !e.target.checked);
};
$("fallTest").onclick = (e) => { e.preventDefault(); e.stopPropagation(); fallCountdown(); };

function fallCountdown() {
  if (fallTimer) return;
  const TOTAL = 15, C = 389.6;
  let n = TOTAL;
  if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 500]);
  const modal = $("modal");
  $("modalBody").innerHTML = `<h3>${t("fallQ")}</h3><p class="muted" style="margin:0">${t("fallSub")}</p>
    <div class="fall-ring"><svg viewBox="0 0 132 132"><circle class="bg" cx="66" cy="66" r="62"/><circle class="fg" id="fRing" cx="66" cy="66" r="62" style="stroke-dashoffset:0"/></svg><div class="count-big" id="fCount">${n}</div></div>
    <div class="stack"><button class="btn-primary" id="fOk">${t("imOk")}</button><button class="btn-danger-outline" id="fSend">${t("sendNow")}</button></div>
    <p class="muted small center" style="margin:12px 0 0">${t("vibrating")}</p>`;
  const stop = () => { clearInterval(fallTimer); fallTimer = null; modal.classList.remove("show"); };
  $("fOk").onclick = stop;
  $("fSend").onclick = () => { stop(); sendAlert("FALL"); };
  modal.classList.add("show");
  fallTimer = setInterval(() => {
    n--;
    if (n <= 0) { stop(); sendAlert("FALL"); return; }
    $("fCount").textContent = n;
    $("fRing").style.strokeDashoffset = C * (1 - n / TOTAL);
  }, 1000);
}

// ------------------------------------------------------------------ notices + live updates
function showAdvisory(a) {
  if (!a) return;
  const b = $("advisory");
  b.className = "notice " + (a.level === "danger" ? "danger" : a.level === "warning" ? "warn" : "");
  b.innerHTML = `<div class="notice-top"><b>${t("advisory")}</b><span>${shortTime(a.created_at)}</span></div><p>${esc(a.message)}</p>`;
  store.set("advisory", a);
}

function mergeAlert(d) {
  activeAlert = {
    ...(activeAlert || {}), msg_id: d.msg_id, alert_id: d.id, type: d.type, status: d.status, assigned_to: d.assigned_to,
    notes: d.notes, source: d.source, hop_count: d.hop_count, created_at: d.created_at, ack_at: d.ack_at, resolved_at: d.resolved_at,
  };
  store.set("activeAlert", activeAlert);
}

function onEvent(ev, d) {
  if (!me) return;
  if ((ev === "alert_new" || ev === "alert_update") && d.tourist_id === me.id) {
    const personal = ["SOS", "FALL", "HEALTH", "INACTIVITY"].includes(d.type);
    const ours = activeAlert && (activeAlert.alert_id === d.id || activeAlert.msg_id === d.msg_id);
    if (personal && (ours || (ev === "alert_new" && (!activeAlert || activeAlert.status === "resolved")))) {
      const wasAck = activeAlert && activeAlert.status === "acknowledged";
      mergeAlert(d);
      if (d.status === "acknowledged" && !wasAck && navigator.vibrate) navigator.vibrate([100, 50, 100]);
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
    activeAlert = null; store.del("activeAlert"); refreshFromServer();
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
      if (a) mergeAlert(a); else { activeAlert = null; store.del("activeAlert"); }
    }
    drawZones();
    checkLedger();
  } catch (e) { /* offline: keep the cached data */ }
  renderAll();
}

// ------------------------------------------------------------------ boot
function startApp() {
  $("viewRegister").classList.add("hidden");
  $("viewApp").classList.remove("hidden");
  applyI18n();
  setNet(navigator.onLine);
  if (!map) initMap();
  renderAll();
  showAdvisory(store.get("advisory"));
  refreshFromServer();
  startGeolocation();
  const start = location.hash.slice(1);
  go(["home", "trip", "id", "settings"].includes(start) ? start : "home");
  if (navigator.getBattery) navigator.getBattery().then((b) => { battery = Math.round(b.level * 100); b.onlevelchange = () => (battery = Math.round(b.level * 100)); });
}

setLang(LANG);
live(onEvent, (ok) => { if (ok && me) refreshFromServer(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
if (me) startApp(); else { $("viewRegister").classList.remove("hidden"); regStep(1); }
