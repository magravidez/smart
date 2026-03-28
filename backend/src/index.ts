import "dotenv/config"
import express from "express"
import cors from "cors"
import readingsRouter from "./routes/readings"

const app = express()
const PORT = process.env.PORT ?? 3000

// Allow requests from the Vue frontend and Arduino nodes during development
app.use(
  cors({
    origin: ["http://localhost:5173", "http://localhost:4173"],
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

app.listen(PORT, () => {
  console.log(`SMART running on http://localhost:${PORT}`)
})
