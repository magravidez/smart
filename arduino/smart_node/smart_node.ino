#include <WiFiS3.h>
#include <DHT.h>

// ------------------------------
// WiFi and server configuration
// ------------------------------
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* serverIp = "YOUR_SERVER_IP_ADDRESS";
const int   serverPort = 3000;
const char* endpoint   = "/api/readings";

// ------------------------------
// Node Identity (change per Arduino)
// ------------------------------
const char* NODE_ID  = "NODE_01";
const char* LOCATION = "North_Field"; // e.g. "Tomato_Greenhouse", "South_Field"

// ------------------------------
// Pin definitions
// ------------------------------
#define DHTPIN  2
#define DHTTYPE DHT11

const int LDR_PIN    = A0;
const int LED_PIN    = 7;
const int BUZZER_PIN = 8;

// ------------------------------
// Thresholds & timing
// ------------------------------
const float TEMP_THRESHOLD    = 28.0;
const int   LDR_DAY_THRESHOLD = 300; // Tune based on your environment
const unsigned long SEND_INTERVAL = 5000;
unsigned long lastSendTime = 0;

DHT dht(DHTPIN, DHTTYPE);

// Function prototype
void sendReading(float temperature, float humidity);

void setup() {
  Serial.begin(9600);
  while (!Serial) { ; }

  dht.begin();

  pinMode(LED_PIN,    OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(LED_PIN, LOW);
  noTone(BUZZER_PIN);

  Serial.print("Node ID : ");
  Serial.println(NODE_ID);
  Serial.print("Location: ");
  Serial.println(LOCATION);

  Serial.print("Connecting to WiFi");
  while (WiFi.begin(ssid, password) != WL_CONNECTED) {
    Serial.print(".");
    delay(1000);
  }

  Serial.println();
  Serial.println("WiFi connected!");
  Serial.print("Board IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  unsigned long now = millis();

  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;

    // --- Edge Logic: Check light level FIRST ---
    int ldrValue = analogRead(LDR_PIN);
    Serial.print("[EDGE CHECK] LDR Value: ");
    Serial.print(ldrValue);

    if (ldrValue < LDR_DAY_THRESHOLD) {
      // Nighttime - skip transmission
      Serial.println(" -> NIGHTTIME detected. Skipping transmission.");
      digitalWrite(LED_PIN, LOW);
      noTone(BUZZER_PIN);
      return;
    }

    Serial.println(" -> DAYTIME detected. Reading sensors...");

    // --- Read DHT11 only if daytime ---
    float humidity    = dht.readHumidity();
    float temperature = dht.readTemperature();

    if (isnan(humidity) || isnan(temperature)) {
      Serial.println("Failed to read from DHT11 sensor.");
      return;
    }

    // --- Local alert logic (LED + Buzzer) ---
    if (temperature > TEMP_THRESHOLD) {
      digitalWrite(LED_PIN, HIGH);
      tone(BUZZER_PIN, 2000);
    } else {
      digitalWrite(LED_PIN, LOW);
      noTone(BUZZER_PIN);
    }

    // --- Serial log ---
    Serial.print("[");
    Serial.print(NODE_ID);
    Serial.print(" | ");
    Serial.print(LOCATION);
    Serial.print("] Temp: ");
    Serial.print(temperature, 1);
    Serial.print(" C | Humidity: ");
    Serial.print(humidity, 1);
    Serial.print(" % | LDR: ");
    Serial.println(ldrValue);

    // --- Transmit to server ---
    sendReading(temperature, humidity);
  }
}

void sendReading(float temperature, float humidity) {
  WiFiClient client;

  if (client.connect(serverIp, serverPort)) {

    // JSON matches exactly: node_id, location, temperature, humidity, timestamp
    String jsonBody = "{";
    jsonBody += "\"node_id\":\""    + String(NODE_ID)           + "\",";
    jsonBody += "\"location\":\""   + String(LOCATION)          + "\",";
    jsonBody += "\"temperature\":"  + String(temperature, 1)    + ",";
    jsonBody += "\"humidity\":"     + String(humidity, 1);
    jsonBody += "}";

    // HTTP POST
    client.print("POST ");
    client.print(endpoint);
    client.println(" HTTP/1.1");
    client.print("Host: ");
    client.print(serverIp);
    client.print(":");
    client.println(serverPort);
    client.println("Content-Type: application/json");
    client.print("Content-Length: ");
    client.println(jsonBody.length());
    client.println("Connection: close");
    client.println();
    client.println(jsonBody);

    Serial.println("POST sent:");
    Serial.println(jsonBody);

  } else {
    Serial.println("Connection to server failed.");
  }

  client.stop();
}
