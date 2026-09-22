/*
  Suraksha Band firmware (ESP32 + LoRa SX1276 + GPS + button + MPU6050)
  Board: Heltec WiFi LoRa 32 / TTGO LoRa32 (ESP32), 865-867 MHz (India ISM band)

  Libraries (Arduino Library Manager):
    - LoRa by Sandeep Mistry
    - TinyGPSPlus by Mikal Hart
    - NimBLE-Arduino by h2zero
    - Adafruit MPU6050 (+ Adafruit Unified Sensor)

  What it does:
    - Long-press the SOS button (3 s) to broadcast SOS over the LoRa mesh and notify the phone over BLE
    - Double-press to send CANCEL (false alarm)
    - Relays other bands' packets (managed flooding with TTL and a seen-cache for duplicate suppression)
    - Fall detection: impact over 3g followed by stillness raises FALL
    - Heartbeat with GPS position every 5 min

  Packet format (text, fits in one LoRa frame):
    SB1|msgId|bandId|TYPE|lat|lon|battery|ttl|hop1>hop2>...
  NOTE: This is a prototype sketch that has not been compiled against real hardware. Check your board's pins.
*/
#include <SPI.h>
#include <LoRa.h>
#include <TinyGPSPlus.h>
#include <NimBLEDevice.h>
#include <Wire.h>
#include <Adafruit_MPU6050.h>

// ---------- config ----------
#define BAND_ID        "BAND-1004"
#define LORA_FREQ      866E6
#define LORA_SCK 5
#define LORA_MISO 19
#define LORA_MOSI 27
#define LORA_CS 18
#define LORA_RST 14
#define LORA_IRQ 26
#define GPS_RX 34
#define GPS_TX 12
#define BTN_PIN 0
#define BUZZER_PIN 25
#define VIB_PIN 13
#define BATT_PIN 35
#define DEFAULT_TTL 8
#define HEARTBEAT_MS (5UL * 60UL * 1000UL)

#define NUS_SERVICE "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_TX      "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

TinyGPSPlus gps;
HardwareSerial GPSSerial(1);
Adafruit_MPU6050 mpu;
bool mpuOk = false;
NimBLECharacteristic* bleTx = nullptr;
bool bleConnected = false;

// ---------- duplicate suppression ----------
#define SEEN_SIZE 64
String seen[SEEN_SIZE];
uint8_t seenIdx = 0;
bool alreadySeen(const String& id) {
  for (auto& s : seen) if (s == id) return true;
  seen[seenIdx] = id; seenIdx = (seenIdx + 1) % SEEN_SIZE;
  return false;
}

class ServerCB : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*) { bleConnected = true; }
  void onDisconnect(NimBLEServer*) { bleConnected = false; NimBLEDevice::startAdvertising(); }
};

int batteryPercent() {
  float v = analogRead(BATT_PIN) / 4095.0 * 3.3 * 2;  // 1:2 divider
  return constrain((int)((v - 3.3) / (4.2 - 3.3) * 100), 0, 100);
}

void bleSend(const String& s) {
  if (bleConnected && bleTx) { bleTx->setValue(s.c_str()); bleTx->notify(); }
}

void beep(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH); digitalWrite(VIB_PIN, HIGH); delay(120);
    digitalWrite(BUZZER_PIN, LOW);  digitalWrite(VIB_PIN, LOW);  delay(120);
  }
}

void loraSend(const String& pkt) {
  delay(random(20, 200));  // jitter so relays do not collide
  LoRa.beginPacket(); LoRa.print(pkt); LoRa.endPacket();
  LoRa.receive();
}

void originate(const char* type) {
  String msgId = String(BAND_ID).substring(5) + "-" + String(millis(), HEX);
  alreadySeen(msgId);
  String lat = gps.location.isValid() ? String(gps.location.lat(), 6) : "";
  String lon = gps.location.isValid() ? String(gps.location.lng(), 6) : "";
  String pkt = "SB1|" + msgId + "|" + BAND_ID + "|" + type + "|" + lat + "|" + lon + "|" +
               batteryPercent() + "|" + DEFAULT_TTL + "|" + BAND_ID;
  loraSend(pkt);
  bleSend(type);  // the phone also sends it over the internet if it has signal
  Serial.println("TX " + pkt);
}

// Relay: decrement TTL, append our ID to the hop list, rebroadcast
void onLoraPacket(String pkt) {
  if (!pkt.startsWith("SB1|")) return;
  String f[9]; int start = 0;
  for (int i = 0; i < 9; i++) {
    int bar = pkt.indexOf('|', start);
    f[i] = bar < 0 ? pkt.substring(start) : pkt.substring(start, bar);
    start = bar + 1;
    if (bar < 0) break;
  }
  if (alreadySeen(f[1])) return;
  int ttl = f[7].toInt() - 1;
  if (ttl <= 0) return;
  String relayed = "SB1|" + f[1] + "|" + f[2] + "|" + f[3] + "|" + f[4] + "|" + f[5] + "|" + f[6] + "|" + ttl + "|" + f[8] + ">" + BAND_ID;
  Serial.println("RELAY " + relayed);
  loraSend(relayed);
}

// Fall: impact spike, then about 2 s of stillness
unsigned long impactAt = 0;
void checkFall() {
  if (!mpuOk) return;
  sensors_event_t a, g, t; mpu.getEvent(&a, &g, &t);
  float mag = sqrt(a.acceleration.x * a.acceleration.x + a.acceleration.y * a.acceleration.y + a.acceleration.z * a.acceleration.z);
  if (mag > 29.4) impactAt = millis();  // above 3g
  if (impactAt && millis() - impactAt > 2000) {
    if (fabs(mag - 9.8) < 1.5) { beep(5); originate("FALL"); }
    impactAt = 0;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BTN_PIN, INPUT_PULLUP); pinMode(BUZZER_PIN, OUTPUT); pinMode(VIB_PIN, OUTPUT);
  GPSSerial.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  LoRa.setPins(LORA_CS, LORA_RST, LORA_IRQ);
  if (!LoRa.begin(LORA_FREQ)) { Serial.println("LoRa init failed"); }
  LoRa.setSpreadingFactor(10);   // long range; lower SF means faster but shorter range
  LoRa.setSignalBandwidth(125E3);
  LoRa.enableCrc();
  LoRa.receive();

  Wire.begin();
  mpuOk = mpu.begin();

  String name = String("SURAKSHA-") + String(BAND_ID).substring(5);
  NimBLEDevice::init(name.c_str());
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  NimBLEService* svc = server->createService(NUS_SERVICE);
  bleTx = svc->createCharacteristic(NUS_TX, NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  NimBLEDevice::getAdvertising()->addServiceUUID(NUS_SERVICE);
  NimBLEDevice::startAdvertising();
  beep(1);
}

unsigned long pressedAt = 0, lastRelease = 0, lastHb = 0, lastBat = 0;
bool sosFired = false;

void loop() {
  while (GPSSerial.available()) gps.encode(GPSSerial.read());

  int size = LoRa.parsePacket();
  if (size) { String p; while (LoRa.available()) p += (char)LoRa.read(); onLoraPacket(p); }

  bool down = digitalRead(BTN_PIN) == LOW;
  if (down && !pressedAt) { pressedAt = millis(); sosFired = false; }
  if (down && !sosFired && millis() - pressedAt > 3000) { sosFired = true; beep(3); originate("SOS"); }
  if (!down && pressedAt) {
    if (!sosFired && millis() - pressedAt < 400) {
      if (millis() - lastRelease < 500) { originate("CANCEL"); beep(2); }
      lastRelease = millis();
    }
    pressedAt = 0;
  }

  checkFall();
  if (millis() - lastHb > HEARTBEAT_MS) { lastHb = millis(); originate("HEARTBEAT"); }
  if (millis() - lastBat > 60000) { lastBat = millis(); bleSend("BAT:" + String(batteryPercent())); }
}
