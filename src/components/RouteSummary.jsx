import { routeDistance } from '../utils/tsp.js';

const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#34495e', '#e91e63', '#00bcd4',
];

export default function RouteSummary({ clusters }) {
  if (clusters.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">Route Summary</h3>
      {clusters.map((cluster, idx) => {
        const color = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
        const dist = routeDistance(cluster.points, cluster.route);
        const orderedPoints = cluster.route.map((i) => cluster.points[i]);

        return (
          <div
            key={idx}
            className="border rounded-lg overflow-hidden"
            style={{ borderColor: color }}
          >
            <div
              className="px-3 py-2 text-white text-sm font-medium flex justify-between items-center"
              style={{ background: color }}
            >
              <span>Route {idx + 1} — {cluster.points.length} stops</span>
              <span className="text-xs font-normal opacity-90">{dist.toFixed(1)} km</span>
            </div>
            <ol className="text-xs text-gray-700 divide-y divide-gray-100">
              {orderedPoints.map((p, stopIdx) => (
                <li key={stopIdx} className="px-3 py-1.5 flex gap-2 items-start">
                  <span className="font-bold flex-shrink-0 text-gray-400">{stopIdx + 1}.</span>
                  <span className="truncate" title={p.address}>{p.address}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
