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
#define AIO_USERNAME    "YOUR_ADAFRUIT_IO_USERNAME"
#define AIO_KEY         "YOUR_ADAFRUIT_IO_KEY"

// ------------------------------
// Feed definitions (change per node)
// ------------------------------
#define AIO_FEED_TEMP     "Node 1 Rhundei City Temp"
#define AIO_FEED_HUMIDITY "Node 1 Rhundei City Humidity"

// ------------------------------
// Node Identity (change per Arduino)
// ------------------------------
const char* NODE_ID  = "NODE 01";
const char* LOCATION = "Rhundei City";

// ------------------------------
// Pin definitions
// ------------------------------
#define DHTPIN  2
#define DHTTYPE DHT11

const int LDR_PIN = A0;

// ------------------------------
// Thresholds & timing
// ------------------------------
const int   LDR_DAY_THRESHOLD = 300;
const unsigned long SEND_INTERVAL = 30000;
unsigned long lastSendTime = 0;

DHT dht(DHTPIN, DHTTYPE);
WiFiClient wifiClient;
Adafruit_MQTT_Client mqtt(&wifiClient, AIO_SERVER, AIO_SERVERPORT, AIO_USERNAME, AIO_KEY);

// ------------------------------
// Publish feeds
// ------------------------------
Adafruit_MQTT_Publish tempFeed     = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/" AIO_FEED_TEMP);
Adafruit_MQTT_Publish humidityFeed = Adafruit_MQTT_Publish(&mqtt, AIO_USERNAME "/feeds/" AIO_FEED_HUMIDITY);

// Function prototypes
void connectWiFi();
void MQTT_connect();
void publishReadings(float temperature, float humidity);

void setup() {
  Serial.begin(9600);
  while (!Serial) { ; }

  dht.begin();

  Serial.print("Node ID : ");
  Serial.println(NODE_ID);
  Serial.print("Location: ");
  Serial.println(LOCATION);

  connectWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  MQTT_connect();
  mqtt.ping();

  unsigned long now = millis();

  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;

    // --- Edge Logic: Check light level FIRST ---
    int ldrValue = analogRead(LDR_PIN);
    Serial.print("[EDGE CHECK] LDR Value: ");
    Serial.print(ldrValue);

    if (ldrValue < LDR_DAY_THRESHOLD) {
      Serial.println(" -> NIGHTTIME detected. Skipping transmission.");
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
    publishReadings(temperature, humidity);
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
    Serial.println(mqtt.connectErrorString(ret));
    mqtt.disconnect();
    delay(5000);
  }
  Serial.println();
  Serial.println("MQTT connected!");
}

void publishReadings(float temperature, float humidity) {

  // --- Publish plain temperature ---
  if (tempFeed.publish(temperature)) {
    Serial.print("Temp published: ");
    Serial.println(temperature);
  } else {
    Serial.println("Temp publish FAILED.");
  }

  delay(500);

  // --- Publish plain humidity ---
  if (humidityFeed.publish(humidity)) {
    Serial.print("Humidity published: ");
    Serial.println(humidity);
  } else {
    Serial.println("Humidity publish FAILED.");
  }
}