# SMART

**Sunlight-based Monitoring for Agriculture with Real-time Temperature and Humidity**

SMART is an Industrial IoT network for smart agriculture that uses edge computing to optimize data transmission. Multiple Arduino sensor nodes in a star topology monitor temperature, humidity, and sunlight levels. Each node only transmits crop data to the central farm server when sunlight is detected (daytime), reducing unnecessary cloud bandwidth and database storage.

---

## Technology Stack

| Category        | Technologies                                                                                                                                                                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node            | ![Arduino UNO R4 WiFi](https://img.shields.io/badge/Arduino_UNO_R4_WiFi-00979D?style=flat&logo=arduino) DHT11 + LDR (Photoresistor) |
| Frontend        | ![React](https://img.shields.io/badge/React-61DAFB?style=flat&logo=react) ![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat&logo=vite) |
| UI              | SmartDashboard.jsx — warm-beige earthy theme, 5-second polling, live node cards |
| Backend         | ![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js) ![Express](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express) ![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat&logo=typescript) |
| Database        | ![NeonDB](https://img.shields.io/badge/NeonDB-database-blue)                                                                                                                                                                                                |
| ORM             | ![Prisma](https://img.shields.io/badge/Prisma-3b82f6?style=flat&logo=prisma)                                                                                                                                                                                |

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