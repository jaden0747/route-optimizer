import { useEffect, Fragment } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#34495e', '#e91e63', '#00bcd4',
];

function createStopIcon(color, stopNumber) {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};
      border:2.5px solid white;
      border-radius:50%;
      width:28px;height:28px;
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:700;font-size:11px;
      box-shadow:0 2px 6px rgba(0,0,0,0.4);
    ">${stopNumber}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

function createUnorderedIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};border:2.5px solid white;border-radius:50%;
      width:28px;height:28px;box-shadow:0 2px 6px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  });
}

function createDepotIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:#1e3a5f;border:3px solid white;border-radius:6px;
      width:36px;height:36px;display:flex;align-items:center;justify-content:center;
      color:white;font-weight:900;font-size:11px;letter-spacing:-0.5px;
      box-shadow:0 3px 8px rgba(0,0,0,0.5);
    ">HUB</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -20],
  });
}

function MapBoundsUpdater({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [points, map]);
  return null;
}

export default function ClusterMap({ clusters, depot }) {
  const allPoints = clusters.flatMap((c) => c.points);
  const boundsPoints = depot ? [...allPoints, depot] : allPoints;

  return (
    <MapContainer center={[20, 0]} zoom={2} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {boundsPoints.length > 0 && <MapBoundsUpdater points={boundsPoints} />}

      {/* Depot */}
      {depot && (
        <Marker position={[depot.lat, depot.lng]} icon={createDepotIcon()} zIndexOffset={1000}>
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">Start / Hub</p>
              <p className="text-gray-600 text-xs mt-1">{depot.address}</p>
              <p className="text-gray-400 text-xs">{depot.displayName}</p>
            </div>
          </Popup>
        </Marker>
      )}

      {clusters.map((cluster, clusterIdx) => {
        const color = CLUSTER_COLORS[clusterIdx % CLUSTER_COLORS.length];
        const hasRoute = depot && cluster.orderedPoints?.length > 0;

        // Road geometry from OSRM if available, otherwise straight lines
        const routeLine = cluster.routeGeometry
          ?? (hasRoute
            ? [
                [depot.lat, depot.lng],
                ...cluster.orderedPoints.map((p) => [p.lat, p.lng]),
              ]
            : null);

        // Map each original point to its stop number in the ordered route
        const stopNumberMap = new Map();
        if (hasRoute) {
          cluster.orderedPoints.forEach((op, i) => {
            // Match by lat/lng since orderedPoints are the same objects
            const key = `${op.lat},${op.lng}`;
            stopNumberMap.set(key, i + 1);
          });
        }

        return (
          <Fragment key={clusterIdx}>
            {/* Route path */}
            {routeLine && (
              <Polyline
                positions={routeLine}
                pathOptions={{ color, weight: 5, opacity: 0.85 }}
              />
            )}

            {/* Stop markers */}
            {cluster.points.map((point, pointIdx) => {
              const key = `${point.lat},${point.lng}`;
              const stopNum = stopNumberMap.get(key);
              const icon = stopNum
                ? createStopIcon(color, stopNum)
                : createUnorderedIcon(color);

              return (
                <Marker
                  key={`${clusterIdx}-${pointIdx}`}
                  position={[point.lat, point.lng]}
                  icon={icon}
                >
                  <Popup>
                    <div className="text-sm">
                      {stopNum && (
                        <p className="text-xs font-bold mb-1" style={{ color }}>
                          Shipper {clusterIdx + 1} — Stop #{stopNum}
                        </p>
                      )}
                      <p className="font-semibold truncate max-w-[200px]">{point.address}</p>
                      <p className="text-gray-500 text-xs mt-1 max-w-[200px]">{point.displayName}</p>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </Fragment>
        );
      })}
    </MapContainer>
  );
}
