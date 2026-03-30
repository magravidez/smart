import { useState, useEffect, useCallback } from "react";

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
const API_BASE = "http://localhost:3000";

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

function getLatestPerNode(readings) {
  const map = {};
  readings.forEach(r => {
    if (!map[r.node_id] || new Date(r.timestamp) > new Date(map[r.node_id].timestamp)) {
      map[r.node_id] = r;
    }
  });
  return Object.values(map);
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
      padding: "18px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      boxShadow: "0 1px 4px rgba(45,36,22,.06)",
      transition: "box-shadow .2s, transform .2s",
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 4px 14px rgba(45,36,22,.10)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 1px 4px rgba(45,36,22,.06)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {/* Top row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
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
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{
          flex: 1, background: "#fff3e6", border: `1px solid #f0d4b0`,
          borderRadius: 10, padding: "10px 14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: C.amber, marginBottom: 4 }}>
            {Icon.temp}
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase" }}>Temp</span>
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, color: C.amber, lineHeight: 1 }}>
            {fmt(node.temperature)}<span style={{ fontSize: 14 }}>°C</span>
          </div>
        </div>
        <div style={{
          flex: 1, background: "#e8f2fa", border: `1px solid #b0d0e8`,
          borderRadius: 10, padding: "10px 14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: C.sky, marginBottom: 4 }}>
            {Icon.humidity}
            <span style={{ fontFamily: FONT_MONO, fontSize: 9, letterSpacing: 1.2, textTransform: "uppercase" }}>Humidity</span>
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, color: C.sky, lineHeight: 1 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
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
function ReadingsPage({ readings, limit, setLimit }) {
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
        <select value={limit} onChange={e => setLimit(+e.target.value)} style={{
          fontFamily: FONT_MONO, fontSize: 12,
          background: "#fff9f2", color: C.brown,
          border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "8px 14px", cursor: "pointer", outline: "none",
          marginTop: 6,
        }}>
          <option value={20}>Last 20</option>
          <option value={50}>Last 50</option>
          <option value={100}>Last 100</option>
        </select>
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
  const [readings, setReadings] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError]       = useState(false);
  const [limit, setLimit]       = useState(50);

  const fetchReadings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/readings?limit=${limit}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReadings(data);
      setIsOnline(true);
      setError(false);
      setLastUpdated(new Date().toLocaleTimeString("en-PH", { hour12: false }));
    } catch {
      setIsOnline(false);
      setError(true);
    }
  }, [limit]);

  useEffect(() => {
    fetchReadings();
    const id = setInterval(fetchReadings, 5000);
    return () => clearInterval(id);
  }, [fetchReadings]);

  return (
    <>
      <style>{globalStyle}</style>
      <div style={{ display: "flex", minHeight: "100vh", background: C.bg }}>
        <Sidebar activePage={page} setActivePage={setPage} isOnline={isOnline} lastUpdated={lastUpdated} />

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
              {page === "dashboard" ? "// overview" : page === "nodes" ? "// node status" : "// readings log"}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {error && (
                <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.clay, background: "#fae8e8", border: "1px solid #f0c0c0", borderRadius: 6, padding: "3px 10px" }}>
                  ⚠ Cannot reach backend
                </span>
              )}
              <button onClick={fetchReadings} style={{
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
            {page === "readings"  && <ReadingsPage readings={readings} limit={limit} setLimit={setLimit} />}
          </div>
        </div>
      </div>
    </>
  );
}
