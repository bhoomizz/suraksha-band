// Shared helpers for the dashboard, tourist app and mesh simulator.
const Suraksha = (() => {
  const base = location.origin;

  async function api(path, opts = {}) {
    const init = { method: opts.method || "GET", headers: {} };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(base + path, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${res.status})`);
    return data;
  }

  // WebSocket with automatic reconnect. onEvent(event, data); onStatus(connected)
  function live(onEvent, onStatus = () => {}) {
    let ws, ping, retry = 1000;
    const open = () => {
      ws = new WebSocket(base.replace(/^http/, "ws") + "/ws");
      ws.onopen = () => { retry = 1000; onStatus(true); ping = setInterval(() => ws.readyState === 1 && ws.send("ping"), 25000); };
      ws.onmessage = (m) => { try { const x = JSON.parse(m.data); onEvent(x.event, x.data); } catch (e) { console.error(e); } };
      ws.onclose = () => { clearInterval(ping); onStatus(false); setTimeout(open, retry); retry = Math.min(retry * 2, 15000); };
      ws.onerror = () => ws.close();
    };
    open();
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function ago(ts) {
    if (!ts) return "never";
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 45) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }

  const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dist = (m) => (m == null ? "" : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
  const duration = (s) => (s == null ? "–" : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`);

  function haversine(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const ALERT = {
    SOS: { label: "SOS", color: "#BA1A1A", text: "Pressed SOS" },
    FALL: { label: "Fall", color: "#8B3A62", text: "Band detected a fall" },
    HEALTH: { label: "Heart rate", color: "#5B4A9E", text: "Unusual heart rate" },
    GEOFENCE: { label: "Risk zone", color: "#B7791F", text: "Entered a risk zone" },
    INACTIVITY: { label: "No signal", color: "#2B6CB0", text: "Band has gone quiet" },
  };
  const STATUS = { open: "Open", acknowledged: "Unit assigned", resolved: "Closed", safe: "Safe", alert: "Alert" };
  const via = (a) => a.source === "mesh" ? (a.hop_count ? `via ${a.hop_count} band${a.hop_count === 1 ? "" : "s"}` : "via mesh") : a.source === "app" ? "via app" : a.source === "sms" ? "via SMS" : "automatic";

  function toast(html, kind = "", ms = 5000) {
    let wrap = document.querySelector(".toast-wrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.className = "toast-wrap"; document.body.appendChild(wrap); }
    const t = document.createElement("div");
    t.className = "toast " + kind;
    t.innerHTML = html;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function beep(times = 3) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "square"; o.frequency.value = i % 2 ? 660 : 880;
        g.gain.value = 0.06;
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.22); o.stop(ctx.currentTime + i * 0.22 + 0.16);
      }
    } catch (e) { /* audio blocked until user interacts */ }
  }

  function tiles(map) {
    return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "map-tiles",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }

  const isPhone = () => window.matchMedia("(max-width: 900px)").matches;
  // Tap the legend title to open or fold the legend (folding only applies on phones).
  document.addEventListener("click", (e) => {
    const title = e.target.closest(".legend-title");
    if (title) title.parentElement.classList.toggle("open");
  });

  return { api, live, esc, ago, clock, dist, duration, haversine, ALERT, STATUS, via, toast, beep, tiles, isPhone };
})();
