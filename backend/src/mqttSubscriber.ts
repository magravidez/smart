import mqtt, { MqttClient } from "mqtt"
import { prisma } from "./lib/prisma"

const MQTT_HOST = process.env.MQTT_HOST ?? "io.adafruit.com"
const MQTT_PORT = Number(process.env.MQTT_PORT ?? "443")
const MQTT_PROTOCOL = process.env.MQTT_PROTOCOL ?? "wss"
const MQTT_PATH = process.env.MQTT_PATH ?? "/mqtt"
const MQTT_CLIENT_ID =
  process.env.MQTT_CLIENT_ID ?? `smart-backend-${Math.random().toString(16).slice(2, 10)}`
const AIO_USERNAME = process.env.AIO_USERNAME
const AIO_KEY = process.env.AIO_KEY
const AIO_FEED_READING = process.env.AIO_FEED_READING ?? "smart_reading"

let subscriberStarted = false

function parseReadingPayload(payloadRaw: string): {
  node_id: string
  location: string
  temperature: number
  humidity: number
  timestamp: Date
} {
  const parsed = JSON.parse(payloadRaw)

  const { node_id, location, temperature, humidity, timestamp } = parsed

  if (
    node_id === undefined ||
    location === undefined ||
    temperature === undefined ||
    humidity === undefined
  ) {
    throw new Error("Missing required fields: node_id, location, temperature, humidity")
  }

  const temp = parseFloat(String(temperature))
  const hum = parseFloat(String(humidity))

  if (Number.isNaN(temp) || Number.isNaN(hum)) {
    throw new Error("temperature and humidity must be valid numbers")
  }

  let parsedTimestamp = new Date()
  if (timestamp !== undefined) {
    parsedTimestamp = new Date(timestamp)
    if (Number.isNaN(parsedTimestamp.getTime())) {
      throw new Error("timestamp must be a valid ISO 8601 date string")
    }
  }

  return {
    node_id: String(node_id),
    location: String(location),
    temperature: temp,
    humidity: hum,
    timestamp: parsedTimestamp,
  }
}

export function startMqttSubscriber(): MqttClient | null {
  if (subscriberStarted) {
    return null
  }

  if (!AIO_USERNAME || !AIO_KEY) {
    console.warn(
      "[MQTT] AIO_USERNAME or AIO_KEY is missing. MQTT subscriber is disabled."
    )
    return null
  }

  const topic = `${AIO_USERNAME}/feeds/${AIO_FEED_READING}`
  const isWebSocketProtocol = MQTT_PROTOCOL === "ws" || MQTT_PROTOCOL === "wss"
  const normalizedPath = MQTT_PATH.startsWith("/") ? MQTT_PATH : `/${MQTT_PATH}`
  const brokerUrl = isWebSocketProtocol
    ? `${MQTT_PROTOCOL}://${MQTT_HOST}:${MQTT_PORT}${normalizedPath}`
    : `${MQTT_PROTOCOL}://${MQTT_HOST}:${MQTT_PORT}`

  const wsPathOption = isWebSocketProtocol ? { path: normalizedPath } : {}

  const client = mqtt.connect(brokerUrl, {
    clientId: MQTT_CLIENT_ID,
    username: AIO_USERNAME,
    password: AIO_KEY,
    protocolVersion: 4,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30_000,
    keepalive: 60,
    ...wsPathOption,
  })

  subscriberStarted = true

  client.on("connect", () => {
    console.log(`[MQTT] Connected to ${brokerUrl} as ${MQTT_CLIENT_ID}`)
    client.subscribe(topic, (error) => {
      if (error) {
        console.error(`[MQTT] Failed to subscribe to ${topic}:`, error.message)
        return
      }
      console.log(`[MQTT] Subscribed to ${topic}`)
    })
  })

  client.on("message", async (messageTopic, payloadBuffer) => {
    if (messageTopic !== topic) {
      return
    }

    const payloadRaw = payloadBuffer.toString().trim()

    try {
      const reading = parseReadingPayload(payloadRaw)
      const saved = await prisma.sMART.create({
        data: reading,
      })
      console.log(
        `[MQTT] Reading saved (id=${saved.id}, node=${saved.node_id}, temp=${saved.temperature}, hum=${saved.humidity})`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[MQTT] Invalid payload ignored: ${message}`)
      console.error(`[MQTT] Raw payload: ${payloadRaw}`)
    }
  })

  client.on("reconnect", () => {
    console.log("[MQTT] Reconnecting...")
  })

  client.on("error", (error) => {
    console.error("[MQTT] Client error:", error.message)
  })

  client.on("close", () => {
    console.log("[MQTT] Connection closed")
  })

  return client
}
