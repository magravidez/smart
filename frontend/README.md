# SMART Frontend

This frontend uses two live data paths:

- Custom Subscriber: direct MQTT over secure WebSockets to Adafruit IO for live browser monitoring.
- Analytics: direct Supabase REST queries against `sensor_logs` for long-term historical analysis.

## Requirements

- Node.js 18+
- Adafruit IO account with a feed (e.g., `smart_reading`)
- Supabase project with a `sensor_logs` table containing `id`, `temperature`, `humidity`, and `created_at`

## Local Development

```bash
cd frontend
npm install
npm run dev
```

Open the app, go to **Custom Subscriber**, and enter:

- Adafruit IO username
- Adafruit IO key
- Feed key

Click **Save Config** then **Connect**.

## Environment Variables

Analytics requires these Vite variables in [frontend/.env.example](c:/Users/MARIEL%20A.%20GRAVIDEZ/Documents/IoT%20Projects/SMART/smart/frontend/.env.example):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_TABLE` (optional, defaults to `sensor_logs`)

You can still prefill the subscriber form at build time with:

- `VITE_AIO_USERNAME`
- `VITE_AIO_KEY`
- `VITE_AIO_FEED`

## Analytics Coverage

The Analytics page now includes:

- Descriptive analytics: summary KPIs, comfort rate, volatility, and historical highlights
- Diagnostic analytics: correlation analysis and earlier-vs-recent comparisons
- Predictive analytics: next-bucket temperature and humidity forecast with risk notes

## GitHub Pages Deploy

This project is configured for GH Pages using `base: "/smart/"` in `vite.config.js`. If your repository name is different, set `VITE_BASE` when building, for example:

```bash
VITE_BASE=/your-repo-name/ npm run build
```

The repository includes a GitHub Actions workflow at `.github/workflows/deploy-frontend.yml` that builds and deploys `frontend/dist` automatically on pushes to `master`.

If you renamed the repository, update `VITE_BASE` in the workflow and/or `frontend/vite.config.js`.
