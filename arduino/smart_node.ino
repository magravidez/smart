// ============================================================
//  SMART — Sunlight-based Monitoring for Agriculture with
//           Real-time Temperature and Humidity
//
//  Star Topology | Edge Computing | IIoT Node
// ============================================================
//
//  HARDWARE:
//    - Arduino UNO R4 WiFi
//    - DHT11 sensor  → data pin D2
//    - LDR (photoresistor) with 10kΩ pull-down → A0
//
//  HOW IT WORKS (Edge Computing):
//    1. Read the LDR analog value every 5 seconds.
//    2. If LDR > DAYTIME_THRESHOLD → it is daytime.
//       → Read DHT11 temperature & humidity.
//       → POST JSON payload to the backend API.
//    3. If LDR <= DAYTIME_THRESHOLD → it is night.
//       → Skip transmission entirely (saves bandwidth!).
//
//  NODE CONFIGURATION — change per Arduino:
//    NODE_ID   : unique identifier for this sensor node
//    LOCATION  : physical deployment location of this node
// ============================================================

#include <WiFiS3.h>
#include <DHT.h>

// ─── NODE IDENTITY (edit these per Arduino) ──────────────────
#define NODE_ID   "NODE_01"
#define LOCATION  "North_Field"
// Other examples:
//   NODE_02 / Tomato_Greenhouse
//   NODE_03 / South_Field
//   NODE_04 / Herb_Garden

// ─── WIFI CREDENTIALS ────────────────────────────────────────
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// ─── BACKEND SERVER ──────────────────────────────────────────
// Replace with the IP address of the machine running the backend.
// On the same LAN as the Arduino, get this via `ipconfig` (Windows).
const char* SERVER_HOST = "192.168.1.100";
const int   SERVER_PORT = 3000;
const char* API_PATH    = "/api/readings";

// ─── SENSOR PINS ─────────────────────────────────────────────
#define DHT_PIN      2        // DHT11 data pin
#define DHT_TYPE     DHT11
#define LDR_PIN      A0       // LDR analog pin

// ─── EDGE COMPUTING THRESHOLD ────────────────────────────────
// Analog range: 0 (dark) – 1023 (bright).
// Readings above this value are treated as DAYTIME.
// Adjust based on your LDR circuit and lighting conditions.
#define DAYTIME_THRESHOLD  500

// ─── POLL INTERVAL ───────────────────────────────────────────
#define POLL_INTERVAL_MS  5000   // 5 seconds

// ─── GLOBALS ─────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient client;

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  while (!Serial);   // wait for Serial Monitor

  Serial.println("==============================================");
  Serial.println("  SMART — Edge Node Starting Up");
  Serial.print  ("  Node ID  : "); Serial.println(NODE_ID);
  Serial.print  ("  Location : "); Serial.println(LOCATION);
  Serial.println("==============================================");

  dht.begin();

  connectWiFi();
}

// ─────────────────────────────────────────────────────────────
void loop() {
  // Maintain WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Disconnected. Reconnecting…");
    connectWiFi();
  }

  // ── EDGE COMPUTING: Read light level first ────────────────
  int ldrValue  = analogRead(LDR_PIN);
  bool isDaytime = ldrValue > DAYTIME_THRESHOLD;

  Serial.print("[LDR] Value: ");
  Serial.print(ldrValue);
  Serial.print("  →  ");
  Serial.println(isDaytime ? "DAYTIME — transmitting" : "NIGHTTIME — skipping");

  if (isDaytime) {
    // ── Read DHT11 ───────────────────────────────────────────
    float temperature = dht.readTemperature();
    float humidity    = dht.readHumidity();

    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("[DHT11] Read failed. Skipping this cycle.");
    } else {
      Serial.print("[DHT11] Temp: ");
      Serial.print(temperature);
      Serial.print(" °C  |  Humidity: ");
      Serial.print(humidity);
      Serial.println(" %");

      // ── Build ISO 8601 timestamp ─────────────────────────
      String timestamp = getTimestamp();

      // ── Build JSON payload ───────────────────────────────
      String json = "{";
      json += "\"node_id\":\""   + String(NODE_ID)     + "\",";
      json += "\"location\":\""  + String(LOCATION)    + "\",";
      json += "\"temperature\":" + String(temperature, 2) + ",";
      json += "\"humidity\":"    + String(humidity,    2) + ",";
      json += "\"timestamp\":\"" + timestamp           + "\"";
      json += "}";

      sendReading(json);
    }
  }

  delay(POLL_INTERVAL_MS);
}

// ─── WiFi helper ─────────────────────────────────────────────
void connectWiFi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Connected! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WiFi] Connection FAILED. Will retry next loop.");
  }
}

// ─── HTTP POST helper ─────────────────────────────────────────
void sendReading(const String& jsonPayload) {
  Serial.print("[HTTP] Connecting to ");
  Serial.print(SERVER_HOST);
  Serial.print(":");
  Serial.println(SERVER_PORT);

  if (!client.connect(SERVER_HOST, SERVER_PORT)) {
    Serial.println("[HTTP] Connection to server FAILED.");
    return;
  }

  // Build the HTTP request
  client.print("POST ");
  client.print(API_PATH);
  client.println(" HTTP/1.1");
  client.print("Host: ");
  client.print(SERVER_HOST);
  client.print(":");
  client.println(SERVER_PORT);
  client.println("Content-Type: application/json");
  client.print("Content-Length: ");
  client.println(jsonPayload.length());
  client.println("Connection: close");
  client.println();  // blank line = end of headers
  client.println(jsonPayload);

  // Wait for response
  unsigned long timeout = millis();
  while (client.available() == 0) {
    if (millis() - timeout > 5000) {
      Serial.println("[HTTP] Response timeout.");
      client.stop();
      return;
    }
  }

  // Read status line
  String statusLine = client.readStringUntil('\n');
  Serial.print("[HTTP] Response: ");
  Serial.println(statusLine);

  // Drain remaining response
  while (client.available()) client.read();

  client.stop();
  Serial.println("[HTTP] POST complete.");
}

// ─── Timestamp helper ─────────────────────────────────────────
// Uses millis() as a rough offset from an epoch start.
// For real deployments, use NTP (WiFi.getTime()) or an RTC module.
String getTimestamp() {
  // Attempt NTP-based time if available
  unsigned long epoch = WiFi.getTime();
  if (epoch == 0) {
    // Fallback: use uptime as offset from a fixed date
    // This gives a monotonically increasing fake timestamp.
    epoch = 1743120000UL + (millis() / 1000UL);  // base = 2025-03-28 00:00:00 UTC
  }

  // Convert epoch to ISO 8601 string
  unsigned long s  = epoch % 60;
  unsigned long m  = (epoch / 60)   % 60;
  unsigned long h  = (epoch / 3600) % 24;

  // Days since epoch for date calculation
  unsigned long days = epoch / 86400UL;
  int year  = 1970;
  while (true) {
    bool leap = (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
    unsigned long diy = leap ? 366 : 365;
    if (days < diy) break;
    days -= diy;
    year++;
  }
  int months[] = {31,28,31,30,31,30,31,31,30,31,30,31};
  bool leap = (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
  if (leap) months[1] = 29;
  int month = 1;
  for (int i = 0; i < 12; i++) {
    if ((int)days < months[i]) { month = i + 1; break; }
    days -= months[i];
  }
  int day = (int)days + 1;

  char buf[25];
  snprintf(buf, sizeof(buf),
    "%04d-%02d-%02dT%02lu:%02lu:%02luZ",
    year, month, day, h, m, s);
  return String(buf);
}
