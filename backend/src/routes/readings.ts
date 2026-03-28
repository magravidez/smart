import { Router, Request, Response } from "express"
import { prisma } from "../lib/prisma"

const router = Router()

// POST /api/readings
// Receives a new reading from an Arduino sensor node and stores it.
// Expected JSON body: { node_id, location, temperature, humidity, timestamp }
router.post("/", async (req: Request, res: Response) => {
  const { node_id, location, temperature, humidity, timestamp } = req.body

  if (
    node_id === undefined ||
    location === undefined ||
    temperature === undefined ||
    humidity === undefined ||
    timestamp === undefined
  ) {
    res.status(400).json({
      error:
        "All fields are required: node_id, location, temperature, humidity, timestamp.",
    })
    return
  }

  const temp = parseFloat(temperature)
  const hum = parseFloat(humidity)

  if (isNaN(temp) || isNaN(hum)) {
    res.status(400).json({
      error: "Temperature and humidity must be valid numbers.",
    })
    return
  }

  const parsedTimestamp = new Date(timestamp)
  if (isNaN(parsedTimestamp.getTime())) {
    res.status(400).json({
      error: "Timestamp must be a valid ISO 8601 date string.",
    })
    return
  }

  try {
    const reading = await prisma.sMART.create({
      data: {
        node_id: String(node_id),
        location: String(location),
        temperature: temp,
        humidity: hum,
        timestamp: parsedTimestamp,
      },
    })

    res.status(201).json(reading)
  } catch (error) {
    console.error("Failed to create reading:", error)
    res.status(500).json({ error: "Internal server error." })
  }
})

// GET /api/readings
// Retrieves stored readings ordered by latest first.
// Optional query parameter: ?limit=N (defaults to 50)
router.get("/", async (req: Request, res: Response) => {
  const limitParam = req.query.limit
  const limit = limitParam ? parseInt(limitParam as string, 10) : 50

  if (isNaN(limit) || limit < 1) {
    res.status(400).json({ error: "Limit must be a positive integer." })
    return
  }

  try {
    const readings = await prisma.sMART.findMany({
      orderBy: { timestamp: "desc" },
      take: limit,
    })

    res.status(200).json(readings)
  } catch (error) {
    console.error("Failed to fetch readings:", error)
    res.status(500).json({ error: "Internal server error." })
  }
})

export default router
