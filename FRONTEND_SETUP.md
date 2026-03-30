# SMART Dashboard — React Setup

## Quick Start

### 1. Create a React app

```bash
npm create vite@latest smart-frontend -- --template react
cd smart-frontend
npm install
```

### 2. Replace `src/App.jsx`

Copy `SmartDashboard.jsx` into the project and replace `src/App.jsx` with it:

```bash
cp SmartDashboard.jsx src/App.jsx
```

### 3. Clean up `src/index.css`

Replace the contents of `src/index.css` with just:

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #f5f0e8; }
```

### 4. Run

Make sure your backend is running on `http://localhost:3000`, then:

```bash
npm run dev
```

Visit `http://localhost:5173` in your browser.

---

## Pages

| Page | Description |
|------|-------------|
| Dashboard | Stat cards + latest reading per node |
| Node Overview | Full node cards for each sensor |
| All Readings | Paginated table with limit selector |

## Features
- Polls `/api/readings` every 5 seconds automatically
- Live/Offline status in the sidebar
- New row highlights in amber when fresh data arrives
- Manual refresh button in top bar
- Warm beige / earthy light color theme
