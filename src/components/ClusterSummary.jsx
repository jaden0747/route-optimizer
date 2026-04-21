import { routeTimeMin, DEFAULT_CONSTRAINTS } from '../utils/clustering.js';

const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#34495e', '#e91e63', '#00bcd4',
];

function fmtTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function calcPrice(distanceKm, pricing) {
  const extra = Math.max(0, distanceKm - pricing.baseKm);
  return pricing.basePrice + extra * pricing.extraPerKm;
}

function fmtPrice(amount) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const DEFAULT_PRICING = { baseKm: 5, basePrice: 50000, extraPerKm: 10000 };

export default function ClusterSummary({ clusters, constraints = DEFAULT_CONSTRAINTS, pricing = DEFAULT_PRICING }) {
  if (clusters.length === 0) return null;

  const hasRoutes = clusters.some((c) => c.routeDistance != null);
  const totalKm   = hasRoutes ? clusters.reduce((s, c) => s + (c.routeDistance ?? 0), 0) : null;
  const bottleneckIdx = hasRoutes
    ? clusters.indexOf(clusters.reduce((a, b) => (a.routeDistance > b.routeDistance ? a : b)))
    : -1;

  const times = hasRoutes
    ? clusters.map((c) => routeTimeMin(c.routeDistance ?? 0, c.points.length, constraints))
    : null;
  const maxTime    = times ? Math.max(...times) : null;
  const overBudget = times ? clusters.filter((_, i) => times[i] > constraints.maxTimeMin) : [];

  const prices      = hasRoutes ? clusters.map((c) => calcPrice(c.routeDistance ?? 0, pricing)) : null;
  const totalCost   = prices ? prices.reduce((s, p) => s + p, 0) : null;
  const totalStops  = clusters.reduce((s, c) => s + c.points.length, 0);
  const costPerStop = totalCost != null && totalStops > 0 ? totalCost / totalStops : null;

  return (
    <div className="space-y-3">

      {/* Fleet overview */}
      <h3 className="text-sm font-semibold text-gray-700">
        {clusters.length} Shipper{clusters.length !== 1 ? 's' : ''} · {totalStops} stops
      </h3>
      {(totalKm != null || totalCost != null) && (
        <div className="grid grid-cols-3 gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2">
          {totalKm != null && (
            <div className="text-center">
              <p className="text-xs text-gray-400">Total km</p>
              <p className="text-sm font-semibold text-gray-700">{totalKm.toFixed(1)}</p>
            </div>
          )}
          {totalCost != null && (
            <div className="text-center">
              <p className="text-xs text-gray-400">Total cost</p>
              <p className="text-sm font-semibold text-gray-700">{fmtPrice(totalCost)}</p>
            </div>
          )}
          {costPerStop != null && (
            <div className="text-center">
              <p className="text-xs text-gray-400">Per customer</p>
              <p className="text-sm font-semibold text-gray-700">{fmtPrice(costPerStop)}</p>
            </div>
          )}
        </div>
      )}

      {/* Over-budget warning */}
      {overBudget.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-xs text-red-700">
          <span className="font-semibold">Time budget exceeded</span> for{' '}
          {overBudget.length} shipper{overBudget.length > 1 ? 's' : ''}.
          Max allowed: {fmtTime(constraints.maxTimeMin)}.
        </div>
      )}

      {/* Time insight */}
      {maxTime != null && overBudget.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          <span className="font-semibold">Slowest shipper</span>{' '}
          <span className="font-semibold">#{bottleneckIdx + 1}</span>:{' '}
          ~{fmtTime(maxTime)} ({clusters[bottleneckIdx].routeDistance.toFixed(1)} km,{' '}
          {clusters[bottleneckIdx].points.length} stops).
          {clusters.length > 1 && totalKm && (
            <span className="text-amber-600">
              {' '}Saving {((1 - clusters[bottleneckIdx].routeDistance / totalKm) * 100).toFixed(0)}% vs single-shipper.
            </span>
          )}
        </div>
      )}

      {/* Per-shipper cards */}
      {clusters.map((cluster, idx) => {
        const color        = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
        const isBottleneck = idx === bottleneckIdx;
        const timeMin      = times ? times[idx] : null;
        const over         = timeMin != null && timeMin > constraints.maxTimeMin;
        const price        = prices ? prices[idx] : null;
        const extraKm      = cluster.routeDistance != null
          ? Math.max(0, cluster.routeDistance - pricing.baseKm)
          : 0;

        return (
          <div
            key={idx}
            className={`border rounded-lg overflow-hidden ${over ? 'ring-2 ring-red-400' : isBottleneck ? 'ring-2 ring-amber-400' : ''}`}
            style={{ borderColor: over ? '#f87171' : color }}
          >
            {/* Card header */}
            <div
              className="px-3 py-2 text-white text-sm font-medium flex justify-between items-center"
              style={{ background: over ? '#ef4444' : color }}
            >
              <span>
                Shipper {idx + 1} — {cluster.points.length} stop{cluster.points.length !== 1 ? 's' : ''}
                {over && (
                  <span className="ml-2 text-xs bg-white/20 px-1.5 py-0.5 rounded-full">over budget</span>
                )}
                {!over && isBottleneck && hasRoutes && (
                  <span className="ml-2 text-xs bg-white/20 px-1.5 py-0.5 rounded-full">slowest</span>
                )}
              </span>
              <div className="text-right">
                {price != null && (
                  <p className="text-xs font-semibold">{fmtPrice(price)}</p>
                )}
                {cluster.routeDistance != null && (
                  <p className="text-xs font-normal opacity-80">
                    {cluster.routeDistance.toFixed(1)} km{timeMin != null && ` · ${fmtTime(timeMin)}`}
                  </p>
                )}
              </div>
            </div>

            {/* Price breakdown */}
            {price != null && (
              <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-xs text-gray-500 flex gap-3">
                <span>Base {pricing.baseKm} km: {fmtPrice(pricing.basePrice)}</span>
                {extraKm > 0 && (
                  <span>+{extraKm.toFixed(1)} km × {fmtPrice(pricing.extraPerKm)}: {fmtPrice(extraKm * pricing.extraPerKm)}</span>
                )}
              </div>
            )}

            <ul className="text-xs text-gray-700 divide-y divide-gray-100">
              {cluster.points.map((p, i) => (
                <li key={i} className="px-3 py-1.5 truncate" title={p.address}>
                  {p.address}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {totalKm != null && (
        <p className="text-xs text-gray-400 text-center">
          One-way distance · time includes {constraints.waitPerStopMin} min/stop wait.
        </p>
      )}
    </div>
  );
}
