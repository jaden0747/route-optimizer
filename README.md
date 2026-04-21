# Route Optimizer

A browser-based delivery route planning tool. Paste or import customer addresses, set a hub, and the app automatically clusters stops into balanced shipper routes — factoring in travel time, wait time per stop, pricing, and delivery constraints.

---

## Features

- **Automatic clustering** — depot-aware k-means splits stops across shippers, minimising the slowest shipper's delivery time
- **Local-search optimisation** — relocate and swap moves balance routes; overloaded shippers are split or dissolved automatically
- **Time-aware scheduling** — configurable speed, max delivery time, and per-stop wait
- **Pricing** — flat base rate for first N km, then per-km beyond
- **Real road paths** — routes drawn on actual streets via OSRM (no key required)
- **Multi-provider geocoding** — OpenStreetMap (free), Goong (Vietnamese addresses), Google Maps
- **Geocode cache** — results stored in `localStorage`; re-clustering never re-requests known addresses
- **Address import formats**
  - Plain text: one address per line
  - Coords file: `address | latitude | longitude` (skips geocoding entirely)
- **Report export** — generates a PNG report with per-shipper routes, times, and costs

---

## Requirements

- **Node.js** ≥ 18 — https://nodejs.org
- **npm** ≥ 9 (bundled with Node.js)

---

## Quick start

### macOS / Linux

```bash
git clone <repo-url> route-optimizer
cd route-optimizer
bash bootstrap.sh
```

### Windows (PowerShell)

```powershell
git clone <repo-url> route-optimizer
cd route-optimizer
.\bootstrap.ps1
```

> If PowerShell blocks the script with an execution policy error, run this once first:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

### Manual (any platform)

```bash
npm install
npm run dev
```

Open the URL printed in the terminal (default: http://localhost:5173).

The bootstrap scripts do the same thing but also verify your Node.js version and handle clean vs fresh installs automatically.

---

## Build for production

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

To deploy: copy the `dist/` folder to any static host (Nginx, Caddy, GitHub Pages, Netlify, etc.).

---

## API keys

| Provider | Key required | Where to get one |
|---|---|---|
| OpenStreetMap (Nominatim) | No | — |
| Goong | Yes | https://account.goong.io |
| Google Maps | Yes | https://console.cloud.google.com |

Enter keys directly in the app — they are saved to `localStorage` and never sent anywhere except the respective geocoding API.

---

## Address file formats

**Plain text** (`Import` button) — one address per line:
```
1 Apple Park Way, Cupertino, CA
1600 Amphitheatre Parkway, Mountain View, CA
```

**Coords file** (`Import+Coords` button) — skips geocoding:
```
Bưu điện Trung tâm Sài Gòn | 10.7797 | 106.6990
Nhà thờ Đức Bà | 10.7797 | 106.6990
```

Sample files are in the `data/` directory.

---

## Delivery constraints (configurable in the app)

| Setting | Default | Description |
|---|---|---|
| Speed | 20 km/h | Average travel speed |
| Max time | 105 min | Maximum delivery time per shipper (1 h 45 m) |
| Wait/stop | 7 min | Time spent at each delivery stop |
| Max hub dist | 50 km | Stops farther than this are dropped (geocoding error guard) |

---

## Pricing model

```
price = basePrice + max(0, distance − baseKm) × extraPerKm
```

Defaults: 15,000 for first 2 km, then 5,000 per km beyond.

---

## Project structure

```
src/
  App.jsx                  # Main state, geocoding flow, clustering orchestration
  components/
    AddressInput.jsx       # Address list with inline editing
    ClusterMap.jsx         # Leaflet map — markers, polylines, depot icon
    ClusterSummary.jsx     # Sidebar summary — times, costs, per-shipper cards
  utils/
    clustering.js          # DBSCAN, k-means, nearest-neighbour TSP, local search
    geocode.js             # Multi-provider geocoding (Nominatim / Goong / Google)
    routing.js             # OSRM road-geometry fetcher
    report.js              # PNG / HTML report generator
data/
  address.txt              # Sample Vietnamese addresses (plain)
  address_osm.txt          # Sample addresses with coordinates
```

---

## Troubleshooting

**Only 1 cluster forms**
Goong sometimes returns wrong coordinates for ambiguous addresses. Check that *Max hub dist* is set (default 50 km) — stops outside that radius are automatically dropped and listed as errors.

**Geocoding fails**
- Nominatim: rate-limited to 1 req/s; the app handles this automatically.
- Goong / Google: verify the API key is correct and the Geocoding API is enabled for your project.

**Road lines not showing**
OSRM (`router.project-osrm.org`) is a free public server and may occasionally be unavailable. The app falls back to straight lines silently.
