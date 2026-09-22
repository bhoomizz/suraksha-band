# Google Stitch prompts for Suraksha Band

How to use:
1. Paste **Prompt 0 (style guide)** first, so every screen shares the same look.
2. Then paste one screen prompt at a time. Use **Mobile** for the tourist app and **Web** for the dashboard, simulator and landing page.
3. If a result still looks "AI-made" (gradients, glow, dark neon, stock 3D renders), reply with: "Remove all gradients, glows and shadows. Use flat solid colors on a light background, like Google Maps."
4. Export the HTML/CSS and give it to Claude to connect to the existing code.

---

## Prompt 0: Style guide (paste first)

```
Style guide for "Suraksha", a tourist safety app with a wearable SOS band. It is used by tourists in Meghalaya and by police officers in a control room. It should look like a real, carefully made product from an experienced design team, closer to Google Maps, Citymapper, Apple's Emergency SOS screen or a well-designed railway or government service. It should NOT look like a crypto dashboard, a sci-fi interface or an AI-generated concept.

Colors (flat, solid, no gradients):
- Background: warm off-white #F6F4EF. Cards: white #FFFFFF with a 1px border #E4E0D8.
- Text: near-black ink #1D1C1A. Secondary text: #6B675F.
- Brand color: deep forest green #1E5B3F (inspired by Meghalaya's hills and Indian road signage). Use it for primary buttons, links and the logo only.
- Emergency red #C8321E is used ONLY for the SOS button and active emergencies.
- Status colors, muted and printed-looking rather than neon: amber #B7791F (warning / risk zone), green #2F7D4F (safe / resolved), blue #2B6CB0 (information), plum #8B3A62 (fall alert).
- Status badges: light tinted background with dark text in the same hue, small rounded rectangles (4px radius), not glowing pills.

Type:
- "Source Sans 3" or "Public Sans" for everything, with "IBM Plex Mono" only for band IDs, tourist IDs and coordinates.
- Clear sizes: 28/20/16/14/12px. Headings semi-bold, not heavy. Sentence case everywhere, no ALL CAPS headings.

Shapes and details:
- 8px corner radius on cards, 6px on buttons and inputs. 1px borders instead of shadows. At most a very soft shadow on floating elements like the map legend.
- Generous, consistent spacing on an 8px grid. Left-aligned text. Real content density, not huge empty hero areas.
- Simple line icons at 1.5px stroke (like Material Symbols Outlined or Lucide). No emoji, no 3D icons, no glowing orbs.
- Maps use a normal light street map style (like Google Maps default), not a dark or inverted map.

Avoid: gradients, neon, glow effects, glassmorphism/blur, dark navy or black backgrounds, purple-blue "tech" palettes, floating 3D blobs, stock illustrations of people with phones, oversized rounded pills everywhere, fake statistics, and marketing buzzwords.

Writing style for all text in the UI: short, plain and specific, like a helpful local guide or a police control-room form. Examples: "Hold for 3 seconds to call for help", "Police have been told", "Assign a unit", "Close case". No slogans, no exclamation marks.

Also provide a dark version for night-shift control-room use: warm dark grey #1E1D1B background, not navy, with the same flat approach.
```

---

## Prompt 1: Tourist app, sign-up (Mobile)

```
Mobile screen for the Suraksha tourist app, following the Suraksha style guide (light warm background, forest green brand color, flat design).

Screen: registering a trip, done once when the tourist collects their band at the airport, hotel or tourist office.
- Simple top bar: the wordmark "Suraksha" in forest green on the left, a small "English / हिन्दी" language switch on the right.
- Title "Register your trip". One line below: "Police only see these details if you send an SOS."
- The form is split into 3 short steps with a plain step indicator: "1 About you · 2 In an emergency · 3 Your trip". Show step 1 filled in:
  Full name, Phone number, Nationality (dropdown, default India), Aadhaar or passport number (helper text: "We only keep the last 4 digits").
- Step 2 fields (show them collapsed below or as the next screen): Blood group (a row of small selectable boxes: A+ A− B+ B− O+ O− AB+ AB−), Allergies or medical conditions, Emergency contact name, Emergency contact phone.
- Step 3 fields: Trip dates (from – to), Places you plan to visit (small removable tags: "Elephant Falls", "Umiam Lake"), Band number (printed on the band, e.g. BAND-1001) with a "Scan band" button.
- A full-width forest green "Continue" button at the bottom, with a text link "I already have a tourist ID".
```

## Prompt 2: Tourist app, home screen with SOS (Mobile), the most important screen

```
Mobile home screen for the Suraksha tourist app, following the Suraksha style guide. A scared tourist must be able to find and use SOS in 2 seconds, so the layout is calm and uncluttered.

- Top bar: "Suraksha" wordmark, a small connection indicator ("Online" or "No signal"), and the band status: a band icon with "82%".
- Optional notice from authorities (amber left border, white card): "Meghalaya Tourism · 2:10 PM: Heavy rain expected near Cherrapunji after 4 PM. Avoid trekking routes today."
- Optional risk-zone notice (red left border): "You are near Elephant Falls. The rocks are slippery, so stay behind the railings."
- A small greeting: "Hi Aarav" with the status "You're marked safe".
- The SOS button: a large solid red circle (about 200px), flat, with a white "SOS" label and "Hold for 3 seconds" below it inside the circle. While it is held, a white ring fills around it. No glow, no gradient.
- A row of 3 plain call buttons with icons: "Police 112", "Tourist helpline 1363", "Neha (sister)".
- A "Your band" section: "BAND-1001 · connected by Bluetooth · battery 82%", switches for "Share my location with police", "Detect falls" and "Demo: move by tapping the map".
- A "Nearby" section: a small light street map with your blue location dot, risk zones as light red and amber circles, and pins. Under it, two rows: "Sadar Police Station · 1.2 km · Call" and "Civil Hospital · 1.4 km · Call".
- A "Tourist ID" card that looks like a real printed ID or boarding pass: a QR code on the left; on the right the name, tourist ID TID-A3773B in mono, blood group B+ and "Valid 20–28 Sep 2026".
```

## Prompt 3: Tourist app, after SOS is sent (Mobile)

```
Mobile screen for the Suraksha tourist app right after an SOS is sent, following the Suraksha style guide. It should reassure, like tracking a cab or a delivery, without being dramatic.

- The SOS button area is replaced by a clear status panel with a red top border: the title "Help is on the way" and the text "Police at Sadar Police Station have your location."
- A simple vertical progress list with dots and lines:
  • "Alert received" · 11:42
  • "Officer assigned: PCR Van 12" · 11:43 (current step, bold)
  • "Case closed" (grey, not yet done)
- Small facts row: "Sent through 4 nearby bands" · "Location shared" · "Band battery 70%".
- A small map showing your location and the police van's approximate route.
- A plain instruction: "If it's safe, stay where you are and keep the band on."
- Buttons: "Call 112" (red outline) and a text button "I'm safe now, cancel the alert".
Also show the finished state: a green top border, "Your case is closed", "Officer note: Tourist found at the viewpoint, no injury.", and a "Done" button.
```

## Prompt 4: Tourist app, no signal (Mobile)

```
Mobile screen for the Suraksha tourist app when the phone has no internet, following the Suraksha style guide.
- The connection indicator in the top bar says "No signal".
- A status card with an amber left border, titled "Your SOS is saved on this phone", with the text: "It will be sent as soon as you have signal. Your band is also passing it to other bands nearby, which can reach the police without internet."
- A simple line diagram (flat icons, thin lines): your band → 2 other bands → a gateway box on a police station → police. Label it "How your band gets help without internet".
- A "Not sent yet" list with one row: "SOS · 11:42 AM · 25.5400, 91.8230".
- Buttons: "Send as SMS" (primary) and "Call 112".
- The map is greyed out with the label "Map saved for offline use".
```

## Prompt 5: Tourist app, fall detected (Mobile)

```
Mobile dialog for the Suraksha app shown when the band detects a fall, following the Suraksha style guide.
- A white dialog over a dimmed screen.
- The title "Did you fall?" with the text "We'll alert the police in 15 seconds unless you tell us you're okay."
- A large countdown number "12" with a thin ring that empties as time runs out.
- Two large buttons, stacked: "I'm okay" (green, primary) and "Send help now" (red outline).
- Small text at the bottom: "Your band is vibrating."
```

---

## Prompt 6: Police control room dashboard (Web, desktop 1440px)

```
Desktop web app for the Suraksha control room, used by police and tourism officers on a desktop monitor during a shift. It follows the Suraksha style guide: light warm background, flat, dense and practical, like a professional dispatch or logistics tool (think Google Maps + an airline operations screen). Everything fits on one screen without scrolling the page.

- Top bar (white, thin bottom border): "Suraksha control room · East Khasi Hills", a small green dot with "Live", the current officer "Insp. Rajesh Verma" on the right, and buttons "Send notice to tourists" and "Add risk zone".
- A row of plain numbers just below: "124 tourists active · 3 open alerts (red) · 1 being handled · 18 closed today · 42 s average response · 2 of 2 gateways online". Use simple text with dividers, not big colorful tiles.
- Left column (340px): an alert queue. Tabs "Alerts" and "Tourists". Filters "Open", "Closed", "All". Each alert row: a small colored type label (SOS, Fall, Risk zone, No signal, Heart rate), the tourist name, one plain line ("Pressed SOS", "Entered Elephant Falls area", "No signal for 20 min in the forest belt"), how it arrived ("via 4 bands" / "via app" / "via SMS"), and the time ("11:42 · 2 min ago"). Open SOS rows have a red left border.
- Center: a large light street map of Shillong. Red markers for open alerts, small green dots for tourists, light red and amber circles for risk zones, blue "P" markers for police stations, "H" for hospitals, small square markers for mesh gateways, and a thin dotted line showing how the SOS travelled from band to band to the gateway. A compact legend in the corner.
- Right column (380px), details of the selected alert, laid out like a case file:
  • "SOS · Open" and the name "Kenji Tanaka, Japan"
  • An "Assign" section: a unit field (placeholder "e.g. PCR Van 12"), a notes field, and buttons "Assign unit", "Close case" and "Call tourist"
  • Timeline: "11:42:05 Alert received through gateway at Police Bazar", "11:42:40 Assigned to PCR Van 12 (35 s)"
  • Location: coordinates in mono, a "Get directions" link, band battery 70%
  • Route: BAND-1004 → BAND-2003 → BAND-2007 → Police Bazar gateway, as small plain mono labels with arrows
  • Tourist: phone, passport ending 4334, blood group AB+, "Medical: diabetic" in a light red box, emergency contact "Yui Tanaka +81…", trip dates
  • Closest police station and hospital, with distance and a phone number
Use real-looking, specific data, not lorem ipsum.
```

## Prompt 7: Dashboard, tourists and reports (Web)

```
Desktop web screen for the Suraksha control room (same style and layout as the main dashboard), showing the "Tourists" tab and a simple daily report.
- Left: a search box "Search by name, band or tourist ID" and a list of tourists: name, country, band number, "last seen 3 min ago", battery (in red if under 20%), and status "Safe" or "Alert".
- Right: the selected tourist's details, past alerts, and their route today drawn as a line on the map.
- A "Today" report page with plain, well-labelled charts in the brand colors (flat, no 3D, no gradients): alerts by type (horizontal bar chart), alerts by hour (column chart), average response time by day (line chart), and a table of the busiest risk zones with counts.
```

## Prompt 8: Dashboard dialogs (Web)

```
Two dialogs for the Suraksha control room, in the same flat light style:
1. "Send notice to tourists": a message box (placeholder "Heavy rain near Cherrapunji after 4 PM. Avoid trekking routes."), a choice of "Information", "Warning" or "Danger", a small preview of how it will look on a tourist's phone, and buttons "Cancel" and "Send to 124 tourists".
2. "Add risk zone": the selected location in mono, Name, Level ("High: alert police when a tourist enters" / "Medium: warn the tourist only"), a Radius slider in metres with a circle preview on a small map, "Advice for tourists", and buttons "Cancel" and "Save zone".
```

---

## Prompt 9: Mesh network simulator (Web)

```
Desktop web tool for demonstrating how Suraksha bands pass an SOS to each other without internet. It is used during a live hackathon demo in front of judges. Follow the Suraksha style guide: light, flat, clear and technical, like a network diagram in a textbook or a transit map.
- Left panel: the title "Mesh simulator" and the text "See how an SOS reaches the police with no mobile network."
  Demo steps as a numbered checklist the presenter clicks through: "1 Tourist gets lost at Elephant Falls", "2 Tourist presses SOS", "3 One band's battery dies", "4 The gateway loses internet".
  Settings: sliders for "Radio range: 1.8 km", "Maximum hops: 8" and "Delay per hop: 0.6 s", plus switches "Show radio range" and "Send location every 20 s".
  Four small counters: "Messages sent", "Passed on", "Delivered", "Time to deliver".
- Center: a light map with nodes: tourist bands as green circles with first names, other bands as small grey circles, gateways as dark squares, and switched-off bands hollow. When an SOS is sent, draw thin red lines that appear one hop at a time along the path.
- Right: an event log in a readable mono font with timestamps, for example: "11:42:05 Kenji's band sent SOS", "11:42:06 BAND-2003 passed it on (7 hops left)", "11:42:08 Police Bazar gateway received it after 4 hops", "11:42:08 Server created alert #12", "11:42:09 Gateway offline: message stored, will retry".
```

## Prompt 10: Project landing page (Web)

```
A simple, honest landing page for the Suraksha Band hackathon project, following the Suraksha style guide. It should read like a real product page written by the team, not an AI marketing page.
- Header: the wordmark "Suraksha" and links "How it works", "Hardware", "Try it", "GitHub".
- Top section: a plain headline "A safety band for tourists that works without mobile network", one paragraph: "Press and hold the button on the band. The alert travels from band to band until it reaches a gateway with internet, then shows up on the police control room screen with your location and medical details." Buttons "Open control room" and "Try the tourist app". On the right, a real-looking product photo of a simple black fabric wristband with a single red button (flat studio photo, no glow, no floating elements).
- "How it works": 4 numbered steps with simple line icons: "1 Press SOS on the band", "2 Nearby bands pass it on over LoRa radio", "3 A gateway sends it to the server", "4 Police see it on the map and assign a unit". Below, one line: "If your phone has signal, the app also sends it directly, or by SMS."
- "What's in the band": a clean labelled diagram of the parts: ESP32 board, LoRa radio, GPS, motion sensor for fall detection, heart-rate sensor, battery, SOS button.
- "Try it": 3 plain cards linking to the control room, the tourist app and the mesh simulator.
- A "Numbers" row that we will fill in ourselves: leave placeholders "[range per hop]", "[battery life]", "[cost per band]".
- Footer: "Built by [team name] for Smart India Hackathon 2026", with a GitHub link.
```
