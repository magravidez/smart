# SMART — Arduino Node Setup

## Hardware

| Component | Pin |
|-----------|-----|
| Arduino UNO R4 WiFi | — |
| DHT11 (data) | **D2** |
| LDR (analog out via 10kΩ pull-down) | **A0** |

## Wiring Diagram

```
Arduino UNO R4 WiFi
┌─────────────────────────┐
│  D2 ──── DHT11 DATA     │
│  5V ──── DHT11 VCC      │
│  GND ─── DHT11 GND      │
│                         │
│  A0 ──┬─ LDR ──── 5V   │
│       └─ 10kΩ ─── GND  │
└─────────────────────────┘
```

## Configuration (per node)

Open `smart_node.ino` and edit the top section:

```cpp
#define NODE_ID   "NODE_01"       // unique per Arduino
#define LOCATION  "North_Field"   // physical location

const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_HOST   = "192.168.x.x"; // backend machine IP
```

| Member | NODE_ID | LOCATION |
|--------|---------|----------|
| 1 | `NODE_01` | `North_Field` |
| 2 | `NODE_02` | `Tomato_Greenhouse` |
| 3 | `NODE_03` | `South_Field` |
| 4 | `NODE_04` | `Herb_Garden` |

## Edge Computing Logic

```
loop() every 5 seconds:
  1. Read LDR analog value (0–1023)
  2. If value > 500  →  DAYTIME
       a. Read DHT11 temperature & humidity
       b. POST JSON to http://<SERVER_HOST>:3000/api/readings
  3. If value ≤ 500  →  NIGHTTIME  →  skip (save bandwidth!)
```

## Required Libraries (Arduino IDE)

- `WiFiS3` (built-in for UNO R4 WiFi)
- `DHT sensor library` by Adafruit
- `Adafruit Unified Sensor`

Install via **Sketch → Include Library → Manage Libraries**.