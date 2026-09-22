/*
  Suraksha Mesh Gateway (ESP32 + LoRa + Wi-Fi, optional SIM800L for SMS fallback)
  Listens on the mesh and uploads packets to the server at POST /api/gateway/ingest.
  When Wi-Fi is down it buffers packets (store and forward) and sends SOS by SMS through the SIM800L.

  Libraries: LoRa (Sandeep Mistry), ArduinoJson (v7), built-in WiFi + HTTPClient
  NOTE: This is a prototype sketch that has not been compiled against real hardware.
*/
#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#define GATEWAY_ID  "GW-POLICEBAZAR"
#define GW_LAT      25.5770
#define GW_LON      91.8855
#define WIFI_SSID   "your-wifi"
#define WIFI_PASS   "your-password"
#define SERVER_URL  "http://192.168.1.10:8000/api/gateway/ingest"   // your laptop's LAN IP
#define SMS_NUMBER  "+919000000000"                                  // number that forwards to /api/sms/inbound
#define LORA_FREQ   866E6
#define LORA_SCK 5
#define LORA_MISO 19
#define LORA_MOSI 27
#define LORA_CS 18
#define LORA_RST 14
#define LORA_IRQ 26
#define SIM_RX 16
#define SIM_TX 17

HardwareSerial SIM(2);
String buffer[32];
int buffered = 0;
String seen[64]; uint8_t seenIdx = 0;

bool alreadySeen(const String& id) {
  for (auto& s : seen) if (s == id) return true;
  seen[seenIdx] = id; seenIdx = (seenIdx + 1) % 64;
  return false;
}

// "SB1|msgId|band|TYPE|lat|lon|bat|ttl|h1>h2" -> JSON object in the packets array
void addPacket(JsonArray arr, const String& pkt) {
  String f[9]; int start = 0;
  for (int i = 0; i < 9; i++) {
    int bar = pkt.indexOf('|', start);
    f[i] = bar < 0 ? pkt.substring(start) : pkt.substring(start, bar);
    if (bar < 0) break;
    start = bar + 1;
  }
  JsonObject o = arr.add<JsonObject>();
  o["msg_id"] = f[1]; o["band_id"] = f[2]; o["type"] = f[3];
  if (f[4].length()) { o["lat"] = f[4].toFloat(); o["lon"] = f[5].toFloat(); }
  o["battery"] = f[6].toInt();
  JsonArray hops = o["hops"].to<JsonArray>();
  int s = 0;
  while (true) { int g = f[8].indexOf('>', s); hops.add(g < 0 ? f[8].substring(s) : f[8].substring(s, g)); if (g < 0) break; s = g + 1; }
  hops.add(GATEWAY_ID);
}

bool upload(String* pkts, int n) {
  if (WiFi.status() != WL_CONNECTED) return false;
  JsonDocument doc;
  doc["gateway_id"] = GATEWAY_ID; doc["gateway_lat"] = GW_LAT; doc["gateway_lon"] = GW_LON;
  JsonArray arr = doc["packets"].to<JsonArray>();
  for (int i = 0; i < n; i++) addPacket(arr, pkts[i]);
  String body; serializeJson(doc, body);
  HTTPClient http; http.begin(SERVER_URL); http.addHeader("Content-Type", "application/json");
  int code = http.POST(body); http.end();
  Serial.printf("Upload %d packet(s) -> HTTP %d\n", n, code);
  return code == 200;
}

void smsFallback(const String& pkt) {
  // Format parsed by the server: "SOS BAND-1004 25.54,91.82 B70"
  String f[9]; int start = 0;
  for (int i = 0; i < 9; i++) { int bar = pkt.indexOf('|', start); f[i] = bar < 0 ? pkt.substring(start) : pkt.substring(start, bar); if (bar < 0) break; start = bar + 1; }
  if (f[3] != "SOS" && f[3] != "FALL") return;
  String text = f[3] + " " + f[2] + (f[4].length() ? " " + f[4] + "," + f[5] : "") + " B" + f[6];
  SIM.println("AT+CMGF=1"); delay(200);
  SIM.print("AT+CMGS=\""); SIM.print(SMS_NUMBER); SIM.println("\""); delay(200);
  SIM.print(text); SIM.write(26); delay(1000);
  Serial.println("SMS sent: " + text);
}

void setup() {
  Serial.begin(115200);
  SIM.begin(9600, SERIAL_8N1, SIM_RX, SIM_TX);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  LoRa.setPins(LORA_CS, LORA_RST, LORA_IRQ);
  if (!LoRa.begin(LORA_FREQ)) Serial.println("LoRa init failed");
  LoRa.setSpreadingFactor(10); LoRa.setSignalBandwidth(125E3); LoRa.enableCrc();
  LoRa.receive();
}

unsigned long lastRetry = 0;

void loop() {
  int size = LoRa.parsePacket();
  if (size) {
    String p; while (LoRa.available()) p += (char)LoRa.read();
    if (p.startsWith("SB1|")) {
      int a = p.indexOf('|') + 1, b = p.indexOf('|', a);
      if (!alreadySeen(p.substring(a, b))) {
        Serial.printf("RX (RSSI %d): %s\n", LoRa.packetRssi(), p.c_str());
        if (!upload(&p, 1)) {
          if (buffered < 32) buffer[buffered++] = p;
          smsFallback(p);
        }
      }
    }
  }
  if (buffered && millis() - lastRetry > 10000) {
    lastRetry = millis();
    if (upload(buffer, buffered)) buffered = 0;
  }
}
