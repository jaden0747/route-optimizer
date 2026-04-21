import { routeTimeMin } from './clustering.js';

const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#34495e', '#e91e63', '#00bcd4',
];

function fmtTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtPrice(amount) {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function calcPrice(distanceKm, pricing) {
  const extra = Math.max(0, distanceKm - pricing.baseKm);
  return pricing.basePrice + extra * pricing.extraPerKm;
}

export function openReport(clusters, depot, constraints, pricing) {
  const totalStops  = clusters.reduce((s, c) => s + c.points.length, 0);
  const totalKm     = clusters.reduce((s, c) => s + (c.routeDistance ?? 0), 0);
  const prices      = clusters.map((c) => calcPrice(c.routeDistance ?? 0, pricing));
  const totalCost   = prices.reduce((s, p) => s + p, 0);
  const costPerStop = totalStops > 0 ? totalCost / totalStops : 0;
  const times       = clusters.map((c) =>
    routeTimeMin(c.routeDistance ?? 0, c.points.length, constraints)
  );
  const bottleneckIdx = times.indexOf(Math.max(...times));

  const now = new Date().toLocaleString();

  const shipperRows = clusters.map((cluster, idx) => {
    const color    = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];
    const timeMin  = times[idx];
    const price    = prices[idx];
    const extraKm  = Math.max(0, (cluster.routeDistance ?? 0) - pricing.baseKm);
    const over     = timeMin > constraints.maxTimeMin;
    const isBottle = idx === bottleneckIdx;

    const stopsList = (cluster.orderedPoints?.length
      ? cluster.orderedPoints
      : cluster.points
    ).map((p, i) => `
        <tr>
          <td style="padding:6px 12px;color:#888;width:32px;text-align:center;font-size:12px;">${i + 1}</td>
          <td style="padding:6px 12px;font-size:13px;color:#222;">${p.address}</td>
        </tr>`).join('');

    const badge = over
      ? `<span style="margin-left:8px;background:rgba(255,255,255,0.25);border-radius:99px;padding:2px 8px;font-size:11px;">⚠ over budget</span>`
      : isBottle
      ? `<span style="margin-left:8px;background:rgba(255,255,255,0.25);border-radius:99px;padding:2px 8px;font-size:11px;">slowest</span>`
      : '';

    return `
    <div style="margin-bottom:24px;border-radius:10px;overflow:hidden;border:2px solid ${color};${over ? 'border-color:#ef4444;' : ''}">
      <div style="background:${over ? '#ef4444' : color};color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:700;font-size:14px;">
          Shipper ${idx + 1} — ${cluster.points.length} stop${cluster.points.length !== 1 ? 's' : ''}${badge}
        </span>
        <span style="font-size:13px;opacity:0.9;text-align:right;">
          ${(cluster.routeDistance ?? 0).toFixed(1)} km &nbsp;·&nbsp; ${fmtTime(timeMin)} &nbsp;·&nbsp; ${fmtPrice(price)}
        </span>
      </div>
      <div style="background:#fafafa;padding:8px 16px;font-size:11px;color:#666;border-bottom:1px solid #eee;">
        Base ${pricing.baseKm} km: ${fmtPrice(pricing.basePrice)}
        ${extraKm > 0 ? `&nbsp;+&nbsp; ${extraKm.toFixed(1)} km × ${fmtPrice(pricing.extraPerKm)} = ${fmtPrice(extraKm * pricing.extraPerKm)}` : ''}
      </div>
      <table style="width:100%;border-collapse:collapse;">
        <tbody>${stopsList}
        </tbody>
      </table>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Delivery Plan Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f3f4f6; color: #111; }
    .page { max-width: 860px; margin: 32px auto; background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.10); overflow: hidden; }
    .header { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: #fff; padding: 28px 32px; }
    .header h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
    .header p  { font-size: 12px; opacity: 0.7; margin-top: 4px; }
    .section   { padding: 24px 32px; }
    .section + .section { border-top: 1px solid #e5e7eb; }
    .section-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; margin-bottom: 14px; }
    .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
    .stat  { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
    .stat-label { font-size: 10px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.06em; }
    .stat-value { font-size: 18px; font-weight: 700; color: #111; margin-top: 2px; }
    .constraints { display: flex; flex-wrap: wrap; gap: 16px; font-size: 12px; color: #6b7280; }
    .constraints span strong { color: #374151; }
    tr:nth-child(even) td { background: #f9fafb; }
    @media print {
      body { background: #fff; }
      .page { box-shadow: none; margin: 0; border-radius: 0; }
      .print-btn { display: none !important; }
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <h1>Delivery Plan Report</h1>
    <p>Generated: ${now}${depot ? `&nbsp;&nbsp;·&nbsp;&nbsp;Hub: ${depot.address}` : ''}</p>
  </div>

  <div class="section">
    <div class="section-title">Fleet Summary</div>
    <div class="stats">
      <div class="stat"><div class="stat-label">Shippers</div><div class="stat-value">${clusters.length}</div></div>
      <div class="stat"><div class="stat-label">Total stops</div><div class="stat-value">${totalStops}</div></div>
      <div class="stat"><div class="stat-label">Total km</div><div class="stat-value">${totalKm.toFixed(1)}</div></div>
      <div class="stat"><div class="stat-label">Total cost</div><div class="stat-value">${fmtPrice(totalCost)}</div></div>
      <div class="stat"><div class="stat-label">Per customer</div><div class="stat-value">${fmtPrice(costPerStop)}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Delivery Constraints</div>
    <div class="constraints">
      <span><strong>${constraints.speedKmh} km/h</strong> avg speed</span>
      <span><strong>${fmtTime(constraints.maxTimeMin)}</strong> max per shipper</span>
      <span><strong>${constraints.waitPerStopMin} min</strong> wait per stop</span>
      ${constraints.maxHubKm > 0 ? `<span><strong>${constraints.maxHubKm} km</strong> max hub distance</span>` : ''}
      <span><strong>${fmtPrice(pricing.basePrice)}</strong> for first ${pricing.baseKm} km</span>
      <span><strong>${fmtPrice(pricing.extraPerKm)}</strong> per extra km</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Routes</div>
    ${shipperRows}
  </div>

  <div class="section" style="text-align:center;">
    <button class="print-btn" onclick="window.print()"
      style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px 28px;font-size:14px;font-weight:600;cursor:pointer;">
      Print / Save as PDF
    </button>
  </div>

</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}
