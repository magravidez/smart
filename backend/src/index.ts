import "dotenv/config"
import express from "express"
import cors from "cors"
import readingsRouter from "./routes/readings"
import { startMqttSubscriber } from "./mqttSubscriber"

const app = express()
const PORT = process.env.PORT ?? 3000

const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)

const localhostPattern = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const lanPattern = /^http:\/\/192\.168\.\d+\.\d+(?::\d+)?$/

function isAllowedOrigin(origin: string): boolean {
  return (
    localhostPattern.test(origin) ||
    lanPattern.test(origin) ||
    allowedOrigins.includes(origin)
  )
}

// Allow requests from development frontends (localhost, 127.0.0.1, LAN) and optional custom origins.
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests (no Origin header), e.g. curl or server-to-server.
      if (!origin) {
        callback(null, true)
        return
      }

      if (isAllowedOrigin(origin)) {
        callback(null, true)
        return
      }

      callback(new Error(`CORS blocked for origin: ${origin}`))
    },
    methods: ["GET", "POST"],
  })
)

app.use(express.json())

// Health check endpoint
app.get("/", (_req, res) => {
  res.json({ status: "UP", project: "SMART: Sunlight-based Monitoring for Agriculture with Real-time Temperature and Humidity" })
})

// Resource routes
app.use("/api/readings", readingsRouter)

// 404 handler for unmatched routes
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found." })
})

startMqttSubscriber()

app.listen(PORT, () => {
  console.log(`SMART running on http://localhost:${PORT}`)
})
