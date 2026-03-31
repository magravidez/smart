import { Router, Request, Response } from "express"
import { prisma } from "../lib/prisma"

const router = Router()

type BucketPoint = {
  bucketStart: string
  temperatureAvg: number
  humidityAvg: number
  samples: number
}

function parseRange(query: Request["query"]) {
  const now = new Date()
  const daysParam = query.days as string | undefined
  const startParam = query.start as string | undefined
  const endParam = query.end as string | undefined

  let end = endParam ? new Date(endParam) : now
  if (isNaN(end.getTime())) {
    return { error: "End must be a valid ISO 8601 date string." }
  }

  let start: Date
  let days: number

  if (startParam) {
    start = new Date(startParam)
    if (isNaN(start.getTime())) {
      return { error: "Start must be a valid ISO 8601 date string." }
    }
    days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)))
  } else {
    days = daysParam ? parseInt(daysParam, 10) : 7
    if (isNaN(days) || days < 1 || days > 90) {
      return { error: "Days must be an integer between 1 and 90." }
    }
    start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  }

  if (start >= end) {
    return { error: "Start must be earlier than end." }
  }

  return { start, end, days }
}

function buildBuckets(readings: Array<{ timestamp: Date; temperature: number; humidity: number }>, bucketMs: number): BucketPoint[] {
  const map = new Map<number, { tempSum: number; humSum: number; samples: number }>()

  readings.forEach((reading) => {
    const ts = new Date(reading.timestamp).getTime()
    const key = Math.floor(ts / bucketMs) * bucketMs
    const prev = map.get(key) || { tempSum: 0, humSum: 0, samples: 0 }
    prev.tempSum += Number(reading.temperature)
    prev.humSum += Number(reading.humidity)
    prev.samples += 1
    map.set(key, prev)
  })

  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([bucketStart, val]) => ({
      bucketStart: new Date(bucketStart).toISOString(),
      temperatureAvg: Number((val.tempSum / val.samples).toFixed(2)),
      humidityAvg: Number((val.humSum / val.samples).toFixed(2)),
      samples: val.samples,
    }))
}

// POST /api/readings
// Receives a new reading from an Arduino sensor node and stores it.
// Expected JSON body: { node_id, location, temperature, humidity, timestamp? }
router.post("/", async (req: Request, res: Response) => {
  const { node_id, location, temperature, humidity, timestamp } = req.body

  if (
    node_id === undefined ||
    location === undefined ||
    temperature === undefined ||
    humidity === undefined
  ) {
    res.status(400).json({
      error:
        "All fields are required: node_id, location, temperature, humidity.",
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

  // Arduino nodes may not have a real-time clock; use server time if timestamp is absent.
  let parsedTimestamp = new Date()
  if (timestamp !== undefined) {
    parsedTimestamp = new Date(timestamp)
    if (isNaN(parsedTimestamp.getTime())) {
      res.status(400).json({
        error: "Timestamp must be a valid ISO 8601 date string.",
      })
      return
    }
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
  const hasRangeQuery = req.query.days !== undefined || req.query.start !== undefined || req.query.end !== undefined
  const range = hasRangeQuery ? parseRange(req.query) : null
  if (range && "error" in range) {
    res.status(400).json({ error: range.error })
    return
  }

  const nodeId = req.query.node_id ? String(req.query.node_id) : undefined
  const limit = limitParam ? parseInt(limitParam as string, 10) : 50

  if (isNaN(limit) || limit < 1) {
    res.status(400).json({ error: "Limit must be a positive integer." })
    return
  }

  try {
    const readings = await prisma.sMART.findMany({
      where: {
        ...(nodeId ? { node_id: nodeId } : {}),
        ...(range
          ? {
              timestamp: {
                gte: range.start,
                lte: range.end,
              },
            }
          : {}),
      },
      orderBy: { timestamp: "desc" },
      take: limit,
    })

    res.status(200).json(readings)
  } catch (error) {
    console.error("Failed to fetch readings:", error)
    res.status(500).json({ error: "Internal server error." })
  }
})

// GET /api/readings/analytics
// Returns trend buckets and summary stats for the selected time range.
// Query params: ?days=7 or ?start=...&end=... plus optional ?node_id=...
router.get("/analytics", async (req: Request, res: Response) => {
  const range = parseRange(req.query)
  if ("error" in range) {
    res.status(400).json({ error: range.error })
    return
  }

  const nodeId = req.query.node_id ? String(req.query.node_id) : undefined
  const bucketMode = range.days <= 2 ? "hour" : "day"
  const bucketMs = bucketMode === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000

  try {
    const readings = await prisma.sMART.findMany({
      where: {
        ...(nodeId ? { node_id: nodeId } : {}),
        timestamp: {
          gte: range.start,
          lte: range.end,
        },
      },
      orderBy: { timestamp: "asc" },
      select: {
        timestamp: true,
        temperature: true,
        humidity: true,
      },
    })

    if (readings.length === 0) {
      res.status(200).json({
        range: {
          start: range.start.toISOString(),
          end: range.end.toISOString(),
          days: range.days,
          bucket: bucketMode,
        },
        summary: {
          temperature: { min: null, max: null, avg: null },
          humidity: { min: null, max: null, avg: null },
          samples: 0,
        },
        series: [],
      })
      return
    }

    let tempMin = Number.POSITIVE_INFINITY
    let tempMax = Number.NEGATIVE_INFINITY
    let humMin = Number.POSITIVE_INFINITY
    let humMax = Number.NEGATIVE_INFINITY
    let tempSum = 0
    let humSum = 0

    readings.forEach((reading) => {
      const t = Number(reading.temperature)
      const h = Number(reading.humidity)
      tempMin = Math.min(tempMin, t)
      tempMax = Math.max(tempMax, t)
      humMin = Math.min(humMin, h)
      humMax = Math.max(humMax, h)
      tempSum += t
      humSum += h
    })

    const series = buildBuckets(readings, bucketMs)

    res.status(200).json({
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        days: range.days,
        bucket: bucketMode,
      },
      summary: {
        temperature: {
          min: Number(tempMin.toFixed(2)),
          max: Number(tempMax.toFixed(2)),
          avg: Number((tempSum / readings.length).toFixed(2)),
        },
        humidity: {
          min: Number(humMin.toFixed(2)),
          max: Number(humMax.toFixed(2)),
          avg: Number((humSum / readings.length).toFixed(2)),
        },
        samples: readings.length,
      },
      series,
    })
  } catch (error) {
    console.error("Failed to fetch analytics:", error)
    res.status(500).json({ error: "Internal server error." })
  }
})

export default router
