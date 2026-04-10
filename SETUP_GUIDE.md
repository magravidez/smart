# SMART — Frontend, Arduino, and MQTT Setup Guide

This guide is for team members working on the **frontend**, **Arduino**, and **MQTT** parts of the SMART project.

---

## Current Data Flow (MQTT Migration)

1. Arduino node publishes sensor payloads to Adafruit IO feed `smart_reading`.
2. Backend subscribes to Adafruit IO MQTT topic and stores each payload in the database.
3. Frontend keeps reading from `GET /api/readings`.
4. IoT MQTT Panel subscribes to the same feed for live phone monitoring.
5. Optional commands are sent from phone to feed `smart_cmd` (e.g., `ALERT_ON`).

---

## Backend API Reference

The backend runs at `http://localhost:3000` during development.

### Endpoints

#### `GET /` — Health Check

```
Response: { "status": "UP", "project": "SMART: Sunlight-based Monitoring for Agriculture with Real-time Temperature and Humidity" }
```

#### `POST /api/readings` — Store a New Reading (Optional Fallback)

This endpoint is still available for manual testing (for example via curl/Postman). In the new architecture, Arduino sends data through MQTT instead.

**Request:**

- Method: `POST`
- URL: `http://localhost:3000/api/readings`
- Content-Type: `application/json`

**Body:**

```json
{
  "node_id": "Node_01",
  "location": "North_Field",
  "temperature": 28.5,
  "humidity": 65.0,
  "timestamp": "2026-03-28T10:30:00Z"
}
```

| Field         | Type   | Description                                         |
| ------------- | ------ | --------------------------------------------------- |
| `node_id`     | string | Unique ID for this Arduino node (e.g., `"NODE_01"`) |
| `location`    | string | Physical location (e.g., `"Tomato_Greenhouse"`)     |
| `temperature` | number | Temperature in °C from DHT11                        |
| `humidity`    | number | Relative humidity in % from DHT11                   |
| `timestamp`   | string | ISO 8601 timestamp (e.g., `"2026-03-28T10:30:00Z"`) |

**Response (201 Created):**

```json
{
  "id": 1,
  "node_id": "NODE_01",
  "location": "North_Field",
  "temperature": 28.5,
  "humidity": 65.0,
  "timestamp": "2026-03-28T10:30:00.000Z"
}
```

#### `GET /api/readings` — Retrieve Readings

Fetch stored readings, ordered by most recent first.

**Query Parameters:**

| Parameter | Type | Default | Description                |
| --------- | ---- | ------- | -------------------------- |
| `limit`   | int  | 50      | Maximum number of readings |

**Example:** `GET http://localhost:3000/api/readings?limit=20`

**Response (200 OK):**

```json
[
  {
    "id": 2,
    "node_id": "NODE_02",
    "location": "Tomato_Greenhouse",
    "temperature": 30.1,
    "humidity": 70.2,
    "timestamp": "2026-03-28T10:35:00.000Z"
  },
  {
    "id": 1,
    "node_id": "NODE_01",
    "location": "North_Field",
    "temperature": 28.5,
    "humidity": 65.0,
    "timestamp": "2026-03-28T10:30:00.000Z"
  }
]
```

---

## Arduino Setup

### Hardware Requirements

- Arduino UNO R4 WiFi
- DHT11 temperature & humidity sensor (data pin on **pin 2**)
- LDR (photoresistor) with a voltage divider circuit (analog pin, e.g., **A0**)

### Edge Computing Logic

The Arduino should implement this flow:

```
loop():
  1. Read LDR value from analog pin
    2. If LDR value indicates DAYTIME (above threshold):
       a. Read temperature and humidity from DHT11
      b. Build a JSON payload with node_id, location, temperature, humidity
      c. Publish to Adafruit IO topic username/feeds/smart_reading
  3. If NIGHTTIME: do nothing (skip transmission)
  4. Wait 5 seconds
```

### Node Configuration

Each team member programs their Arduino with a **unique** node_id and location:

| Team Member | node_id   | location            |
| ----------- | --------- | ------------------- |
| Member 1    | `NODE_01` | `North_Field`       |
| Member 2    | `NODE_02` | `Tomato_Greenhouse` |
| Member 3    | `NODE_03` | `South_Field`       |
| Member 4    | `NODE_04` | `Herb_Garden`       |

### Example MQTT Payload from Arduino

The Arduino publishes a JSON payload like this to Adafruit IO feed `smart_reading`:

```cpp
// Example JSON payload
String payload = "{";
payload += "\"node_id\":\"NODE_01\",";
payload += "\"location\":\"North_Field\",";
payload += "\"temperature\":" + String(temperature, 1) + ",";
payload += "\"humidity\":" + String(humidity, 1);
payload += "}";
```

### Adafruit IO Setup

1. Create an Adafruit IO account.
2. Copy your username and AIO key.
3. Create these feeds:
  - `smart_reading`
  - `smart_cmd`
4. In Arduino sketch, set:
  - `AIO_USERNAME`
  - `AIO_KEY`
5. In backend `.env`, set:
  - `AIO_USERNAME`
  - `AIO_KEY`
  - `AIO_FEED_READING=smart_reading`

### IoT MQTT Panel Setup (Subscriber)

1. Add broker connection:
  - Host: `io.adafruit.com`
  - Port: `1883`
  - Username: your Adafruit username
  - Password: your AIO key
2. Add a subscribe widget on topic:
  - `your_username/feeds/smart_reading`
3. Optional command button widget:
  - Publish topic: `your_username/feeds/smart_cmd`
  - Payload: `ALERT_ON`, `ALERT_OFF`, or `ALERT_AUTO`

### LDR Threshold

Use a threshold value to determine day vs. night. For example:

```cpp
int ldrValue = analogRead(A0);
bool isDaytime = ldrValue > 500; // Adjust threshold based on your LDR circuit
```

---

## Frontend Setup

### Connecting to the Backend

The frontend should poll the `GET /api/readings` endpoint to display live data.

**API base URL (development):** `http://localhost:3000`

### Example API Service (TypeScript)

```typescript
const API_BASE = "http://localhost:3000"

export interface Reading {
  id: number
  node_id: string
  location: string
  temperature: number
  humidity: number
  timestamp: string
}

export async function fetchReadings(limit = 50): Promise<Reading[]> {
  const res = await fetch(`${API_BASE}/api/readings?limit=${limit}`)
  if (!res.ok) throw new Error("Failed to fetch readings")
  return res.json()
}
```

### Polling

To keep the dashboard updated in real time, poll every 5 seconds:

```typescript
setInterval(async () => {
  const readings = await fetchReadings()
  // Update your Vue reactive state with the new readings
}, 5000)
```

### Key Data Points to Display

- **Node ID** and **Location** for each reading
- **Temperature** (°C) and **Humidity** (%)
- **Timestamp** of each reading
- Consider grouping or filtering readings by node/location

---

## Testing the Backend

You can test the API using `curl` before the Arduino or frontend is ready:

```bash
# Health check
curl http://localhost:3000

# Post a test reading
curl -X POST http://localhost:3000/api/readings \
  -H "Content-Type: application/json" \
  -d '{"node_id":"Node_01","location":"North_Field","temperature":28.5,"humidity":65.0,"timestamp":"2026-03-28T10:30:00Z"}'

# Get readings
curl http://localhost:3000/api/readings?limit=10
```
