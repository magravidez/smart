import { useState, useEffect, useCallback, useRef } from "react"
import mqtt from "mqtt"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts"

// ─── THEME ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#f5f0e8",
  bg2: "#ede8dc",
  bg3: "#e4ddd0",
  sidebar: "#2d2416",
  sideText: "#c9b99a",
  sideMute: "#6b5c43",
  border: "#d9d0c0",
  brown: "#5c3d1e",
  brownMd: "#8b6340",
  brownLt: "#c4a882",
  amber: "#c97c2a",
  sage: "#5a7a4a",
  clay: "#b05030",
  sky: "#4a7fa5",
  text: "#2d2416",
  textMd: "#6b5c43",
  textLt: "#a09070",
}

const FONT_DISPLAY = "'Playfair Display', Georgia, serif"
const FONT_MONO = "'JetBrains Mono', 'Courier New', monospace"
const FONT_BODY = "'DM Sans', sans-serif"

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const AIO_HOST = "wss://io.adafruit.com:443/mqtt"
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || "").replace(
  /\/$/,
  ""
)
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || ""
const SUPABASE_TABLE = import.meta.env.VITE_SUPABASE_TABLE || "sensor_logs"
const FEED_KEYS = [
  "node-1-rhundei-city-humidity",
  "node-1-rhundei-city-temp",
  "node-2-mariel-city-humidity",
  "node-2-mariel-city-temp",
  "node-3-christian-city-humidity",
  "node-3-christian-city-temp",
  "node-4-nichole-city-humidity",
  "node-4-nichole-city-temp",
  "node-5-kloie-city-humidity",
  "node-5-kloie-city-temp",
]

function fmt(n, d = 1) {
  return n != null ? (+n).toFixed(d) : "—"
}

function fmtTime(ts) {
  if (!ts) return "—"
  return new Date(ts).toLocaleString("en-PH", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function fmtTimeShort(ts) {
  if (!ts) return "—"
  return new Date(ts).toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

function fmtBucket(ts, mode) {
  if (!ts) return "—"
  const d = new Date(ts)
  if (mode === "hour") {
    return d.toLocaleString("en-PH", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
  }
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
  })
}

function getLatestPerNode(readings) {
  const map = {}
  readings.forEach((r) => {
    if (
      !map[r.node_id] ||
      new Date(r.timestamp) > new Date(map[r.node_id].timestamp)
    ) {
      map[r.node_id] = r
    }
  })
  return Object.values(map)
}

function safeParsePayload(payload) {
  const text = payload?.toString?.() ?? ""
  if (!text) return { text, parsed: null }
  try {
    const parsed = JSON.parse(text)
    return { text, parsed }
  } catch {
    return { text, parsed: null }
  }
}

function parseAioValue(payload) {
  const { text, parsed } = safeParsePayload(payload)
  if (typeof parsed === "number") return { value: parsed, text }
  if (parsed && typeof parsed === "object" && parsed.value != null) {
    const value = Number(parsed.value)
    return { value: Number.isFinite(value) ? value : null, text }
  }
  const value = Number.parseFloat(text)
  return { value: Number.isFinite(value) ? value : null, text }
}

function toTitleCase(input) {
  return input
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ")
}

function parseFeedKey(feedKey) {
  const parts = feedKey.split("-")
  const metric = parts[parts.length - 1]
  const nodeIndex = parts.findIndex((p) => p === "node")
  const nodeNumber = parts[nodeIndex + 1] || "?"
  const locationParts = parts.slice(nodeIndex + 2, -1)
  return {
    nodeId: `NODE_${nodeNumber}`,
    location: toTitleCase(locationParts.join(" ")),
    metric,
  }
}

function humanizeNodeId(nodeId) {
  if (!nodeId) return "Unknown"
  const parts = nodeId.toString().split("-")
  return toTitleCase(parts.slice(2).join(" ") || nodeId.replace(/[-_]/g, " "))
}

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
}

function stdDev(values) {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = mean(values.map((value) => (value - avg) ** 2))
  return Math.sqrt(variance)
}

function pctChange(previous, current) {
  if (!Number.isFinite(previous) || previous === 0) return 0
  return ((current - previous) / previous) * 100
}

function correlation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) return 0
  const xAvg = mean(xs)
  const yAvg = mean(ys)
  let numerator = 0
  let xVariance = 0
  let yVariance = 0
  for (let index = 0; index < xs.length; index += 1) {
    const xDelta = xs[index] - xAvg
    const yDelta = ys[index] - yAvg
    numerator += xDelta * yDelta
    xVariance += xDelta ** 2
    yVariance += yDelta ** 2
  }
  const denominator = Math.sqrt(xVariance * yVariance)
  return denominator ? numerator / denominator : 0
}

function classifyCorrelation(value) {
  const absolute = Math.abs(value)
  if (absolute >= 0.7) return "strong"
  if (absolute >= 0.4) return "moderate"
  if (absolute >= 0.2) return "weak"
  return "minimal"
}

function linearForecast(values, horizon = 1) {
  if (!values.length) return 0
  if (values.length === 1) return values[0]

  const xs = values.map((_, index) => index)
  const xAvg = mean(xs)
  const yAvg = mean(values)
  let numerator = 0
  let denominator = 0

  xs.forEach((x, index) => {
    numerator += (x - xAvg) * (values[index] - yAvg)
    denominator += (x - xAvg) ** 2
  })

  const slope = denominator ? numerator / denominator : 0
  const intercept = yAvg - slope * xAvg
  return intercept + slope * (values.length - 1 + horizon)
}

function pickBucket(series, keyName, mode, direction) {
  if (!series.length) return null
  const sorted = [...series].sort(
    (left, right) => direction * ((left[keyName] || 0) - (right[keyName] || 0))
  )
  const bucket = sorted[0]
  return bucket
    ? {
        label: fmtBucket(bucket.bucketStart, mode),
        value: bucket[keyName] || 0,
      }
    : null
}

function normalizeHistoricalLog(row, index) {
  const timestamp =
    row.created_at || row.timestamp || row.inserted_at || row.logged_at
  return {
    id: row.id ?? `${timestamp || "row"}-${index}`,
    node_id: row.node_id || row.nodeId || `HIST_${index + 1}`,
    location: row.location || humanizeNodeId(row.node_id || row.nodeId),
    temperature: Number(row.temperature),
    humidity: Number(row.humidity),
    timestamp,
  }
}

async function fetchSupabaseReadings(maxRows = 500) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env."
    )
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`)
  url.searchParams.set("select", "id,node_id,temperature,humidity,created_at")
  url.searchParams.set("order", "created_at.desc")
  url.searchParams.set("limit", `${maxRows}`)

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(
      details || `Supabase readings request failed with ${response.status}.`
    )
  }

  const rows = await response.json()
  return rows
    .map(normalizeHistoricalLog)
    .filter(
      (row) =>
        row.timestamp &&
        Number.isFinite(row.temperature) &&
        Number.isFinite(row.humidity)
    )
}

async function fetchSupabaseLogs(days) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Missing Supabase configuration. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in frontend/.env."
    )
  }

  const cutoffIso = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString()
  const url = new URL(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`)
  url.searchParams.set("select", "id,node_id,temperature,humidity,created_at")
  url.searchParams.set("created_at", `gte.${cutoffIso}`)
  url.searchParams.set("order", "created_at.asc")
  url.searchParams.set(
    "limit",
    days <= 1 ? "1500" : days <= 7 ? "5000" : "12000"
  )

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(
      details || `Supabase request failed with ${response.status}.`
    )
  }

  const rows = await response.json()
  return rows
    .map(normalizeHistoricalLog)
    .filter(
      (row) =>
        row.timestamp &&
        Number.isFinite(row.temperature) &&
        Number.isFinite(row.humidity)
    )
}

function buildAnalytics(readings, days) {
  const now = Date.now()
  const windowMs = days * 24 * 60 * 60 * 1000
  const cutoff = now - windowMs
  const filtered = readings.filter(
    (r) => new Date(r.timestamp).getTime() >= cutoff
  )
  if (filtered.length === 0) {
    return {
      summary: {
        temperature: { avg: 0, min: 0, max: 0 },
        humidity: { avg: 0, min: 0, max: 0 },
        samples: 0,
      },
      range: { bucket: days <= 1 ? "hour" : "day" },
      series: [],
      descriptive: { highlights: [], source: "Supabase sensor_logs" },
      diagnostic: {
        findings: [],
        comparison: null,
        tempHumidityCorrelation: 0,
      },
      predictive: { forecast: null, findings: [] },
    }
  }

  const bucketMode = days <= 1 ? "hour" : "day"
  const buckets = new Map()
  filtered.forEach((r) => {
    const date = new Date(r.timestamp)
    const bucketStart =
      bucketMode === "hour"
        ? new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours()
          ).toISOString()
        : new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate()
          ).toISOString()
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, { temps: [], hums: [] })
    }
    const bucket = buckets.get(bucketStart)
    if (typeof r.temperature === "number") bucket.temps.push(r.temperature)
    if (typeof r.humidity === "number") bucket.hums.push(r.humidity)
  })

  const series = Array.from(buckets.entries())
    .sort(([a], [b]) => new Date(a) - new Date(b))
    .map(([bucketStart, bucket]) => ({
      bucketStart,
      temperatureAvg: bucket.temps.length
        ? bucket.temps.reduce((s, v) => s + v, 0) / bucket.temps.length
        : 0,
      humidityAvg: bucket.hums.length
        ? bucket.hums.reduce((s, v) => s + v, 0) / bucket.hums.length
        : 0,
    }))

  const temps = filtered
    .map((r) => r.temperature)
    .filter((v) => typeof v === "number")
  const hums = filtered
    .map((r) => r.humidity)
    .filter((v) => typeof v === "number")

  const tempAvg = temps.length
    ? temps.reduce((s, v) => s + v, 0) / temps.length
    : 0
  const humAvg = hums.length ? hums.reduce((s, v) => s + v, 0) / hums.length : 0

  const midpoint = Math.max(1, Math.floor(filtered.length / 2))
  const earlier = filtered.slice(0, midpoint)
  const recent = filtered.slice(midpoint)

  const earlierTempAvg = mean(
    earlier
      .map((row) => row.temperature)
      .filter((value) => typeof value === "number")
  )
  const recentTempAvg = mean(
    recent
      .map((row) => row.temperature)
      .filter((value) => typeof value === "number")
  )
  const earlierHumAvg = mean(
    earlier
      .map((row) => row.humidity)
      .filter((value) => typeof value === "number")
  )
  const recentHumAvg = mean(
    recent
      .map((row) => row.humidity)
      .filter((value) => typeof value === "number")
  )

  const comfortSamples = filtered.filter(
    (row) =>
      row.temperature >= 20 &&
      row.temperature <= 32 &&
      row.humidity >= 55 &&
      row.humidity <= 80
  ).length
  const comfortRate = filtered.length
    ? (comfortSamples / filtered.length) * 100
    : 0
  const humidityCorrelation = correlation(temps, hums)
  const temperatureStdDev = stdDev(temps)
  const humidityStdDev = stdDev(hums)

  const hottestBucket = pickBucket(series, "temperatureAvg", bucketMode, -1)
  const coolestBucket = pickBucket(series, "temperatureAvg", bucketMode, 1)
  const driestBucket = pickBucket(series, "humidityAvg", bucketMode, 1)
  const mostHumidBucket = pickBucket(series, "humidityAvg", bucketMode, -1)

  const temperatureForecast = linearForecast(
    series.map((bucket) => bucket.temperatureAvg)
  )
  const humidityForecast = linearForecast(
    series.map((bucket) => bucket.humidityAvg)
  )
  const nextBucketLabel = bucketMode === "hour" ? "next hour" : "next day"
  const tempTrendDirection =
    recentTempAvg >= earlierTempAvg ? "upward" : "downward"
  const humidityTrendDirection =
    recentHumAvg >= earlierHumAvg ? "upward" : "downward"

  const descriptiveHighlights = [
    `Collected ${filtered.length} validated readings from Supabase over the last ${days === 1 ? "24 hours" : `${days} days`}.`,
    `Average temperature held at ${fmt(tempAvg)}°C while average humidity stayed at ${fmt(humAvg)}%.`,
    hottestBucket
      ? `Peak heat appeared around ${hottestBucket.label} with a bucket average of ${fmt(hottestBucket.value)}°C.`
      : null,
    mostHumidBucket
      ? `The most humid window was ${mostHumidBucket.label} at ${fmt(mostHumidBucket.value)}% average humidity.`
      : null,
    `Comfort-band conditions were met in ${fmt(comfortRate)}% of all logged samples.`,
  ].filter(Boolean)

  const diagnosticFindings = [
    `Temperature and humidity have a ${classifyCorrelation(humidityCorrelation)} ${humidityCorrelation < 0 ? "inverse" : "direct"} relationship (r = ${fmt(humidityCorrelation, 2)}).`,
    `Recent readings are ${tempTrendDirection}: temperature changed by ${fmt(Math.abs(pctChange(earlierTempAvg, recentTempAvg)))}% and humidity changed by ${fmt(Math.abs(pctChange(earlierHumAvg, recentHumAvg)))}% versus the earlier half of the dataset.`,
    coolestBucket && driestBucket && coolestBucket.label === driestBucket.label
      ? `The coolest and driest bucket both landed on ${coolestBucket.label}, which suggests a shared environmental event in that period.`
      : `Temperature volatility is ${fmt(temperatureStdDev)}°C and humidity volatility is ${fmt(humidityStdDev)}%, which helps explain the spread in the charts.`,
  ].filter(Boolean)

  const predictiveFindings = [
    `Linear trend forecasting projects ${fmt(temperatureForecast)}°C and ${fmt(humidityForecast)}% for the ${nextBucketLabel}.`,
    temperatureForecast >= 32
      ? "Projected temperature is entering heat-stress territory, so irrigation and shade checks should be prioritized."
      : temperatureForecast <= 20
        ? "Projected temperature is unusually cool, so check whether the next period aligns with night or rainfall conditions."
        : "Projected temperature remains inside the farm's current operating band.",
    humidityForecast <= 55
      ? "Projected humidity is dry enough to risk moisture stress if the trend persists."
      : humidityForecast >= 85
        ? "Projected humidity is high enough to raise mold or condensation risk if sustained."
        : "Projected humidity remains in a moderate band for the next bucket.",
  ]

  return {
    summary: {
      temperature: {
        avg: tempAvg,
        min: temps.length ? Math.min(...temps) : 0,
        max: temps.length ? Math.max(...temps) : 0,
      },
      humidity: {
        avg: humAvg,
        min: hums.length ? Math.min(...hums) : 0,
        max: hums.length ? Math.max(...hums) : 0,
      },
      samples: filtered.length,
    },
    range: {
      bucket: bucketMode,
      from: filtered[0]?.timestamp,
      to: filtered[filtered.length - 1]?.timestamp,
    },
    series,
    descriptive: {
      source: "Supabase sensor_logs",
      highlights: descriptiveHighlights,
      comfortRate,
      temperatureStdDev,
      humidityStdDev,
      hottestBucket,
      coolestBucket,
      driestBucket,
      mostHumidBucket,
    },
    diagnostic: {
      tempHumidityCorrelation: humidityCorrelation,
      findings: diagnosticFindings,
      comparison: {
        earlier: {
          label: "Earlier half",
          temperatureAvg: earlierTempAvg,
          humidityAvg: earlierHumAvg,
        },
        recent: {
          label: "Recent half",
          temperatureAvg: recentTempAvg,
          humidityAvg: recentHumAvg,
        },
        changes: {
          temperaturePct: pctChange(earlierTempAvg, recentTempAvg),
          humidityPct: pctChange(earlierHumAvg, recentHumAvg),
        },
      },
    },
    predictive: {
      forecast: {
        label: nextBucketLabel,
        temperature: temperatureForecast,
        humidity: humidityForecast,
      },
      findings: predictiveFindings,
    },
  }
}

// ─── CREDENTIAL HELPERS ──────────────────────────────────────────────────────
function loadSavedCredentials() {
  return {
    username: localStorage.getItem("aio_username") || "",
    key: localStorage.getItem("aio_key") || "",
  }
}

function saveCredentials(username, key) {
  localStorage.setItem("aio_username", username)
  localStorage.setItem("aio_key", key)
}

function clearCredentials() {
  localStorage.removeItem("aio_username")
  localStorage.removeItem("aio_key")
}

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = {
  dashboard: (
    <svg
      width="18"
      height="18"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  nodes: (
    <svg
      width="18"
      height="18"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="20" cy="12" r="2" />
      <circle cx="12" cy="20" r="2" />
      <circle cx="4" cy="12" r="2" />
      <line x1="12" y1="7" x2="12" y2="9" />
      <line x1="15" y1="12" x2="18" y2="12" />
      <line x1="12" y1="15" x2="12" y2="18" />
      <line x1="9" y1="12" x2="6" y2="12" />
    </svg>
  ),
  readings: (
    <svg
      width="18"
      height="18"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  ),
  analytics: (
    <svg
      width="18"
      height="18"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <polyline points="3 17 9 11 13 15 21 7" />
      <circle cx="3" cy="17" r="1.5" />
      <circle cx="9" cy="11" r="1.5" />
      <circle cx="13" cy="15" r="1.5" />
      <circle cx="21" cy="7" r="1.5" />
    </svg>
  ),
  temp: (
    <svg
      width="16"
      height="16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z" />
    </svg>
  ),
  humidity: (
    <svg
      width="16"
      height="16"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />
    </svg>
  ),
  location: (
    <svg
      width="14"
      height="14"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  signal: (
    <svg
      width="14"
      height="14"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M1.42 9a16 16 0 0121.16 0" />
      <path d="M5 12.55a11 11 0 0114.08 0" />
      <path d="M8.53 16.11a6 6 0 016.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  ),
  subscriber: (
    <svg
      width="18"
      height="18"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4 12a8 8 0 0116 0" />
      <path d="M7 12a5 5 0 0110 0" />
      <path d="M10 12a2 2 0 014 0" />
      <circle cx="12" cy="16" r="2" />
    </svg>
  ),
  refresh: (
    <svg
      width="14"
      height="14"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  ),
  key: (
    <svg
      width="14"
      height="14"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  check: (
    <svg
      width="14"
      height="14"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  trash: (
    <svg
      width="13"
      height="13"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  ),
}

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────────
const globalStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=JetBrains+Mono:wght@400;600&family=DM+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f5f0e8; font-family: 'DM Sans', sans-serif; }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #ede8dc; }
  ::-webkit-scrollbar-thumb { background: #c4a882; border-radius: 3px; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; } to { opacity: 1; }
  }
  @keyframes pulse {
    0%,100% { opacity: 1; } 50% { opacity: .35; }
  }
  @keyframes flashRow {
    from { background: #c97c2a22; } to { background: transparent; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes slideDown {
    from { opacity: 0; transform: translateY(-8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .fade-up { animation: fadeUp .5s ease both; }
  .fade-in { animation: fadeIn .4s ease both; }
  .new-row td { animation: flashRow 1.4s ease; }

  input:focus {
    outline: none;
    border-color: #c97c2a !important;
    box-shadow: 0 0 0 3px rgba(201,124,42,0.12);
  }
`

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, delay = 0, icon }) {
  return (
    <div
      className="fade-up"
      style={{
        animationDelay: `${delay}s`,
        background: "#fff9f2",
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: "22px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: "0 1px 4px rgba(45,36,22,.06)",
        transition: "box-shadow .2s, transform .2s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 16px rgba(45,36,22,.10)"
        e.currentTarget.style.transform = "translateY(-2px)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(45,36,22,.06)"
        e.currentTarget.style.transform = "translateY(0)"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: C.textLt,
          }}
        >
          {label}
        </span>
        <span style={{ color: accent, opacity: 0.7 }}>{icon}</span>
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 32,
          fontWeight: 700,
          color: accent,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 12, color: C.textLt }}>{sub}</div>
    </div>
  )
}

// ─── NODE CARD ────────────────────────────────────────────────────────────────
function NodeCard({ node, delay = 0 }) {
  return (
    <div
      className="fade-up"
      style={{
        animationDelay: `${delay}s`,
        background: "#fff9f2",
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: "22px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
        height: "100%",
        boxShadow: "0 1px 4px rgba(45,36,22,.06)",
        transition: "box-shadow .2s, transform .2s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 14px rgba(45,36,22,.10)"
        e.currentTarget.style.transform = "translateY(-2px)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 4px rgba(45,36,22,.06)"
        e.currentTarget.style.transform = "translateY(0)"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontWeight: 600,
              fontSize: 13,
              color: C.brown,
            }}
          >
            {node.node_id}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              marginTop: 3,
              color: C.textLt,
              fontSize: 11,
            }}
          >
            {Icon.location}
            {node.location.replace(/_/g, " ")}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            background: "#e8f0e0",
            border: "1px solid #b8d4a0",
            borderRadius: 100,
            padding: "3px 10px",
            fontSize: 10,
            fontFamily: FONT_MONO,
            color: C.sage,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: C.sage,
              animation: "pulse 2s infinite",
              display: "inline-block",
            }}
          />
          LIVE
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 14,
          alignItems: "stretch",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            flex: "0 1 150px",
            background: "#fff3e6",
            border: `1px solid #f0d4b0`,
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 82,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: C.amber,
              marginBottom: 4,
            }}
          >
            {Icon.temp}
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              Temp
            </span>
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 28,
              fontWeight: 700,
              color: C.amber,
              lineHeight: 1,
              display: "flex",
              alignItems: "baseline",
              gap: 4,
            }}
          >
            {fmt(node.temperature)}
            <span style={{ fontSize: 14 }}>°C</span>
          </div>
        </div>
        <div
          style={{
            flex: "0 1 150px",
            background: "#e8f2fa",
            border: `1px solid #b0d0e8`,
            borderRadius: 10,
            padding: "12px 16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minHeight: 82,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: C.sky,
              marginBottom: 4,
            }}
          >
            {Icon.humidity}
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 1.2,
                textTransform: "uppercase",
              }}
            >
              Humidity
            </span>
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 28,
              fontWeight: 700,
              color: C.sky,
              lineHeight: 1,
              display: "flex",
              alignItems: "baseline",
              gap: 4,
            }}
          >
            {fmt(node.humidity)}
            <span style={{ fontSize: 14 }}>%</span>
          </div>
        </div>
      </div>

      <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textLt }}>
        Last reading · {fmtTime(node.timestamp)}
      </div>
    </div>
  )
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({
  activePage,
  setActivePage,
  isOnline,
  lastUpdated,
  hasCredentials,
}) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: Icon.dashboard },
    { id: "nodes", label: "Node Overview", icon: Icon.nodes },
    { id: "readings", label: "All Readings", icon: Icon.readings },
    { id: "analytics", label: "Analytics", icon: Icon.analytics },
    { id: "subscriber", label: "Custom Subscriber", icon: Icon.subscriber },
  ]

  return (
    <aside
      style={{
        width: 230,
        minHeight: "100vh",
        flexShrink: 0,
        background: C.sidebar,
        display: "flex",
        flexDirection: "column",
        padding: "28px 0",
        position: "sticky",
        top: 0,
        height: "100vh",
      }}
    >
      {/* Brand */}
      <div style={{ padding: "0 24px 28px" }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 28,
            fontWeight: 700,
            color: "#f5f0e8",
            letterSpacing: 2,
          }}
        >
          SMART
        </div>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: C.sideMute,
            marginTop: 4,
            letterSpacing: 1,
            lineHeight: 1.6,
          }}
        >
          SMART FARM MONITOR
        </div>
      </div>

      {/* Status */}
      <div style={{ padding: "0 16px 24px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: isOnline ? "#1a2e10" : "#2e1010",
            border: `1px solid ${isOnline ? "#3a5a28" : "#5a2828"}`,
            borderRadius: 10,
            padding: "8px 12px",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: isOnline ? C.sage : C.clay,
              boxShadow: `0 0 6px ${isOnline ? C.sage : C.clay}`,
              animation: "pulse 2s infinite",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: isOnline ? "#90c870" : "#e07070",
              }}
            >
              {isOnline ? "NETWORK LIVE" : "OFFLINE"}
            </div>
            {lastUpdated && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  color: C.sideMute,
                  marginTop: 2,
                }}
              >
                {lastUpdated}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "#3d3020", margin: "0 0 12px" }} />

      {/* Nav */}
      <nav style={{ flex: 1, padding: "0 10px" }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: C.sideMute,
            letterSpacing: 1.5,
            padding: "0 14px",
            marginBottom: 8,
          }}
        >
          NAVIGATION
        </div>
        {navItems.map((item) => {
          const active = activePage === item.id
          const needsBadge = item.id === "subscriber" && !hasCredentials
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                background: active ? "#c97c2a22" : "transparent",
                color: active ? "#e8b870" : C.sideText,
                fontFamily: FONT_BODY,
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                textAlign: "left",
                transition: "background .15s, color .15s",
                marginBottom: 2,
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = "#ffffff0d"
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = "transparent"
              }}
            >
              <span style={{ opacity: active ? 1 : 0.6 }}>{item.icon}</span>
              {item.label}
              {needsBadge && (
                <span
                  style={{
                    marginLeft: "auto",
                    background: "#c97c2a",
                    color: "#fff",
                    fontFamily: FONT_MONO,
                    fontSize: 8,
                    letterSpacing: 0.5,
                    padding: "2px 5px",
                    borderRadius: 4,
                    lineHeight: 1.4,
                  }}
                >
                  SETUP
                </span>
              )}
              {active && !needsBadge && (
                <span
                  style={{
                    marginLeft: "auto",
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: "#e8b870",
                  }}
                />
              )}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: "16px 24px 0", borderTop: "1px solid #3d3020" }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: C.sideMute,
            lineHeight: 1.8,
          }}
        >
          Star Topology · IIoT
          <br />
          Edge Computing · Poll 5s
        </div>
      </div>
    </aside>
  )
}

function TrendCard({ title, color, series, keyName, bucketMode, unit }) {
  return (
    <div
      style={{
        background: "#fff9f2",
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: "16px 16px 10px",
        boxShadow: "0 1px 6px rgba(45,36,22,.06)",
        minHeight: 300,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: C.textLt,
          }}
        >
          {title}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, color }}>
          {series.length} buckets
        </div>
      </div>
      <div style={{ width: "100%", height: 250 }}>
        <ResponsiveContainer>
          <LineChart
            data={series}
            margin={{ top: 14, right: 10, left: 0, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis
              dataKey="bucketStart"
              tickFormatter={(v) => fmtBucket(v, bucketMode)}
              minTickGap={24}
              tick={{ fontSize: 10, fill: C.textLt, fontFamily: FONT_MONO }}
              stroke={C.border}
            />
            <YAxis
              tick={{ fontSize: 10, fill: C.textLt, fontFamily: FONT_MONO }}
              stroke={C.border}
            />
            <Tooltip
              formatter={(value) => [`${fmt(value, 2)} ${unit}`, title]}
              labelFormatter={(label) => fmtBucket(label, bucketMode)}
              contentStyle={{
                background: "#fff9f2",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                fontFamily: FONT_MONO,
                fontSize: 11,
              }}
            />
            <Line
              type="monotone"
              dataKey={keyName}
              stroke={color}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function InsightPanel({ title, eyebrow, children }) {
  return (
    <section
      style={{
        background: "#fff9f2",
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: "20px 22px",
        boxShadow: "0 1px 6px rgba(45,36,22,.06)",
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: C.textLt,
            marginBottom: 6,
          }}
        >
          {eyebrow}
        </div>
        <h2
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 24,
            fontWeight: 700,
            color: C.brown,
          }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

function AnalysisList({ items, accent }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((item) => (
        <div
          key={item}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 10,
            background: `${accent}12`,
            border: `1px solid ${accent}33`,
          }}
        >
          <span
            style={{
              color: accent,
              fontFamily: FONT_MONO,
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            ●
          </span>
          <p style={{ color: C.textMd, fontSize: 13, lineHeight: 1.65 }}>
            {item}
          </p>
        </div>
      ))}
    </div>
  )
}

function ComparisonCard({ title, value, note }) {
  return (
    <div
      style={{
        background: C.bg2,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: C.textLt,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 24,
          fontWeight: 700,
          color: C.brown,
        }}
      >
        {value}
      </div>
      <div style={{ color: C.textMd, fontSize: 12, lineHeight: 1.5 }}>
        {note}
      </div>
    </div>
  )
}

function AnalyticsPage({
  analytics,
  analyticsLoading,
  analyticsError,
  analyticsDays,
  setAnalyticsDays,
  onRefresh,
}) {
  if (analyticsLoading && !analytics)
    return <Loader text="Loading analytics..." />

  return (
    <div className="fade-in">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 24,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 30,
              fontWeight: 700,
              color: C.brown,
            }}
          >
            Analytics
          </h1>
          <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>
            Supabase-backed historical analytics with descriptive, diagnostic,
            and predictive reporting
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select
            value={analyticsDays}
            onChange={(e) => setAnalyticsDays(+e.target.value)}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              background: "#fff9f2",
              color: C.brown,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 14px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value={1}>Last 24 Hours</option>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
          </select>
          <button
            onClick={onRefresh}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.brownMd,
              background: C.bg2,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "7px 12px",
              cursor: "pointer",
            }}
          >
            {Icon.refresh} Refresh
          </button>
        </div>
      </div>

      {analyticsError && (
        <div
          style={{
            marginBottom: 16,
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.clay,
            background: "#fae8e8",
            border: "1px solid #f0c0c0",
            borderRadius: 8,
            padding: "8px 10px",
            width: "fit-content",
          }}
        >
          {analyticsError}
        </div>
      )}

      {!analytics || analytics.summary.samples === 0 ? (
        <Empty text="No analytics data in this time range." />
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5,minmax(0,1fr))",
              gap: 14,
              marginBottom: 24,
            }}
          >
            <StatCard
              label="Avg Temp"
              value={`${fmt(analytics.summary.temperature.avg)}°C`}
              sub="selected range"
              accent={C.amber}
              icon={Icon.temp}
            />
            <StatCard
              label="Min Temp"
              value={`${fmt(analytics.summary.temperature.min)}°C`}
              sub="selected range"
              accent={C.brownMd}
              icon={Icon.temp}
            />
            <StatCard
              label="Max Temp"
              value={`${fmt(analytics.summary.temperature.max)}°C`}
              sub="selected range"
              accent={C.clay}
              icon={Icon.temp}
            />
            <StatCard
              label="Avg Humidity"
              value={`${fmt(analytics.summary.humidity.avg)}%`}
              sub="selected range"
              accent={C.sky}
              icon={Icon.humidity}
            />
            <StatCard
              label="Samples"
              value={analytics.summary.samples}
              sub={`${analytics.range.bucket} buckets from Supabase`}
              accent={C.sage}
              icon={Icon.readings}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <TrendCard
              title="Temperature Trend"
              color={C.amber}
              series={analytics.series}
              keyName="temperatureAvg"
              bucketMode={analytics.range.bucket}
              unit="°C"
            />
            <TrendCard
              title="Humidity Trend"
              color={C.sky}
              series={analytics.series}
              keyName="humidityAvg"
              bucketMode={analytics.range.bucket}
              unit="%"
            />
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            <InsightPanel
              title="Descriptive Analytics"
              eyebrow="What happened?"
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <ComparisonCard
                  title="Comfort Rate"
                  value={`${fmt(analytics.descriptive.comfortRate)}%`}
                  note="Share of samples inside the target temperature and humidity band."
                />
                <ComparisonCard
                  title="Temp Volatility"
                  value={`${fmt(analytics.descriptive.temperatureStdDev)}°C`}
                  note="Standard deviation of temperature across the selected range."
                />
                <ComparisonCard
                  title="Humidity Volatility"
                  value={`${fmt(analytics.descriptive.humidityStdDev)}%`}
                  note="Standard deviation of humidity across the selected range."
                />
              </div>
              <AnalysisList
                items={analytics.descriptive.highlights}
                accent={C.sage}
              />
            </InsightPanel>

            <InsightPanel
              title="Diagnostic Analytics"
              eyebrow="Why did it happen?"
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <ComparisonCard
                  title="Earlier Half Temp"
                  value={`${fmt(analytics.diagnostic.comparison.earlier.temperatureAvg)}°C`}
                  note="Baseline average from the first half of the selected history."
                />
                <ComparisonCard
                  title="Recent Half Temp"
                  value={`${fmt(analytics.diagnostic.comparison.recent.temperatureAvg)}°C`}
                  note={`Change of ${fmt(analytics.diagnostic.comparison.changes.temperaturePct)}% against the earlier half.`}
                />
                <ComparisonCard
                  title="Correlation"
                  value={`r = ${fmt(analytics.diagnostic.tempHumidityCorrelation, 2)}`}
                  note="Pearson correlation between temperature and humidity samples."
                />
                <ComparisonCard
                  title="Recent Half Humidity"
                  value={`${fmt(analytics.diagnostic.comparison.recent.humidityAvg)}%`}
                  note={`Change of ${fmt(analytics.diagnostic.comparison.changes.humidityPct)}% against the earlier half.`}
                />
              </div>
              <AnalysisList
                items={analytics.diagnostic.findings}
                accent={C.clay}
              />
            </InsightPanel>

            <InsightPanel
              title="Predictive Analytics"
              eyebrow="What is likely to happen?"
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <ComparisonCard
                  title="Forecast Window"
                  value={analytics.predictive.forecast.label}
                  note="Projection horizon based on the current bucket granularity."
                />
                <ComparisonCard
                  title="Forecast Temp"
                  value={`${fmt(analytics.predictive.forecast.temperature)}°C`}
                  note="Linear trend estimate from the selected historical window."
                />
                <ComparisonCard
                  title="Forecast Humidity"
                  value={`${fmt(analytics.predictive.forecast.humidity)}%`}
                  note="Linear trend estimate from the selected historical window."
                />
              </div>
              <AnalysisList
                items={analytics.predictive.findings}
                accent={C.sky}
              />
            </InsightPanel>
          </div>
        </>
      )}
    </div>
  )
}

// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────────
function DashboardPage({ readings }) {
  if (!readings) return <Loader text="Loading dashboard…" />

  const nodes = new Set(readings.map((r) => r.node_id)).size
  const avgTemp = readings.length
    ? readings.reduce((s, r) => s + +r.temperature, 0) / readings.length
    : 0
  const avgHum = readings.length
    ? readings.reduce((s, r) => s + +r.humidity, 0) / readings.length
    : 0
  const nodeList = getLatestPerNode(readings)

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 30,
            fontWeight: 700,
            color: C.brown,
          }}
        >
          Farm Overview
        </h1>
        <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>
          Real-time monitoring across all sensor nodes
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <StatCard
          label="Total Readings"
          value={readings.length}
          sub="all nodes combined"
          accent={C.brown}
          delay={0}
          icon={Icon.readings}
        />
        <StatCard
          label="Active Nodes"
          value={nodes}
          sub="transmitting data"
          accent={C.sage}
          delay={0.07}
          icon={Icon.signal}
        />
        <StatCard
          label="Avg Temperature"
          value={`${fmt(avgTemp)}°C`}
          sub="network average"
          accent={C.amber}
          delay={0.14}
          icon={Icon.temp}
        />
        <StatCard
          label="Avg Humidity"
          value={`${fmt(avgHum)}%`}
          sub="network average"
          accent={C.sky}
          delay={0.21}
          icon={Icon.humidity}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <h2
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: C.textLt,
            marginBottom: 14,
          }}
        >
          Latest per Node
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
            gap: 16,
            alignItems: "stretch",
            gridAutoRows: "1fr",
          }}
        >
          {nodeList.map((n, i) => (
            <NodeCard key={n.node_id} node={n} delay={i * 0.07} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── PAGE: NODES ──────────────────────────────────────────────────────────────
function NodesPage({ readings }) {
  if (!readings) return <Loader text="Loading nodes…" />
  const nodeList = getLatestPerNode(readings)

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 30,
            fontWeight: 700,
            color: C.brown,
          }}
        >
          Node Overview
        </h1>
        <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>
          Latest reading from each sensor node
        </p>
      </div>
      {nodeList.length === 0 ? (
        <Empty text="No nodes transmitting yet." />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
            gap: 18,
          }}
        >
          {nodeList.map((n, i) => (
            <NodeCard key={n.node_id} node={n} delay={i * 0.08} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── PAGE: READINGS ───────────────────────────────────────────────────────────
function ReadingsPage({
  readings,
  limit,
  setLimit,
  locationFilter,
  setLocationFilter,
}) {
  const [prevFirstId, setPrevFirstId] = useState(null)
  const [newId, setNewId] = useState(null)

  useEffect(() => {
    if (!readings || readings.length === 0) return
    const first = readings[0]?.id
    if (prevFirstId !== null && first !== prevFirstId) setNewId(first)
    setPrevFirstId(first)
  }, [readings])

  if (!readings) return <Loader text="Loading readings…" />

  return (
    <div className="fade-in">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 28,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 30,
              fontWeight: 700,
              color: C.brown,
            }}
          >
            All Readings
          </h1>
          <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>
            Sensor data log, latest first
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              background: "#fff9f2",
              color: C.brown,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 14px",
              paddingRight: 20,
              cursor: "pointer",
              outline: "none",
              marginTop: 6,
            }}
          >
            <option>All Locations</option>
            <option>Rhundei City</option>
            <option>Mariel City</option>
            <option>Christian City</option>
            <option>Nichole City</option>
            <option>Kloie City</option>
          </select>
          <select
            value={limit}
            onChange={(e) => setLimit(+e.target.value)}
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              background: "#fff9f2",
              color: C.brown,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 14px",
              paddingRight: 20,
              cursor: "pointer",
              outline: "none",
              marginTop: 6,
            }}
          >
            <option value={20}>Last 20</option>
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
          </select>
        </div>
      </div>

      <div
        style={{
          background: "#fff9f2",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 1px 6px rgba(45,36,22,.06)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  background: C.bg2,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {[
                  "#",
                  "Node ID",
                  "Location",
                  "Temp (°C)",
                  "Humidity (%)",
                  "Timestamp",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      color: C.textLt,
                      padding: "12px 18px",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {readings.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <Empty text="No readings found." />
                  </td>
                </tr>
              ) : (
                readings.map((r, i) => (
                  <tr
                    key={r.id}
                    className={r.id === newId ? "new-row" : ""}
                    style={{
                      borderBottom:
                        i < readings.length - 1 ? `1px solid ${C.bg3}` : "none",
                      transition: "background .15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f5ede0")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td
                      style={{
                        padding: "11px 18px",
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: C.textLt,
                      }}
                    >
                      {r.id}
                    </td>
                    <td
                      style={{
                        padding: "11px 18px",
                        fontFamily: FONT_MONO,
                        fontWeight: 600,
                        fontSize: 12,
                        color: C.brown,
                      }}
                    >
                      {r.node_id}
                    </td>
                    <td style={{ padding: "11px 18px" }}>
                      <span
                        style={{
                          background: C.bg3,
                          border: `1px solid ${C.border}`,
                          borderRadius: 6,
                          padding: "2px 9px",
                          fontFamily: FONT_MONO,
                          fontSize: 11,
                          color: C.brownMd,
                        }}
                      >
                        {r.location.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "11px 18px",
                        fontFamily: FONT_MONO,
                        fontWeight: 600,
                        fontSize: 13,
                        color: C.amber,
                      }}
                    >
                      {fmt(r.temperature)} °C
                    </td>
                    <td
                      style={{
                        padding: "11px 18px",
                        fontFamily: FONT_MONO,
                        fontWeight: 600,
                        fontSize: 13,
                        color: C.sky,
                      }}
                    >
                      {fmt(r.humidity)} %
                    </td>
                    <td
                      style={{
                        padding: "11px 18px",
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: C.textLt,
                      }}
                    >
                      {fmtTime(r.timestamp)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── PAGE: CUSTOM SUBSCRIBER ─────────────────────────────────────────────────
function SubscriberPage({
  savedUsername,
  savedKey,
  onSaveAndConnect,
  onDisconnect,
  onClearCredentials,
  status,
  topics,
  messages,
  error,
  feeds,
}) {
  // Local form state — separate from the "active" credentials
  const [formUser, setFormUser] = useState(savedUsername)
  const [formKey, setFormKey] = useState(savedKey)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const isConnected = status === "connected"
  const isConnecting = status === "connecting"
  const hasCredentials = !!(savedUsername && savedKey)
  const formChanged = formUser !== savedUsername || formKey !== savedKey
  const canSubmit = !!(formUser.trim() && formKey.trim())

  function handleSaveConnect(e) {
    e.preventDefault()
    if (!canSubmit) return
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onSaveAndConnect(formUser.trim(), formKey.trim())
  }

  function handleClear() {
    setFormUser("")
    setFormKey("")
    onClearCredentials()
  }

  const inputStyle = {
    fontFamily: FONT_MONO,
    fontSize: 12,
    color: C.text,
    background: "#fff",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: "9px 12px",
    width: "100%",
    transition: "border-color .15s, box-shadow .15s",
  }

  const labelStyle = {
    fontFamily: FONT_MONO,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: C.textLt,
    marginBottom: 5,
    display: "block",
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 30,
            fontWeight: 700,
            color: C.brown,
          }}
        >
          Custom Subscriber
        </h1>
        <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>
          Live MQTT feed from Adafruit IO directly to this browser
        </p>
      </div>

      {/* No-credentials notice */}
      {!hasCredentials && (
        <div
          style={{
            animation: "slideDown .3s ease",
            marginBottom: 20,
            background: "#fff8ec",
            border: `1px solid #f0d090`,
            borderLeft: `4px solid ${C.amber}`,
            borderRadius: 10,
            padding: "14px 18px",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <span style={{ color: C.amber, marginTop: 1 }}>{Icon.key}</span>
          <div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                fontWeight: 600,
                color: C.amber,
                marginBottom: 4,
              }}
            >
              NO CREDENTIALS SAVED
            </div>
            <div
              style={{
                fontFamily: FONT_BODY,
                fontSize: 13,
                color: C.textMd,
                lineHeight: 1.6,
              }}
            >
              Enter your <strong>Adafruit IO username</strong> and{" "}
              <strong>AIO Key</strong> below and click{" "}
              <strong>Save &amp; Connect</strong>. Credentials are stored only
              in your browser and never sent anywhere else.
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(320px,480px) 1fr",
          gap: 16,
          marginBottom: 22,
          alignItems: "start",
        }}
      >
        {/* ── Credential Form ── */}
        <div
          style={{
            background: "#fff9f2",
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: "22px 24px",
            boxShadow: "0 1px 6px rgba(45,36,22,.06)",
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: C.textLt,
              marginBottom: 18,
            }}
          >
            Adafruit IO Credentials
          </div>

          <form onSubmit={handleSaveConnect}>
            {/* Username */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Username</label>
              <input
                type="text"
                value={formUser}
                onChange={(e) => setFormUser(e.target.value)}
                placeholder="your-adafruit-username"
                autoComplete="off"
                spellCheck={false}
                style={inputStyle}
                disabled={isConnecting}
              />
            </div>

            {/* AIO Key */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>AIO Key</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showKey ? "text" : "password"}
                  value={formKey}
                  onChange={(e) => setFormKey(e.target.value)}
                  placeholder="aio_xxxxxxxxxxxxxxxxxxxx"
                  autoComplete="off"
                  spellCheck={false}
                  style={{ ...inputStyle, paddingRight: 44 }}
                  disabled={isConnecting}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: C.textLt,
                    padding: 4,
                    lineHeight: 0,
                  }}
                >
                  {showKey ? (
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  color: C.textLt,
                  marginTop: 5,
                  lineHeight: 1.6,
                }}
              >
                Find your AIO Key at{" "}
                <a
                  href="https://io.adafruit.com/api/docs/#authentication"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: C.amber, textDecoration: "none" }}
                >
                  io.adafruit.com → My Key
                </a>
                . Stored in your browser only.
              </div>
            </div>

            {/* Feed list (read-only) */}
            <div style={{ marginBottom: 18 }}>
              <label style={labelStyle}>
                Subscribed Feeds ({feeds.length})
              </label>
              <div
                style={{
                  background: C.bg2,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                  maxHeight: 110,
                  overflowY: "auto",
                }}
              >
                {feeds.map((f) => (
                  <div
                    key={f}
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      color: C.textMd,
                      lineHeight: 1.9,
                    }}
                  >
                    {f}
                  </div>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {isConnected ? (
                <button
                  type="button"
                  onClick={onDisconnect}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: "#fff",
                    background: C.clay,
                    border: "1px solid #8f2f16",
                    borderRadius: 8,
                    padding: "8px 14px",
                    cursor: "pointer",
                    transition: "opacity .15s",
                  }}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canSubmit || isConnecting}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: canSubmit && !isConnecting ? "#fff" : "#b9a995",
                    background: saved
                      ? C.sage
                      : canSubmit && !isConnecting
                        ? C.amber
                        : C.bg3,
                    border: `1px solid ${saved ? "#3a5a28" : canSubmit && !isConnecting ? "#a05c10" : C.border}`,
                    borderRadius: 8,
                    padding: "8px 14px",
                    cursor:
                      canSubmit && !isConnecting ? "pointer" : "not-allowed",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "background .2s, border-color .2s",
                    minWidth: 130,
                  }}
                >
                  {isConnecting ? (
                    <>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          border: "1.5px solid #b9a995",
                          borderTopColor: "transparent",
                          borderRadius: "50%",
                          animation: "spin 1s linear infinite",
                          display: "inline-block",
                        }}
                      />
                      Connecting…
                    </>
                  ) : saved ? (
                    <>{Icon.check} Saved!</>
                  ) : (
                    <>{Icon.key} Save &amp; Connect</>
                  )}
                </button>
              )}

              {hasCredentials && !isConnected && !isConnecting && (
                <button
                  type="button"
                  onClick={handleClear}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: C.textLt,
                    background: "transparent",
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "8px 10px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    transition: "color .15s, border-color .15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = C.clay
                    e.currentTarget.style.borderColor = C.clay
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = C.textLt
                    e.currentTarget.style.borderColor = C.border
                  }}
                >
                  {Icon.trash} Clear
                </button>
              )}

              {/* Reconnect with saved creds if form unchanged */}
              {hasCredentials &&
                !isConnected &&
                !isConnecting &&
                !formChanged && (
                  <button
                    type="submit"
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: C.brownMd,
                      background: C.bg2,
                      border: `1px solid ${C.border}`,
                      borderRadius: 8,
                      padding: "8px 12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    {Icon.refresh} Reconnect
                  </button>
                )}
            </div>
          </form>

          {error && (
            <div
              style={{
                marginTop: 12,
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.clay,
                background: "#fae8e8",
                border: "1px solid #f0c0c0",
                borderRadius: 6,
                padding: "8px 10px",
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* ── Connection Status ── */}
        <div
          style={{
            background: "#fff9f2",
            border: `1px solid ${C.border}`,
            borderRadius: 16,
            padding: "22px 24px",
            boxShadow: "0 1px 6px rgba(45,36,22,.06)",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: C.textLt,
            }}
          >
            Connection Status
          </div>

          {/* Status indicator */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                flexShrink: 0,
                background: isConnected
                  ? C.sage
                  : isConnecting
                    ? C.amber
                    : C.clay,
                boxShadow: `0 0 8px ${isConnected ? C.sage : isConnecting ? C.amber : C.clay}`,
                animation: isConnecting ? "pulse 1s infinite" : undefined,
              }}
            />
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 13,
                fontWeight: 600,
                color: C.textMd,
              }}
            >
              {status.toUpperCase()}
            </span>
          </div>

          {/* Info grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 14,
              rowGap: 8,
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.textLt,
            }}
          >
            <div>Broker</div>
            <div
              style={{ color: C.textMd, wordBreak: "break-all", fontSize: 10 }}
            >
              {AIO_HOST}
            </div>

            <div>Account</div>
            <div style={{ color: C.textMd }}>
              {savedUsername ? (
                <span style={{ color: C.sage }}>{savedUsername}</span>
              ) : (
                <span style={{ color: C.textLt, fontStyle: "italic" }}>
                  not set
                </span>
              )}
            </div>

            <div>Topics</div>
            <div style={{ color: C.textMd }}>{topics.length || "—"}</div>

            <div>Messages</div>
            <div style={{ color: C.textMd }}>{messages.length}</div>

            <div>Last msg</div>
            <div style={{ color: C.textMd }}>{messages[0]?.time ?? "—"}</div>
          </div>

          <div
            style={{
              background: C.bg2,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontFamily: FONT_BODY,
              fontSize: 12,
              color: C.textMd,
              lineHeight: 1.6,
            }}
          >
            💡 Credentials are saved in <strong>your browser only</strong> via
            localStorage. No env vars or repo access required. Each team member
            can use their own Adafruit IO account.
          </div>
        </div>
      </div>

      {/* ── Live Feed Table ── */}
      <div
        style={{
          background: "#fff9f2",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 1px 6px rgba(45,36,22,.06)",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: C.textLt,
            }}
          >
            Live Feed
          </div>
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: isConnected ? C.sage : C.textLt,
            }}
          >
            {isConnected ? "● Subscribed" : "Not connected"}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  background: C.bg2,
                  borderBottom: `1px solid ${C.border}`,
                }}
              >
                {[
                  "Time",
                  "Feed",
                  "Node",
                  "Temp",
                  "Humidity",
                  "Raw Payload",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 10,
                      letterSpacing: 1.5,
                      textTransform: "uppercase",
                      color: C.textLt,
                      padding: "12px 16px",
                      textAlign: "left",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <Empty
                      text={
                        isConnected
                          ? "Waiting for MQTT messages…"
                          : "Connect above to see live data."
                      }
                    />
                  </td>
                </tr>
              ) : (
                messages.map((msg) => (
                  <tr
                    key={msg.id}
                    style={{ borderBottom: `1px solid ${C.bg3}` }}
                  >
                    <td
                      style={{
                        padding: "10px 16px",
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: C.textLt,
                      }}
                    >
                      {msg.time}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: C.textLt,
                      }}
                    >
                      {msg.feed}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        color: C.brown,
                      }}
                    >
                      {msg.parsed?.node_id || "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        color: C.amber,
                      }}
                    >
                      {msg.parsed?.temperature != null
                        ? `${fmt(msg.parsed.temperature)} °C`
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        fontFamily: FONT_MONO,
                        fontSize: 12,
                        color: C.sky,
                      }}
                    >
                      {msg.parsed?.humidity != null
                        ? `${fmt(msg.parsed.humidity)} %`
                        : "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 16px",
                        fontFamily: FONT_BODY,
                        fontSize: 12,
                        color: C.textMd,
                        maxWidth: 380,
                      }}
                    >
                      <div
                        style={{
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {msg.text || "—"}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── LOADER / EMPTY ───────────────────────────────────────────────────────────
function Loader({ text }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 20px",
        gap: 14,
        color: C.textLt,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: `2px solid ${C.border}`,
          borderTopColor: C.amber,
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      <span style={{ fontFamily: FONT_MONO, fontSize: 12 }}>{text}</span>
    </div>
  )
}

function Empty({ text }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 20px",
        gap: 8,
        color: C.textLt,
      }}
    >
      <svg
        width="32"
        height="32"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity=".4"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span style={{ fontFamily: FONT_MONO, fontSize: 12 }}>{text}</span>
    </div>
  )
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard")
  const [readings, setReadings] = useState([])
  const [readingsLoading, setReadingsLoading] = useState(true)
  const [readingsError, setReadingsError] = useState("")
  const [readingsReload, setReadingsReload] = useState(0)
  const [locationFilter, setLocationFilter] = useState("All Locations")
  const [analytics, setAnalytics] = useState(null)
  const [analyticsDays, setAnalyticsDays] = useState(7)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState("")
  const [analyticsReload, setAnalyticsReload] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [limit, setLimit] = useState(50)

  // The "active" credentials used by the MQTT client
  const [activeUsername, setActiveUsername] = useState(
    () => loadSavedCredentials().username
  )
  const [activeKey, setActiveKey] = useState(() => loadSavedCredentials().key)

  const [subscriberStatus, setSubscriberStatus] = useState("disconnected")
  const [subscriberError, setSubscriberError] = useState("")
  const [subscriberMessages, setSubscriberMessages] = useState([])

  const subscriberRef = useRef(null)
  const nodeMapRef = useRef({})

  const feedTopics = activeUsername
    ? FEED_KEYS.map((feed) => `${activeUsername}/feeds/${feed}`)
    : []

  // ── Disconnect ──────────────────────────────────────────────────────────────
  const disconnectSubscriber = useCallback(() => {
    if (subscriberRef.current) {
      subscriberRef.current.end(true)
      subscriberRef.current = null
    }
    setSubscriberStatus("disconnected")
  }, [])

  // ── Connect ─────────────────────────────────────────────────────────────────
  const connectSubscriber = useCallback(
    (username, key) => {
      const user = username ?? activeUsername
      const aioKey = key ?? activeKey

      if (!user || !aioKey) {
        setSubscriberError(
          "Enter your Adafruit IO username and key, then click Save & Connect."
        )
        return
      }

      if (subscriberRef.current) {
        subscriberRef.current.end(true)
        subscriberRef.current = null
      }

      setSubscriberError("")
      setSubscriberStatus("connecting")

      const topics = FEED_KEYS.map((feed) => `${user}/feeds/${feed}`)

      const client = mqtt.connect(AIO_HOST, {
        username: user,
        password: aioKey,
        clientId: `smart-web-${Math.random().toString(16).slice(2, 10)}`,
        keepalive: 30,
        reconnectPeriod: 0, // manual reconnect only
        connectTimeout: 8000,
        clean: true,
      })

      subscriberRef.current = client

      client.on("connect", () => {
        client.subscribe(topics, { qos: 0 }, (err) => {
          if (err) {
            setSubscriberError("Connected but failed to subscribe to feeds.")
            setSubscriberStatus("disconnected")
          } else {
            setSubscriberStatus("connected")
            setSubscriberError("")
          }
        })
      })

      client.on("message", (topic, payload) => {
        const feed = topic.split("/").slice(-1)[0] || ""
        const meta = parseFeedKey(feed)
        const { value, text } = parseAioValue(payload)
        if (!meta.nodeId || !meta.metric) return
        if (value == null) return

        const metricKey = meta.metric.includes("temp")
          ? "temperature"
          : "humidity"
        const nowMs = Date.now()

        const prevMap = nodeMapRef.current
        const prevNode = prevMap[meta.nodeId] || {
          node_id: meta.nodeId,
          location: meta.location,
        }
        const nextNodeBase = {
          ...prevNode,
          node_id: meta.nodeId,
          location: meta.location || prevNode.location,
          [metricKey]: value,
          lastTempText:
            metricKey === "temperature" ? text : prevNode.lastTempText,
          lastHumText: metricKey === "humidity" ? text : prevNode.lastHumText,
          lastTempAt: metricKey === "temperature" ? nowMs : prevNode.lastTempAt,
          lastHumAt: metricKey === "humidity" ? nowMs : prevNode.lastHumAt,
        }
        const lastEmitAt = prevNode.lastEmitAt ?? 0
        const hasTemp = nextNodeBase.temperature != null
        const hasHum = nextNodeBase.humidity != null
        const tempFresh =
          nextNodeBase.lastTempAt && nextNodeBase.lastTempAt > lastEmitAt
        const humFresh =
          nextNodeBase.lastHumAt && nextNodeBase.lastHumAt > lastEmitAt
        const shouldEmit = hasTemp && hasHum && tempFresh && humFresh

        if (shouldEmit) {
          const emitAt = Math.max(
            nextNodeBase.lastTempAt,
            nextNodeBase.lastHumAt
          )
          const timestamp = new Date(emitAt).toISOString()
          const nextNode = { ...nextNodeBase, lastEmitAt: emitAt, timestamp }
          nodeMapRef.current = { ...prevMap, [meta.nodeId]: nextNode }

          setReadings((prevReadings) => {
            const nextReading = {
              id: emitAt,
              node_id: nextNode.node_id,
              location: nextNode.location || "Unknown",
              temperature: nextNode.temperature ?? null,
              humidity: nextNode.humidity ?? null,
              timestamp: nextNode.timestamp,
            }
            return [nextReading, ...prevReadings].slice(0, Math.max(100, limit))
          })

          const combinedText = [nextNode.lastTempText, nextNode.lastHumText]
            .filter(Boolean)
            .join(" | ")
          setSubscriberMessages((prev) => {
            const parsed = {
              node_id: nextNode.node_id,
              temperature: nextNode.temperature,
              humidity: nextNode.humidity,
            }
            return [
              {
                id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                time: new Date().toLocaleTimeString("en-PH", { hour12: false }),
                feed,
                text: combinedText || text,
                parsed,
              },
              ...prev,
            ].slice(0, 50)
          })
        } else {
          nodeMapRef.current = { ...prevMap, [meta.nodeId]: nextNodeBase }
        }

        setLastUpdated(
          new Date().toLocaleTimeString("en-PH", { hour12: false })
        )
      })

      client.on("error", (err) => {
        const msg = err?.message || ""
        const isAuth =
          msg.toLowerCase().includes("not authorized") || msg.includes("4")
        setSubscriberError(
          isAuth
            ? "Authentication failed. Check your username and AIO Key."
            : `Connection error: ${msg || "Unknown error."}`
        )
        setSubscriberStatus("disconnected")
        client.end(true)
        subscriberRef.current = null
      })

      client.on("close", () => {
        if (subscriberRef.current === client) {
          setSubscriberStatus("disconnected")
          subscriberRef.current = null
        }
      })
    },
    [activeUsername, activeKey, limit]
  )

  // ── Save & Connect (called from SubscriberPage form) ─────────────────────
  const handleSaveAndConnect = useCallback(
    (username, key) => {
      saveCredentials(username, key)
      setActiveUsername(username)
      setActiveKey(key)
      disconnectSubscriber()
      // connectSubscriber with new values directly (state update is async)
      setTimeout(() => connectSubscriber(username, key), 50)
    },
    [disconnectSubscriber, connectSubscriber]
  )

  // ── Clear credentials ─────────────────────────────────────────────────────
  const handleClearCredentials = useCallback(() => {
    clearCredentials()
    setActiveUsername("")
    setActiveKey("")
    disconnectSubscriber()
    setSubscriberError("")
  }, [disconnectSubscriber])

  // ── Auto-connect on load if credentials exist ─────────────────────────────
  useEffect(() => {
    if (activeUsername && activeKey && subscriberStatus === "disconnected") {
      connectSubscriber(activeUsername, activeKey)
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Historical readings ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function loadHistoricalReadings() {
      setReadingsLoading(true)
      setReadingsError("")

      try {
        const logs = await fetchSupabaseReadings(Math.max(500, limit * 4))
        if (cancelled) return
        setReadings(logs)
        if (logs[0]?.timestamp) {
          setLastUpdated(fmtTimeShort(logs[0].timestamp))
        }
      } catch (error) {
        if (cancelled) return
        setReadings([])
        setReadingsError(
          error instanceof Error
            ? error.message
            : "Could not load Supabase readings."
        )
      } finally {
        if (!cancelled) setReadingsLoading(false)
      }
    }

    loadHistoricalReadings()
    return () => {
      cancelled = true
    }
  }, [limit, readingsReload])

  // ── Analytics ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function loadAnalytics() {
      setAnalyticsLoading(true)
      setAnalyticsError("")

      try {
        const logs = await fetchSupabaseLogs(analyticsDays)
        if (cancelled) return
        setAnalytics(buildAnalytics(logs, analyticsDays))
      } catch (error) {
        if (cancelled) return
        setAnalytics(null)
        setAnalyticsError(
          error instanceof Error
            ? error.message
            : "Could not load analytics data."
        )
      } finally {
        if (!cancelled) setAnalyticsLoading(false)
      }
    }

    loadAnalytics()
    return () => {
      cancelled = true
    }
  }, [analyticsDays, analyticsReload])

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => disconnectSubscriber(), [disconnectSubscriber])

  const mqttOnline = subscriberStatus === "connected"
  const hasCredentials = !!(activeUsername && activeKey)

  function normalizeLocation(s) {
    return (s || "").toString().trim().toLowerCase().replace(/_/g, " ")
  }

  const filteredReadings =
    locationFilter === "All Locations"
      ? readings
      : readings.filter(
          (r) =>
            normalizeLocation(r.location) === normalizeLocation(locationFilter)
        )

  const readingsLimited = filteredReadings.slice(0, limit)

  return (
    <>
      <style>{globalStyle}</style>
      <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
        <Sidebar
          activePage={page}
          setActivePage={setPage}
          isOnline={mqttOnline}
          lastUpdated={lastUpdated}
          hasCredentials={hasCredentials}
        />

        {/* Main content */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Top bar */}
          <div
            style={{
              padding: "16px 32px",
              borderBottom: `1px solid ${C.border}`,
              background: "#faf6ee",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.textLt,
                letterSpacing: 0.5,
              }}
            >
              {page === "dashboard"
                ? "// overview"
                : page === "nodes"
                  ? "// node status"
                  : page === "readings"
                    ? "// readings log"
                    : page === "analytics"
                      ? "// analytics"
                      : "// mqtt subscriber"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {!mqttOnline && (
                <button
                  onClick={() => setPage("subscriber")}
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: C.amber,
                    background: "#fff8ec",
                    border: "1px solid #f0d090",
                    borderRadius: 6,
                    padding: "3px 10px",
                    cursor: "pointer",
                    transition: "background .15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#fff0d0")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "#fff8ec")
                  }
                  title="Go to Custom Subscriber to connect"
                >
                  ⚠ MQTT disconnected —{" "}
                  {hasCredentials ? "reconnect?" : "set up credentials →"}
                </button>
              )}
              {mqttOnline && (
                <button
                  onClick={() => {
                    setReadingsReload((value) => value + 1)
                    setAnalyticsReload((value) => value + 1)
                    connectSubscriber(activeUsername, activeKey)
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    color: C.brownMd,
                    background: C.bg2,
                    border: `1px solid ${C.border}`,
                    borderRadius: 8,
                    padding: "6px 12px",
                    cursor: "pointer",
                    transition: "background .15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = C.bg3)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = C.bg2)
                  }
                >
                  {Icon.refresh} Refresh
                </button>
              )}
            </div>
          </div>

          {/* Page content */}
          <div style={{ flex: 1, padding: "32px", overflowY: "auto" }}>
            {readingsError && page !== "analytics" && page !== "subscriber" && (
              <div
                style={{
                  marginBottom: 16,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: C.clay,
                  background: "#fae8e8",
                  border: "1px solid #f0c0c0",
                  borderRadius: 8,
                  padding: "8px 10px",
                  width: "fit-content",
                }}
              >
                {readingsError}
              </div>
            )}
            {page === "dashboard" && (
              <DashboardPage readings={readingsLoading ? null : readings} />
            )}
            {page === "nodes" && (
              <NodesPage readings={readingsLoading ? null : readings} />
            )}
            {page === "readings" && (
              <ReadingsPage
                readings={readingsLoading ? null : readingsLimited}
                limit={limit}
                setLimit={setLimit}
                locationFilter={locationFilter}
                setLocationFilter={setLocationFilter}
              />
            )}
            {page === "analytics" && (
              <AnalyticsPage
                analytics={analytics}
                analyticsLoading={analyticsLoading}
                analyticsError={analyticsError}
                analyticsDays={analyticsDays}
                setAnalyticsDays={setAnalyticsDays}
                onRefresh={() => setAnalyticsReload((value) => value + 1)}
              />
            )}
            {page === "subscriber" && (
              <SubscriberPage
                savedUsername={activeUsername}
                savedKey={activeKey}
                onSaveAndConnect={handleSaveAndConnect}
                onDisconnect={disconnectSubscriber}
                onClearCredentials={handleClearCredentials}
                status={subscriberStatus}
                topics={feedTopics}
                messages={subscriberMessages}
                error={subscriberError}
                feeds={FEED_KEYS}
              />
            )}
          </div>
        </div>
      </div>
    </>
  )
}
