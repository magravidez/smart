#include <WiFiS3.h>
#include "Adafruit_MQTT.h"
#include "Adafruit_MQTT_Client.h"
#include <DHT.h>

// ------------------------------
// WiFi and Adafruit IO configuration
// ------------------------------
const char* ssid     = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

#define AIO_SERVER      "io.adafruit.com"
#define AIO_SERVERPORT  1883
#define AIO_USERNAME    "YOUR_ADAFRUIT_USERNAME"
#define AIO_KEY         "YOUR_ADAFRUIT_AIO_KEY"
#define AIO_FEED_READING "smart_reading"
#define AIO_FEED_COMMAND "smart_cmd"

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
WiFiClient wifiClient;
Adafruit_MQTT_Client mqtt(&wifiClient, AIO_SERVER, AIO_SERVERPORT, AIO_USERNAME, AIO_KEY);
Adafruit_MQTT_Publish readingFeed = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/" AIO_FEED_READING);
Adafruit_MQTT_Subscribe commandFeed = Adafruit_MQTT_Subscribe(&mqtt, AIO_USERNAME "/feeds/" AIO_FEED_COMMAND);

bool manualAlertOverride = false;
bool manualAlertState = false;

// Function prototype
void connectWiFi();
void MQTT_connect();
void applyAlertOutputs(bool alertOn);
void processCommand(String command);
void publishReading(float temperature, float humidity);

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

  connectWiFi();
  mqtt.subscribe(&commandFeed);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  MQTT_connect();

  Adafruit_MQTT_Subscribe* subscription;
  while ((subscription = mqtt.readSubscription(100))) {
    if (subscription == &commandFeed) {
      String command = String((char*)commandFeed.lastread);
      command.trim();
      command.toUpperCase();
      processCommand(command);
    }
  }

  mqtt.ping();

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
      if (!manualAlertOverride) {
        applyAlertOutputs(false);
      }
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
    if (manualAlertOverride) {
      applyAlertOutputs(manualAlertState);
    } else {
      applyAlertOutputs(temperature > TEMP_THRESHOLD);
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

    // --- Publish to Adafruit IO ---
    publishReading(temperature, humidity);
  }
}

void connectWiFi() {
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

void MQTT_connect() {
  if (mqtt.connected()) {
    return;
  }

  Serial.print("Connecting to Adafruit IO MQTT");
  int8_t ret;
  while ((ret = mqtt.connect()) != 0) {
    Serial.print(".");
    Serial.print(mqtt.connectErrorString(ret));
    mqtt.disconnect();
    delay(5000);
  }
  Serial.println();
  Serial.println("MQTT connected!");
}

void applyAlertOutputs(bool alertOn) {
  if (alertOn) {
    digitalWrite(LED_PIN, HIGH);
    tone(BUZZER_PIN, 2000);
  } else {
    digitalWrite(LED_PIN, LOW);
    noTone(BUZZER_PIN);
  }
}

void processCommand(String command) {
  Serial.print("[COMMAND] ");
  Serial.println(command);

  if (command == "ALERT_ON") {
    manualAlertOverride = true;
    manualAlertState = true;
    applyAlertOutputs(true);
    return;
  }

  if (command == "ALERT_OFF") {
    manualAlertOverride = true;
    manualAlertState = false;
    applyAlertOutputs(false);
    return;
  }

  if (command == "ALERT_AUTO") {
    manualAlertOverride = false;
    applyAlertOutputs(false);
    return;
  }

  Serial.println("Unknown command. Use ALERT_ON, ALERT_OFF, or ALERT_AUTO.");
}

void publishReading(float temperature, float humidity) {
  String payload = "{";
  payload += "\"node_id\":\"" + String(NODE_ID) + "\",";
  payload += "\"location\":\"" + String(LOCATION) + "\",";
  payload += "\"temperature\":" + String(temperature, 1) + ",";
  payload += "\"humidity\":" + String(humidity, 1);
  payload += "}";

  if (readingFeed.publish(payload.c_str())) {
    Serial.println("MQTT publish sent:");
    Serial.println(payload);
  } else {
    Serial.println("MQTT publish failed.");
    mqtt.disconnect();
  }
}
