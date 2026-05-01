# SMART Frontend (Custom MQTT Subscriber)

This frontend includes a custom MQTT subscriber that connects directly to Adafruit IO over WebSockets and renders the live feed in the UI.

## Requirements

- Node.js 18+
- Adafruit IO account with a feed (e.g., `smart_reading`)

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

## Optional Environment Variables

You can prefill the subscriber form by adding these at build time:

- `VITE_AIO_USERNAME`
- `VITE_AIO_KEY`
- `VITE_AIO_FEED`

## GitHub Pages Deploy

This project is configured for GH Pages using `base: "/smart/"` in `vite.config.js`. If your repository name is different, set `VITE_BASE` when building, for example:

```bash
VITE_BASE=/your-repo-name/ npm run build
```

The repository includes a GitHub Actions workflow at `.github/workflows/deploy-frontend.yml` that builds and deploys `frontend/dist` automatically on pushes to `master`.

If you renamed the repository, update `VITE_BASE` in the workflow and/or `frontend/vite.config.js`.