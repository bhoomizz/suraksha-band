# Suraksha Band: Smart Tourist Safety System (SIH)

A wearable safety band for tourists with an SOS button, fall detection, GPS and a **LoRa mesh** between bands, so an SOS reaches the police even with **no internet or mobile network**.

## What's inside

| Folder | What it is |
|---|---|
| `backend/` | Python FastAPI server: REST API, WebSocket live feed, SQLite database, geofencing, inactivity watcher, SMS parser, hash-chained digital ID |
| `web/dashboard/` | Police / tourism **control room**: live map, alert queue, case file, assign unit and close case, SOS route, nearest police and hospital, risk zones, notices to tourists |
| `web/reports/` | **Daily report**: alerts by type and by hour, time to assign a unit, busiest risk zones, full alert table, CSV export and print |
| `web/tourist/` | **Tourist app** (installable PWA): 3-step sign-up, Home / Trip / ID / Settings tabs, 3-second SOS hold, live "help is on the way" tracking, offline queue with SMS fallback, risk-zone warnings, fall detection, Bluetooth band pairing, English and Hindi |
| `web/simulator/` | **Mesh simulator**: demo band-to-band relay without any hardware |
| `web/shared/` | Design tokens (`theme.css`), logo and shared helpers used by every page |
| `firmware/band/` | ESP32 band sketch: LoRa mesh relay, SOS button, GPS, fall detection, BLE to phone |
| `firmware/gateway/` | ESP32 gateway sketch: LoRa to server over Wi-Fi, store and forward, SIM800L SMS fallback |

## Run it

Double-click `start.bat`, or run:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then open:

- http://localhost:8000/ for the home page
- http://localhost:8000/dashboard/ for the control room
- http://localhost:8000/tourist/ for the tourist app
- http://localhost:8000/simulator/ for the mesh simulator
- http://localhost:8000/reports/ for the daily report
- http://localhost:8000/docs for the API docs (Swagger)

Demo data is seeded around Shillong on first run: six Indian tourists from Delhi, Kerala, West Bengal, Punjab, Tamil Nadu and Maharashtra, five risk zones (Elephant Falls, Umiam Lake, Shillong Peak, a forest belt and Laitlum Canyon), and local police stations and hospitals. To start fresh, stop the server and delete `backend/suraksha.db`. The coordinates and phone numbers are **sample values** and must be replaced with verified data.

## Demo script for judges (about 5 minutes)

1. Open the **dashboard** and the **simulator** side by side.
2. In the simulator, click **1. Tourist gets lost at Elephant Falls**. Kabir Singh's band sends its location through the mesh, and the control room raises a *Risk zone* alert because Elephant Falls is a high-risk zone.
3. Click **2. Tourist presses SOS**. Watch the message hop band to band until it reaches the gateway. The control room beeps and opens the case file: the route the SOS took, blood group, medical notes (diabetic), emergency contact, and the nearest police station and hospital.
4. Click **3. One band's battery dies**. The SOS finds another way through.
5. Click **4. The gateway loses internet**. The gateway keeps the message and sends it when the connection returns.
6. In the control room, type "PCR Van 12" and click **Assign unit**. Open the **tourist app** in a phone-sized window, choose "I already have a tourist ID" and enter Kabir's ID (it's in the control room's Tourists tab), and "Help is on the way" updates live.
7. In the tourist app, turn the network off (DevTools → Network → Offline) and hold SOS. It is queued, an **SMS fallback** is offered, and the SOS sends automatically when you go back online.
8. Click **Send notice** in the control room. It appears at the top of the tourist app straight away.
9. Open **Reports** to show the day's alerts, response times and busiest risk zones.
10. The tourist ID tab shows **Verified**, which checks the tamper-evident ID chain (`/api/ledger/verify`).

## Channels an SOS can take

```
Band button ──LoRa mesh──► other bands ──► Gateway ──Wi-Fi/GSM──► Server ──WebSocket──► Dashboard
     └──BLE──► Phone app ──Internet──► Server
                     └──no internet──► SMS ──► /api/sms/inbound
```

The server de-duplicates by `msg_id`, so the same SOS arriving from two gateways and the phone becomes one alert.

## Key API endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/tourists` | Register tourist and issue digital ID |
| POST | `/api/tourists/{id}/location` | Location update (runs a geofence check) |
| POST | `/api/sos` | SOS / FALL / HEALTH / CANCEL from the app |
| POST | `/api/gateway/ingest` | Packets from a LoRa gateway |
| POST | `/api/sms/inbound` | SMS fallback, body like `SOS BAND-1001 25.57,91.89 B80` |
| GET | `/api/alerts?status=active` | Alert queue with nearest police and hospital |
| POST | `/api/alerts/{id}/ack` and `/resolve` | Response workflow |
| GET/POST/DELETE | `/api/geofences` | Risk zones |
| POST | `/api/advisories` | Broadcast to all tourists |
| WS | `/ws` | Live events: `alert_new`, `alert_update`, `tourist_update`, `advisory` and others |

## Testing on a real phone

The phone and the laptop must be on the same Wi-Fi. Open `http://<laptop-ip>:8000/tourist/`. Browsers only allow **GPS, Bluetooth and offline install over HTTPS**, so for the full phone experience expose the server over HTTPS, for example with `cloudflared tunnel --url http://localhost:8000` or `ngrok http 8000`. Without HTTPS, use the "Demo: tap map to move" toggle.

## Hardware bill of materials (per band, approximate)

ESP32 LoRa board (SX1276, 865–867 MHz) · NEO-6M GPS · MPU6050 accelerometer · push button · buzzer and vibration motor · 1000 mAh Li-Po with TP4056 charger · optional MAX30102 heart-rate sensor. The gateway is the same board plus a SIM800L GSM module.

## Production next steps

Authentication for the dashboard (police logins and roles), HTTPS, encrypted LoRa payloads (AES-128 with per-band keys), PostgreSQL, a real SMS provider webhook, verified police and hospital data, and a native app (Flutter) for background location and BLE.
