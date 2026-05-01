# SMART

**Sunlight-based Monitoring for Agriculture with Real-time Temperature and Humidity**

SMART is an Industrial IoT network for smart agriculture that uses edge computing to optimize data transmission. Multiple Arduino sensor nodes in a star topology monitor temperature, humidity, and sunlight levels. Each node only transmits crop data when sunlight is detected (daytime), reducing unnecessary cloud bandwidth and database storage.

The current implementation uses MQTT Pub/Sub with Adafruit IO:

- Arduino nodes publish sensor data to feed `smart_reading`.
- Backend subscribes to the feed, validates payloads, and stores to NeonDB via Prisma.
- Frontend fetches persisted data from `GET /api/readings`.
- IoT MQTT Panel can subscribe to the same feed for live phone monitoring.
- Custom Subscriber (frontend) can connect to Adafruit IO via MQTT over WebSockets.

---

## Technology Stack

| Category        | Technologies                                                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hardware        | Arduino UNO R4 WiFi, DHT sensor (temperature/humidity)                                                                                                                                                                                                                                                       |
| Messaging       | MQTT Pub/Sub, Adafruit IO                                                                                                                                                                                                                                                                                   |
| Frontend        | ![React](https://img.shields.io/badge/React-61dafb?style=flat&logo=react&logoColor=000000) ![Vite](https://img.shields.io/badge/Vite-646cff?style=flat&logo=vite&logoColor=ffffff) ![Recharts](https://img.shields.io/badge/Recharts-22b4a8?style=flat) ![MQTT.js](https://img.shields.io/badge/MQTT.js-5e7bff?style=flat) |
| Backend         | ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js) ![Express](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express) ![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat&logo=typescript) ![MQTT.js](https://img.shields.io/badge/MQTT.js-5e7bff?style=flat) |
| Database        | ![Neon](https://img.shields.io/badge/Neon-00e699?style=flat&logo=postgresql&logoColor=ffffff)                                                                                                                                                                                                                |
| ORM             | ![Prisma](https://img.shields.io/badge/Prisma-3b82f6?style=flat&logo=prisma)                                                                                                                                                                                                                                   |

---

## Project Structure

```
smart/
├── arduino/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── lib/prisma.ts
│   │   ├── routes/readings.ts
│   │   └── index.ts
│   └── package.json
└── frontend/
```

---

## Getting Started

### Prerequisites

- Node.js v18 or higher
- npm v9 or higher
- A NeonDB account
- Arduino IDE 2.x with the Arduino UNO R4 WiFi board package
- Adafruit DHT sensor library and Adafruit Unified Sensor

### Backend

Install dependencies and set up environment:

```bash
cd backend
npm install
```

Create a `.env` file from the example and add your NeonDB connection strings:

```bash
cp .env.example .env
# Edit .env with your NeonDB pooled and direct connection URLs
```

Generate the Prisma client and run migrations:

```bash
npx prisma generate
npx prisma migrate dev --name init
```

Start the backend server:

```bash
npm run dev
```

Create backend environment variables:

```bash
cp .env.example .env
# Edit .env and set AIO_USERNAME + AIO_KEY
```

The API will be available at `http://localhost:3000`.

---

## API Endpoints

| Method | Endpoint        | Description                      |
| ------ | --------------- | -------------------------------- |
| GET    | `/`             | Health check                     |
| POST   | `/api/readings` | Store a new sensor reading       |
| GET    | `/api/readings` | Retrieve readings (latest first) |

### POST `/api/readings`

**Request body (JSON):**

```json
{
  "node_id": "NODE_01",
  "location": "North_Field",
  "temperature": 28.5,
  "humidity": 65.0,
  "timestamp": "2026-03-28T10:30:00Z"
}
```

**Response (201):**

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

### GET `/api/readings`

**Query parameters:**

| Parameter | Type | Default | Description            |
| --------- | ---- | ------- | ---------------------- |
| `limit`   | int  | 50      | Max number of readings |

**Example:** `GET /api/readings?limit=20`

---

## Custom Subscriber (Frontend)

The frontend includes a **Custom Subscriber** page that connects to Adafruit IO using MQTT over WebSockets. Configure your Adafruit IO username, key, and feed key in the UI, then connect to see live messages.

### GitHub Pages

The frontend is set up for GitHub Pages using `base: "/smart/"` in `frontend/vite.config.js`. If your repo name differs, set `VITE_BASE` during build.