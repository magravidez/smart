import { useState, useEffect, useCallback, useRef } from "react";
import mqtt from "mqtt";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

// ─── THEME ──────────────────────────────────────────────────────────────────
const C = {
  bg:       "#f5f0e8",
  bg2:      "#ede8dc",
  bg3:      "#e4ddd0",
  sidebar:  "#2d2416",
  sideText: "#c9b99a",
  sideMute: "#6b5c43",
  border:   "#d9d0c0",
  brown:    "#5c3d1e",
  brownMd:  "#8b6340",
  brownLt:  "#c4a882",
  amber:    "#c97c2a",
  sage:     "#5a7a4a",
  clay:     "#b05030",
  sky:      "#4a7fa5",
  text:     "#2d2416",
  textMd:   "#6b5c43",
  textLt:   "#a09070",
};

const FONT_DISPLAY = "'Playfair Display', Georgia, serif";
const FONT_MONO    = "'JetBrains Mono', 'Courier New', monospace";
const FONT_BODY    = "'DM Sans', sans-serif";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const AIO_DEFAULT = {
  username: import.meta.env.VITE_AIO_USERNAME || "",
  key: import.meta.env.VITE_AIO_KEY || "",
};
const AIO_HOST = "wss://io.adafruit.com:443/mqtt";
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
];

function fmt(n, d = 1) {
  return n != null ? (+n).toFixed(d) : "—";
}

function fmtTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-PH", {
    month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

function fmtTimeShort(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-PH", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

function fmtBucket(ts, mode) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (mode === "hour") {
    return d.toLocaleString("en-PH", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "2-digit",
  });
}

function getLatestPerNode(readings) {
  const map = {};
  readings.forEach(r => {
    if (!map[r.node_id] || new Date(r.timestamp) > new Date(map[r.node_id].timestamp)) {
      map[r.node_id] = r;
    }
  });
  return Object.values(map);
}

function safeParsePayload(payload) {
  const text = payload?.toString?.() ?? "";
  if (!text) return { text, parsed: null };
  try {
    const parsed = JSON.parse(text);
    return { text, parsed };
  } catch {
    return { text, parsed: null };
  }
}

function parseAioValue(payload) {
  const { text, parsed } = safeParsePayload(payload);
  if (typeof parsed === "number") return { value: parsed, text };
  if (parsed && typeof parsed === "object" && parsed.value != null) {
    const value = Number(parsed.value);
    return { value: Number.isFinite(value) ? value : null, text };
  }
  const value = Number.parseFloat(text);
  return { value: Number.isFinite(value) ? value : null, text };
}

function toTitleCase(input) {
  return input
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function parseFeedKey(feedKey) {
  const parts = feedKey.split("-");
  const metric = parts[parts.length - 1];
  const nodeIndex = parts.findIndex((p) => p === "node");
  const nodeNumber = parts[nodeIndex + 1] || "?";
  const locationParts = parts.slice(nodeIndex + 2, -1);
  return {
    nodeId: `NODE_${nodeNumber}`,
    location: toTitleCase(locationParts.join(" ")),
    metric,
  };
}

function buildAnalytics(readings, days) {
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;
  const filtered = readings.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  if (filtered.length === 0) {
    return {
      summary: { temperature: { avg: 0, min: 0, max: 0 }, humidity: { avg: 0, min: 0, max: 0 }, samples: 0 },
      range: { bucket: days <= 1 ? "hour" : "day" },
      series: [],
    };
  }

  const bucketMode = days <= 1 ? "hour" : "day";
  const buckets = new Map();
  filtered.forEach((r) => {
    const date = new Date(r.timestamp);
    const bucketStart = bucketMode === "hour"
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).toISOString()
      : new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString();
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, { temps: [], hums: [] });
    }
    const bucket = buckets.get(bucketStart);
    if (typeof r.temperature === "number") bucket.temps.push(r.temperature);
    if (typeof r.humidity === "number") bucket.hums.push(r.humidity);
  });

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
    }));

  const temps = filtered.map((r) => r.temperature).filter((v) => typeof v === "number");
  const hums = filtered.map((r) => r.humidity).filter((v) => typeof v === "number");

  const tempAvg = temps.length ? temps.reduce((s, v) => s + v, 0) / temps.length : 0;
  const humAvg = hums.length ? hums.reduce((s, v) => s + v, 0) / hums.length : 0;

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
    range: { bucket: bucketMode },
    series,
  };
}

function loadSubscriberConfig() {
  return AIO_DEFAULT;
}

// ─── ICONS ───────────────────────────────────────────────────────────────────
const Icon = {
  dashboard: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  nodes: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3"/><circle cx="12" cy="4" r="2"/><circle cx="20" cy="12" r="2"/>
      <circle cx="12" cy="20" r="2"/><circle cx="4" cy="12" r="2"/>
      <line x1="12" y1="7" x2="12" y2="9"/><line x1="15" y1="12" x2="18" y2="12"/>
      <line x1="12" y1="15" x2="12" y2="18"/><line x1="9" y1="12" x2="6" y2="12"/>
    </svg>
  ),
  readings: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/>
      <line x1="9" y1="16" x2="13" y2="16"/>
    </svg>
  ),
  analytics: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <polyline points="3 17 9 11 13 15 21 7" />
      <circle cx="3" cy="17" r="1.5" />
      <circle cx="9" cy="11" r="1.5" />
      <circle cx="13" cy="15" r="1.5" />
      <circle cx="21" cy="7" r="1.5" />
    </svg>
  ),
  temp: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/>
    </svg>
  ),
  humidity: (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/>
    </svg>
  ),
  location: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
  ),
  signal: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M1.42 9a16 16 0 0121.16 0"/><path d="M5 12.55a11 11 0 0114.08 0"/>
      <path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
    </svg>
  ),
  subscriber: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 12a8 8 0 0116 0"/>
      <path d="M7 12a5 5 0 0110 0"/>
      <path d="M10 12a2 2 0 014 0"/>
      <circle cx="12" cy="16" r="2"/>
    </svg>
  ),
  refresh: (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
    </svg>
  ),
};

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

  .fade-up { animation: fadeUp .5s ease both; }
  .fade-in { animation: fadeIn .4s ease both; }
  .new-row td { animation: flashRow 1.4s ease; }
`;

// ─── STAT CARD ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent, delay = 0, icon }) {
  return (
    <div className="fade-up" style={{
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
    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 16px rgba(45,36,22,.10)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(45,36,22,.06)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.textLt }}>
          {label}
        </span>
        <span style={{ color: accent, opacity: .7 }}>{icon}</span>
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 32, fontWeight: 700, color: accent, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: C.textLt }}>{sub}</div>
    </div>
  );
}

// ─── NODE CARD ────────────────────────────────────────────────────────────────
function NodeCard({ node, delay = 0 }) {
  return (
    <div className="fade-up" style={{
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
    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(45,36,22,.10)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(45,36,22,.06)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {/* Top row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <div style={{ fontFamily: FONT_MONO, fontWeight: 600, fontSize: 13, color: C.brown }}>{node.node_id}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3, color: C.textLt, fontSize: 11 }}>
            {Icon.location}
            {node.location.replace(/_/g, " ")}
          </div>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "#e8f0e0", border: "1px solid #b8d4a0",
          borderRadius: 100, padding: "3px 10px",
          fontSize: 10, fontFamily: FONT_MONO, color: C.sage,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.sage, animation: "pulse 2s infinite", display: "inline-block" }}/>
          LIVE
        </div>
      </div>

      {/* Readings */}
      <div style={{ display: "flex", gap: 14, alignItems: "stretch", justifyContent: "center" }}>
        <div style={{
          flex: "0 1 150px", background: "#fff3e6", border: `1px solid #f0d4b0`,
          borderRadius: 10, padding: "12px 16px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          minHeight: 82,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: C.amber, marginBottom: 4 }}>
            {Icon.temp}
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase" }}>Temp</span>
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: C.amber, lineHeight: 1, display: "flex", alignItems: "baseline", gap: 4 }}>
            {fmt(node.temperature)}<span style={{ fontSize: 14 }}>°C</span>
          </div>
        </div>
        <div style={{
          flex: "0 1 150px", background: "#e8f2fa", border: `1px solid #b0d0e8`,
          borderRadius: 10, padding: "12px 16px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
          minHeight: 82,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: C.sky, marginBottom: 4 }}>
            {Icon.humidity}
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase" }}>Humidity</span>
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: C.sky, lineHeight: 1, display: "flex", alignItems: "baseline", gap: 4 }}>
            {fmt(node.humidity)}<span style={{ fontSize: 14 }}>%</span>
          </div>
        </div>
      </div>

      {/* Timestamp */}
      <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textLt }}>
        Last reading · {fmtTime(node.timestamp)}
      </div>
    </div>
  );
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function Sidebar({ activePage, setActivePage, isOnline, lastUpdated }) {
  const navItems = [
    { id: "dashboard", label: "Dashboard",  icon: Icon.dashboard },
    { id: "nodes",     label: "Node Overview", icon: Icon.nodes },
    { id: "readings",  label: "All Readings",  icon: Icon.readings },
    { id: "analytics", label: "Analytics", icon: Icon.analytics },
    { id: "subscriber", label: "Custom Subscriber", icon: Icon.subscriber },
  ];

  return (
    <aside style={{
      width: 230, minHeight: "100vh", flexShrink: 0,
      background: C.sidebar,
      display: "flex", flexDirection: "column",
      padding: "28px 0",
      position: "sticky", top: 0, height: "100vh",
    }}>
      {/* Brand */}
      <div style={{ padding: "0 24px 28px" }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 700, color: "#f5f0e8", letterSpacing: 2 }}>
          SMART
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: C.sideMute, marginTop: 4, letterSpacing: 1, lineHeight: 1.6 }}>
          SMART FARM MONITOR
        </div>
      </div>

      {/* Status */}
      <div style={{ padding: "0 16px 24px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: isOnline ? "#1a2e10" : "#2e1010",
          border: `1px solid ${isOnline ? "#3a5a28" : "#5a2828"}`,
          borderRadius: 10, padding: "8px 12px",
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: isOnline ? C.sage : C.clay,
            boxShadow: `0 0 6px ${isOnline ? C.sage : C.clay}`,
            animation: "pulse 2s infinite", display: "inline-block", flexShrink: 0,
          }}/>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: isOnline ? "#90c870" : "#e07070" }}>
              {isOnline ? "NETWORK LIVE" : "OFFLINE"}
            </div>
            {lastUpdated && (
              <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: C.sideMute, marginTop: 2 }}>
                {lastUpdated}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: "#3d3020", margin: "0 0 12px" }}/>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "0 10px" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: C.sideMute, letterSpacing: 1.5, padding: "0 14px", marginBottom: 8 }}>
          NAVIGATION
        </div>
        {navItems.map(item => {
          const active = activePage === item.id;
          return (
            <button key={item.id}
              onClick={() => setActivePage(item.id)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", border: "none", borderRadius: 10, cursor: "pointer",
                background: active ? "#c97c2a22" : "transparent",
                color: active ? "#e8b870" : C.sideText,
                fontFamily: FONT_BODY, fontSize: 14, fontWeight: active ? 600 : 400,
                textAlign: "left", transition: "background .15s, color .15s",
                marginBottom: 2,
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = "#ffffff0d"; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ opacity: active ? 1 : .6 }}>{item.icon}</span>
              {item.label}
              {active && <span style={{ marginLeft: "auto", width: 4, height: 4, borderRadius: "50%", background: "#e8b870" }}/>}
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ padding: "16px 24px 0", borderTop: "1px solid #3d3020" }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 9, color: C.sideMute, lineHeight: 1.8 }}>
          Star Topology · IIoT<br/>
          Edge Computing · Poll 5s
        </div>
      </div>
    </aside>
  );
}

function TrendCard({ title, color, series, keyName, bucketMode, unit }) {
  return (
    <div style={{
      background: "#fff9f2",
      border: `1px solid ${C.border}`,
      borderRadius: 16,
      padding: "16px 16px 10px",
      boxShadow: "0 1px 6px rgba(45,36,22,.06)",
      minHeight: 300,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.textLt }}>
          {title}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 10, color }}>
          {series.length} buckets
        </div>
      </div>
      <div style={{ width: "100%", height: 250 }}>
        <ResponsiveContainer>
          <LineChart data={series} margin={{ top: 14, right: 10, left: 0, bottom: 8 }}>
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
  );
}

function AnalyticsPage({
  analytics,
  analyticsLoading,
  analyticsError,
  analyticsDays,
  setAnalyticsDays,
  onRefresh,
}) {
  if (analyticsLoading && !analytics) return <Loader text="Loading analytics..." />;

  return (
    <div className="fade-in">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, color: C.brown }}>Analytics</h1>
          <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>Temperature and humidity trends with summary stats</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select value={analyticsDays} onChange={(e) => setAnalyticsDays(+e.target.value)} style={{
            fontFamily: FONT_MONO, fontSize: 12,
            background: "#fff9f2", color: C.brown,
            border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "8px 14px", cursor: "pointer", outline: "none",
          }}>
            <option value={1}>Last 24 Hours</option>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
          </select>
          <button onClick={onRefresh} style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: FONT_MONO, fontSize: 11, color: C.brownMd,
            background: C.bg2, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "7px 12px", cursor: "pointer",
          }}>
            {Icon.refresh} Refresh
          </button>
        </div>
      </div>

      {analyticsError && (
        <div style={{
          marginBottom: 16,
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: C.clay,
          background: "#fae8e8",
          border: "1px solid #f0c0c0",
          borderRadius: 8,
          padding: "8px 10px",
          width: "fit-content",
        }}>
          Could not load analytics data.
        </div>
      )}

      {!analytics || analytics.summary.samples === 0 ? (
        <Empty text="No analytics data in this time range." />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 14, marginBottom: 24 }}>
            <StatCard label="Avg Temp" value={`${fmt(analytics.summary.temperature.avg)}°C`} sub="selected range" accent={C.amber} icon={Icon.temp} />
            <StatCard label="Min Temp" value={`${fmt(analytics.summary.temperature.min)}°C`} sub="selected range" accent={C.brownMd} icon={Icon.temp} />
            <StatCard label="Max Temp" value={`${fmt(analytics.summary.temperature.max)}°C`} sub="selected range" accent={C.clay} icon={Icon.temp} />
            <StatCard label="Avg Humidity" value={`${fmt(analytics.summary.humidity.avg)}%`} sub="selected range" accent={C.sky} icon={Icon.humidity} />
            <StatCard label="Samples" value={analytics.summary.samples} sub={`${analytics.range.bucket} buckets`} accent={C.sage} icon={Icon.readings} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
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
        </>
      )}
    </div>
  );
}

// ─── PAGE: DASHBOARD ──────────────────────────────────────────────────────────
function DashboardPage({ readings }) {
  if (!readings) return <Loader text="Loading dashboard…" />;

  const nodes    = new Set(readings.map(r => r.node_id)).size;
  const avgTemp  = readings.length ? readings.reduce((s, r) => s + +r.temperature, 0) / readings.length : 0;
  const avgHum   = readings.length ? readings.reduce((s, r) => s + +r.humidity,    0) / readings.length : 0;
  const nodeList = getLatestPerNode(readings);

  return (
    <div className="fade-in">
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, color: C.brown }}>
          Farm Overview
        </h1>
        <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>
          Real-time monitoring across all sensor nodes
        </p>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard label="Total Readings" value={readings.length} sub="all nodes combined" accent={C.brown} delay={0} icon={Icon.readings} />
        <StatCard label="Active Nodes"   value={nodes}           sub="transmitting data"  accent={C.sage}  delay={.07} icon={Icon.signal} />
        <StatCard label="Avg Temperature" value={`${fmt(avgTemp)}°C`} sub="network average" accent={C.amber} delay={.14} icon={Icon.temp} />
        <StatCard label="Avg Humidity"    value={`${fmt(avgHum)}%`}   sub="network average" accent={C.sky}   delay={.21} icon={Icon.humidity} />
      </div>

      {/* Node cards */}
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", color: C.textLt, marginBottom: 14 }}>
          Latest per Node
        </h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
          gap: 16,
          alignItems: "stretch",
          gridAutoRows: "1fr",
        }}>
          {nodeList.map((n, i) => <NodeCard key={n.node_id} node={n} delay={i * .07} />)}
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: NODES ──────────────────────────────────────────────────────────────
function NodesPage({ readings }) {
  if (!readings) return <Loader text="Loading nodes…" />;
  const nodeList = getLatestPerNode(readings);

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, color: C.brown }}>Node Overview</h1>
        <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>Latest reading from each sensor node</p>
      </div>
      {nodeList.length === 0
        ? <Empty text="No nodes transmitting yet." />
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 18 }}>
            {nodeList.map((n, i) => <NodeCard key={n.node_id} node={n} delay={i * .08} />)}
          </div>
        )}
    </div>
  );
}

// ─── PAGE: READINGS ───────────────────────────────────────────────────────────
function ReadingsPage({ readings, limit, setLimit, locationFilter, setLocationFilter }) {
  const [prevFirstId, setPrevFirstId] = useState(null);
  const [newId, setNewId] = useState(null);

  useEffect(() => {
    if (!readings || readings.length === 0) return;
    const first = readings[0]?.id;
    if (prevFirstId !== null && first !== prevFirstId) setNewId(first);
    setPrevFirstId(first);
  }, [readings]);

  if (!readings) return <Loader text="Loading readings…" />;

  return (
    <div className="fade-in">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, color: C.brown }}>All Readings</h1>
          <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>Sensor data log, latest first</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)} style={{
            fontFamily: FONT_MONO, fontSize: 12,
            background: "#fff9f2", color: C.brown,
            border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "8px 14px", paddingRight: 20, cursor: "pointer", outline: "none",
            marginTop: 6,
          }}>
            <option>All Locations</option>
            <option>Rhundei City</option>
            <option>Mariel City</option>
            <option>Christian City</option>
            <option>Nichole City</option>
            <option>Kloie City</option>
          </select>

          <select value={limit} onChange={e => setLimit(+e.target.value)} style={{
            fontFamily: FONT_MONO, fontSize: 12,
            background: "#fff9f2", color: C.brown,
            border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "8px 14px", paddingRight: 20, cursor: "pointer", outline: "none",
            marginTop: 6,
          }}>
            <option value={20}>Last 20</option>
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
          </select>
        </div>
      </div>

      <div style={{
        background: "#fff9f2",
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 1px 6px rgba(45,36,22,.06)",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg2, borderBottom: `1px solid ${C.border}` }}>
                {["#", "Node ID", "Location", "Temp (°C)", "Humidity (%)", "Timestamp"].map(h => (
                  <th key={h} style={{
                    fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 1.5,
                    textTransform: "uppercase", color: C.textLt,
                    padding: "12px 18px", textAlign: "left", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {readings.length === 0
                ? (
                  <tr><td colSpan={6}><Empty text="No readings found." /></td></tr>
                )
                : readings.map((r, i) => (
                  <tr key={r.id}
                    className={r.id === newId ? "new-row" : ""}
                    style={{
                      borderBottom: i < readings.length - 1 ? `1px solid ${C.bg3}` : "none",
                      transition: "background .15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f5ede0"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <td style={{ padding: "11px 18px", fontFamily: FONT_MONO, fontSize: 11, color: C.textLt }}>{r.id}</td>
                    <td style={{ padding: "11px 18px", fontFamily: FONT_MONO, fontWeight: 600, fontSize: 12, color: C.brown }}>{r.node_id}</td>
                    <td style={{ padding: "11px 18px" }}>
                      <span style={{
                        background: C.bg3, border: `1px solid ${C.border}`,
                        borderRadius: 6, padding: "2px 9px",
                        fontFamily: FONT_MONO, fontSize: 11, color: C.brownMd,
                      }}>{r.location.replace(/_/g, " ")}</span>
                    </td>
                    <td style={{ padding: "11px 18px", fontFamily: FONT_MONO, fontWeight: 600, fontSize: 13, color: C.amber }}>{fmt(r.temperature)} °C</td>
                    <td style={{ padding: "11px 18px", fontFamily: FONT_MONO, fontWeight: 600, fontSize: 13, color: C.sky }}>{fmt(r.humidity)} %</td>
                    <td style={{ padding: "11px 18px", fontFamily: FONT_MONO, fontSize: 11, color: C.textLt }}>{fmtTime(r.timestamp)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: CUSTOM SUBSCRIBER ────────────────────────────────────────────────
function SubscriberPage({
  config,
  status,
  topics,
  messages,
  error,
  feeds,
  onConnect,
  onDisconnect,
}) {
  const canConnect = !!(config.username && config.key);
  const maskedKey = config.key ? `${config.key.slice(0, 6)}...${config.key.slice(-4)}` : "—";

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 700, color: C.brown }}>Custom Subscriber</h1>
        <p style={{ color: C.textMd, fontSize: 14, marginTop: 4 }}>
          Live MQTT feed from Adafruit IO (broker) to this web client
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16, marginBottom: 22 }}>
        <div style={{
          background: "#fff9f2",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: "16px 18px",
          boxShadow: "0 1px 6px rgba(45,36,22,.06)",
        }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.textLt, marginBottom: 10 }}>
            Adafruit IO MQTT Config
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textLt }}>Username</span>
              <div style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.textMd,
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "8px 10px",
              }}>
                {config.username || "—"}
              </div>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textLt }}>AIO Key</span>
              <div style={{
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.textMd,
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "8px 10px",
              }}>
                {maskedKey}
              </div>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textLt }}>Feed Keys</span>
              <div style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.textMd,
                background: "#fff",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                padding: "8px 10px",
                lineHeight: 1.6,
              }}>
                {feeds.map((feed) => (
                  <div key={feed}>{feed}</div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            {status === "connected" ? (
              <button
                onClick={onDisconnect}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: "#fff",
                  background: C.clay,
                  border: "1px solid #8f2f16",
                  borderRadius: 8,
                  padding: "7px 12px",
                  cursor: "pointer",
                }}
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={onConnect}
                disabled={!canConnect}
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: canConnect ? "#fff" : "#b9a995",
                  background: canConnect ? C.sage : C.bg3,
                  border: `1px solid ${canConnect ? "#3a5a28" : C.border}`,
                  borderRadius: 8,
                  padding: "7px 12px",
                  cursor: canConnect ? "pointer" : "not-allowed",
                }}
              >
                Connect
              </button>
            )}
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textLt }}>
              Topics: {topics.length ? topics.length : "—"}
            </span>
          </div>
          {error && (
            <div style={{
              marginTop: 10,
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.clay,
              background: "#fae8e8",
              border: "1px solid #f0c0c0",
              borderRadius: 6,
              padding: "6px 8px",
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          background: "#fff9f2",
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: "12px 14px",
          boxShadow: "0 1px 6px rgba(45,36,22,.06)",
          display: "grid",
          gap: 8,
          alignSelf: "start",
          width: "max-content",
        }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.textLt }}>
            Connection Status
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: status === "connected" ? C.sage : status === "connecting" ? C.amber : C.clay,
              boxShadow: `0 0 6px ${status === "connected" ? C.sage : status === "connecting" ? C.amber : C.clay}`,
            }} />
            <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.textMd }}>
              {status.toUpperCase()}
            </span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 10,
            rowGap: 4,
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.textLt,
            alignItems: "center",
          }}>
            <div style={{ opacity: 0.8 }}>Broker</div>
            <div style={{ color: C.textMd, wordBreak: "break-all" }}>{AIO_HOST}</div>

            <div style={{ opacity: 0.8 }}>Messages</div>
            <div style={{ color: C.textMd }}>{messages.length}</div>

            <div style={{ opacity: 0.8 }}>Last</div>
            <div style={{ color: C.textMd }}>{messages[0]?.time ?? "—"}</div>
          </div>
          <div style={{
            marginTop: 6,
            fontFamily: FONT_BODY,
            fontSize: 13,
            color: C.textMd,
            lineHeight: 1.5,
          }}>
            This subscriber uses MQTT over WebSockets to connect directly to Adafruit IO.
          </div>
        </div>
      </div>

      <div style={{
        background: "#fff9f2",
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 1px 6px rgba(45,36,22,.06)",
      }}>
        <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", color: C.textLt }}>
            Live Feed
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 10, color: C.textLt }}>{topics.length ? "Subscribed" : "Not connected"}</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.bg2, borderBottom: `1px solid ${C.border}` }}>
                {["Time", "Feed", "Node", "Temp", "Humidity", "Raw Payload"].map(h => (
                  <th key={h} style={{
                    fontFamily: FONT_MONO, fontSize: 10, letterSpacing: 1.5,
                    textTransform: "uppercase", color: C.textLt,
                    padding: "12px 16px", textAlign: "left", whiteSpace: "nowrap",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr><td colSpan={6}><Empty text="No MQTT messages yet." /></td></tr>
              ) : messages.map(msg => (
                <tr key={msg.id} style={{ borderBottom: `1px solid ${C.bg3}` }}>
                  <td style={{ padding: "10px 16px", fontFamily: FONT_MONO, fontSize: 11, color: C.textLt }}>{msg.time}</td>
                  <td style={{ padding: "10px 16px", fontFamily: FONT_MONO, fontSize: 11, color: C.textLt }}>{msg.feed}</td>
                  <td style={{ padding: "10px 16px", fontFamily: FONT_MONO, fontSize: 12, color: C.brown }}>
                    {msg.parsed?.node_id || "—"}
                  </td>
                  <td style={{ padding: "10px 16px", fontFamily: FONT_MONO, fontSize: 12, color: C.amber }}>
                    {msg.parsed?.temperature != null ? `${fmt(msg.parsed.temperature)} °C` : "—"}
                  </td>
                  <td style={{ padding: "10px 16px", fontFamily: FONT_MONO, fontSize: 12, color: C.sky }}>
                    {msg.parsed?.humidity != null ? `${fmt(msg.parsed.humidity)} %` : "—"}
                  </td>
                  <td style={{ padding: "10px 16px", fontFamily: FONT_BODY, fontSize: 12, color: C.textMd, maxWidth: 380 }}>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {msg.text || "—"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── LOADER / EMPTY ───────────────────────────────────────────────────────────
function Loader({ text }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 20px", gap: 14, color: C.textLt }}>
      <div style={{ width: 28, height: 28, border: `2px solid ${C.border}`, borderTopColor: C.amber, borderRadius: "50%", animation: "spin 1s linear infinite" }}/>
      <span style={{ fontFamily: FONT_MONO, fontSize: 12 }}>{text}</span>
    </div>
  );
}

function Empty({ text }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", gap: 8, color: C.textLt }}>
      <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.2" opacity=".4">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span style={{ fontFamily: FONT_MONO, fontSize: 12 }}>{text}</span>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]         = useState("dashboard");
  const [readings, setReadings] = useState([]);
  const [locationFilter, setLocationFilter] = useState("All Locations");
  const [analytics, setAnalytics] = useState(null);
  const [analyticsDays, setAnalyticsDays] = useState(7);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [limit, setLimit]       = useState(50);
  const [subscriberConfig] = useState(loadSubscriberConfig);
  const [subscriberStatus, setSubscriberStatus] = useState("disconnected");
  const [subscriberError, setSubscriberError] = useState("");
  const [subscriberMessages, setSubscriberMessages] = useState([]);
  const subscriberRef = useRef(null);
  const nodeMapRef = useRef({});

  const feedTopics = subscriberConfig.username
    ? FEED_KEYS.map((feed) => `${subscriberConfig.username}/feeds/${feed}`)
    : [];

  const disconnectSubscriber = useCallback(() => {
    if (subscriberRef.current) {
      subscriberRef.current.end(true);
      subscriberRef.current = null;
    }
    setSubscriberStatus("disconnected");
  }, []);

  const connectSubscriber = useCallback(() => {
    if (!subscriberConfig.username || !subscriberConfig.key) {
      setSubscriberError("Missing Adafruit IO credentials. Set VITE_AIO_USERNAME and VITE_AIO_KEY.");
      return;
    }

    if (subscriberRef.current) return;

    setSubscriberError("");
    setSubscriberStatus("connecting");

    const client = mqtt.connect(AIO_HOST, {
      username: subscriberConfig.username,
      password: subscriberConfig.key,
      clientId: `smart-web-${Math.random().toString(16).slice(2, 10)}`,
      keepalive: 30,
      reconnectPeriod: 2000,
      connectTimeout: 8000,
      clean: true,
    });

    subscriberRef.current = client;

    client.on("connect", () => {
      client.subscribe(feedTopics, { qos: 0 }, (err) => {
        if (err) {
          setSubscriberError("Failed to subscribe to feeds.");
          setSubscriberStatus("disconnected");
        } else {
          setSubscriberStatus("connected");
        }
      });
    });

    client.on("message", (topic, payload) => {
      const feed = topic.split("/").slice(-1)[0] || "";
      const meta = parseFeedKey(feed);
      const { value, text } = parseAioValue(payload);
      if (!meta.nodeId || !meta.metric) return;
      if (value == null) return;

      const metricKey = meta.metric.includes("temp") ? "temperature" : "humidity";
      const nowMs = Date.now();

      const prevMap = nodeMapRef.current;
      const prevNode = prevMap[meta.nodeId] || { node_id: meta.nodeId, location: meta.location };
      const nextNodeBase = {
        ...prevNode,
        node_id: meta.nodeId,
        location: meta.location || prevNode.location,
        [metricKey]: value,
        lastTempText: metricKey === "temperature" ? text : prevNode.lastTempText,
        lastHumText: metricKey === "humidity" ? text : prevNode.lastHumText,
        lastTempAt: metricKey === "temperature" ? nowMs : prevNode.lastTempAt,
        lastHumAt: metricKey === "humidity" ? nowMs : prevNode.lastHumAt,
      };
      const lastEmitAt = prevNode.lastEmitAt ?? 0;
      const hasTemp = nextNodeBase.temperature != null;
      const hasHum = nextNodeBase.humidity != null;
      const tempFresh = nextNodeBase.lastTempAt && nextNodeBase.lastTempAt > lastEmitAt;
      const humFresh = nextNodeBase.lastHumAt && nextNodeBase.lastHumAt > lastEmitAt;
      const shouldEmit = hasTemp && hasHum && tempFresh && humFresh;

      if (shouldEmit) {
        const emitAt = Math.max(nextNodeBase.lastTempAt, nextNodeBase.lastHumAt);
        const timestamp = new Date(emitAt).toISOString();
        const nextNode = { ...nextNodeBase, lastEmitAt: emitAt, timestamp };
        nodeMapRef.current = { ...prevMap, [meta.nodeId]: nextNode };

        setReadings((prevReadings) => {
          const nextReading = {
            id: emitAt,
            node_id: nextNode.node_id,
            location: nextNode.location || "Unknown",
            temperature: nextNode.temperature ?? null,
            humidity: nextNode.humidity ?? null,
            timestamp: nextNode.timestamp,
          };
          const updated = [nextReading, ...prevReadings];
          return updated.slice(0, Math.max(100, limit));
        });

        const combinedText = [nextNode.lastTempText, nextNode.lastHumText].filter(Boolean).join(" | ");
        setSubscriberMessages((prev) => {
          const parsed = {
            node_id: nextNode.node_id,
            temperature: nextNode.temperature,
            humidity: nextNode.humidity,
          };
          const next = [{
            id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            time: new Date().toLocaleTimeString("en-PH", { hour12: false }),
            feed,
            text: combinedText || text,
            parsed,
          }, ...prev];
          return next.slice(0, 50);
        });
      } else {
        nodeMapRef.current = { ...prevMap, [meta.nodeId]: nextNodeBase };
      }

      setLastUpdated(new Date().toLocaleTimeString("en-PH", { hour12: false }));
    });

    client.on("error", (err) => {
      setSubscriberError(err?.message || "MQTT connection error.");
      setSubscriberStatus("disconnected");
      client.end(true);
      subscriberRef.current = null;
    });

    client.on("close", () => {
      setSubscriberStatus("disconnected");
      subscriberRef.current = null;
    });
  }, [subscriberConfig, feedTopics, limit]);


  useEffect(() => {
    setAnalytics(buildAnalytics(readings, analyticsDays));
  }, [readings, analyticsDays]);

  useEffect(() => () => disconnectSubscriber(), [disconnectSubscriber]);

  useEffect(() => {
    if (subscriberStatus === "connected" || subscriberStatus === "connecting") return;
    if (!subscriberConfig.username || !subscriberConfig.key) return;
    connectSubscriber();
  }, [subscriberConfig, subscriberStatus, connectSubscriber]);

  const mqttOnline = subscriberStatus === "connected";
  function normalizeLocation(s) {
    return (s || "").toString().trim().toLowerCase().replace(/_/g, " ");
  }

  const filteredReadings = locationFilter === "All Locations"
    ? readings
    : readings.filter(r => normalizeLocation(r.location) === normalizeLocation(locationFilter));

  const readingsLimited = filteredReadings.slice(0, limit);

  return (
    <>
      <style>{globalStyle}</style>
      <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
        <Sidebar activePage={page} setActivePage={setPage} isOnline={mqttOnline} lastUpdated={lastUpdated} />

        {/* Main content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Top bar */}
          <div style={{
            padding: "16px 32px",
            borderBottom: `1px solid ${C.border}`,
            background: "#faf6ee",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.textLt, letterSpacing: .5 }}>
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
                <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.clay, background: "#fae8e8", border: "1px solid #f0c0c0", borderRadius: 6, padding: "3px 10px" }}>
                  ⚠ MQTT disconnected
                </span>
              )}
              <button onClick={connectSubscriber} style={{
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: FONT_MONO, fontSize: 11, color: C.brownMd,
                background: C.bg2, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                transition: "background .15s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = C.bg3}
              onMouseLeave={e => e.currentTarget.style.background = C.bg2}
              >
                {Icon.refresh} Refresh
              </button>
            </div>
          </div>

          {/* Page content */}
          <div style={{ flex: 1, padding: "32px", overflowY: "auto" }}>
            {page === "dashboard" && <DashboardPage readings={readings} />}
            {page === "nodes"     && <NodesPage readings={readings} />}
            {page === "readings"  && (
              <ReadingsPage
                readings={readingsLimited}
                limit={limit}
                setLimit={setLimit}
                locationFilter={locationFilter}
                setLocationFilter={setLocationFilter}
              />
            )}
            {page === "analytics" && (
              <AnalyticsPage
                analytics={analytics}
                analyticsLoading={false}
                analyticsError={false}
                analyticsDays={analyticsDays}
                setAnalyticsDays={setAnalyticsDays}
                onRefresh={() => setAnalytics(buildAnalytics(readings, analyticsDays))}
              />
            )}
            {page === "subscriber" && (
              <SubscriberPage
                config={subscriberConfig}
                status={subscriberStatus}
                topics={feedTopics}
                messages={subscriberMessages}
                error={subscriberError}
                feeds={FEED_KEYS}
                onConnect={connectSubscriber}
                onDisconnect={disconnectSubscriber}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
