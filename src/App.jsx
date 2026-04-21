import { useState, useRef } from 'react';
import AddressInput from './components/AddressInput.jsx';
import ClusterMap from './components/ClusterMap.jsx';
import ClusterSummary from './components/ClusterSummary.jsx';
import {
  geocodeAddress,
  PROVIDERS,
  PROVIDER_LABELS,
  requiresKey,
  rateLimitMs,
} from './utils/geocode.js';
import {
  autoClusters, depotAwareClusters, computeRoute, optimizeAssignments,
  DEFAULT_CONSTRAINTS, routeTimeMin, haversineDistance,
} from './utils/clustering.js';
import { fetchRoadGeometry } from './utils/routing.js';

const SAMPLE_ADDRESSES = [
  '1 Apple Park Way, Cupertino, CA',
  '1600 Amphitheatre Parkway, Mountain View, CA',
  '1 Hacker Way, Menlo Park, CA',
  '350 Mission St, San Francisco, CA',
  '575 7th St, San Francisco, CA',
  '2 Infinite Loop, Cupertino, CA',
  '101 Main St, Los Altos, CA',
];

const KEY_STORAGE = {
  [PROVIDERS.GOONG]: 'geocoder_key_goong',
  [PROVIDERS.GOOGLE]: 'geocoder_key_google',
};

const PROVIDER_HELP = {
  [PROVIDERS.NOMINATIM]: null,
  [PROVIDERS.GOONG]: { label: 'account.goong.io', href: 'https://account.goong.io' },
  [PROVIDERS.GOOGLE]: { label: 'console.cloud.google.com', href: 'https://console.cloud.google.com/apis/library/geocoding-backend.googleapis.com' },
};

export default function App() {
  const [startAddress, setStartAddress] = useState('');
  const [depot, setDepot] = useState(null); // { lat, lng, address, displayName }

  const [addresses, setAddresses] = useState([]);
  // coordCache: Map<address string, {lat, lng, displayName}>
  // Populated when importing the "address | N | E" format. Bypasses geocoding.
  const [coordCache, setCoordCache] = useState(new Map());
  const [clusters, setClusters] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);

  const [constraints, setConstraints] = useState(DEFAULT_CONSTRAINTS);
  const [pricing, setPricing] = useState({ baseKm: 5, basePrice: 50000, extraPerKm: 10000 });

  const [provider, setProvider] = useState(
    () => localStorage.getItem('geocoder_provider') ?? PROVIDERS.GOONG
  );
  const [apiKeys, setApiKeys] = useState({
    [PROVIDERS.GOONG]: localStorage.getItem(KEY_STORAGE[PROVIDERS.GOONG]) ?? '',
    [PROVIDERS.GOOGLE]: localStorage.getItem(KEY_STORAGE[PROVIDERS.GOOGLE]) ?? '',
  });
  const [showKey, setShowKey] = useState(false);

  const fileInputRef = useRef(null);
  const coordFileInputRef = useRef(null);

  // ── Address management ────────────────────────────────────────────────────
  const addAddress = (addr) => setAddresses((prev) => [...prev, addr]);
  const removeAddress = (i) => setAddresses((prev) => prev.filter((_, idx) => idx !== i));
  const editAddress = (i, newAddr) =>
    setAddresses((prev) => prev.map((a, idx) => (idx === i ? newAddr : a)));

  const loadSamples = () => {
    setAddresses(SAMPLE_ADDRESSES);
    setCoordCache(new Map());
  };

  const clearAll = () => {
    setAddresses([]);
    setCoordCache(new Map());
    setClusters([]);
    setDepot(null);
    setStatus('');
    setErrors([]);
  };

  const saveToFile = () => {
    const blob = new Blob([addresses.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'addresses.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Plain text import — one address per line
  const loadFromFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      setAddresses(lines);
      setCoordCache(new Map()); // plain import has no cached coords
      setClusters([]);
      setStatus('');
      setErrors([]);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Coordinate import — format: address | latitude | longitude
  const loadFromCoordsFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const addrs = [];
      const cache = new Map();
      let skipped = 0;

      for (const line of lines) {
        const parts = line.split('|').map((p) => p.trim());
        if (parts.length < 3) { skipped++; continue; }
        const address = parts[0];
        const lat = parseFloat(parts[1]);
        const lng = parseFloat(parts[2]);
        if (!address || isNaN(lat) || isNaN(lng)) { skipped++; continue; }
        addrs.push(address);
        cache.set(address, { lat, lng, displayName: address });
      }

      setAddresses(addrs);
      setCoordCache(cache);
      setClusters([]);
      setErrors([]);
      setStatus(
        addrs.length === 0
          ? 'No valid entries found. Expected format: address | lat | lng'
          : `Loaded ${addrs.length} address${addrs.length !== 1 ? 'es' : ''} with coordinates${skipped > 0 ? ` (${skipped} line${skipped !== 1 ? 's' : ''} skipped)` : ''}.`
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Provider / key management ─────────────────────────────────────────────
  const switchProvider = (p) => {
    setProvider(p);
    localStorage.setItem('geocoder_provider', p);
    setShowKey(false);
  };

  const updateKey = (p, value) => {
    setApiKeys((prev) => ({ ...prev, [p]: value }));
    localStorage.setItem(KEY_STORAGE[p], value);
  };

  const currentKey = apiKeys[provider] ?? '';

  // ── Clustering ────────────────────────────────────────────────────────────
  const cluster = async () => {
    const needsGeocoding =
      (startAddress.trim() !== '') || addresses.some((a) => !coordCache.has(a));
    if (needsGeocoding && requiresKey[provider] && !currentKey.trim()) {
      setStatus(`Please enter your ${PROVIDER_LABELS[provider]} API key first.`);
      return;
    }
    if (addresses.length < 2) {
      setStatus('Please add at least 2 addresses.');
      return;
    }

    setLoading(true);
    setClusters([]);
    setDepot(null);
    setErrors([]);
    setStatus('');

    const delay = rateLimitMs[provider];
    let lastApiCallAt = 0;

    const doGeocode = async (addr) => {
      if (delay > 0 && lastApiCallAt > 0) {
        const wait = delay - (Date.now() - lastApiCallAt);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      const result = await geocodeAddress(addr, provider, currentKey.trim());
      lastApiCallAt = Date.now();
      return result;
    };

    // Geocode start address (depot)
    let resolvedDepot = null;
    if (startAddress.trim()) {
      setStatus('Geocoding start address…');
      try {
        const result = await doGeocode(startAddress.trim());
        resolvedDepot = { ...result, address: startAddress.trim() };
      } catch (err) {
        setErrors([{ address: startAddress.trim(), error: `Start address: ${err.message}` }]);
      }
    }

    // Geocode customer addresses
    const geocoded = [];
    const failedAddresses = [];

    for (let i = 0; i < addresses.length; i++) {
      if (coordCache.has(addresses[i])) {
        setStatus(`Reading coordinates ${i + 1} of ${addresses.length}…`);
        geocoded.push({ ...coordCache.get(addresses[i]), address: addresses[i] });
        continue;
      }
      setStatus(`Geocoding address ${i + 1} of ${addresses.length}…`);
      try {
        const result = await doGeocode(addresses[i]);
        geocoded.push({ ...result, address: addresses[i] });
      } catch (err) {
        failedAddresses.push({ address: addresses[i], error: err.message });
      }
    }

    if (failedAddresses.length > 0) setErrors((prev) => [...prev, ...failedAddresses]);

    // Filter stops that are suspiciously far from the hub (likely geocoding errors)
    const tooFar = [];
    const filtered = resolvedDepot && constraints.maxHubKm > 0
      ? geocoded.filter((p) => {
          const d = haversineDistance(p, resolvedDepot);
          if (d > constraints.maxHubKm) {
            tooFar.push({ address: p.address, error: `${d.toFixed(1)} km from hub — ignored (likely geocoding error)` });
            return false;
          }
          return true;
        })
      : geocoded;

    if (tooFar.length > 0) setErrors((prev) => [...prev, ...tooFar]);

    const validPoints = resolvedDepot ? filtered : geocoded;

    if (validPoints.length < 2) {
      setStatus('Not enough valid addresses to cluster. Please check your inputs.');
      setLoading(false);
      return;
    }

    setStatus('Clustering addresses…');

    let assignments;
    if (resolvedDepot) {
      assignments = depotAwareClusters(validPoints, resolvedDepot);
      setDepot(resolvedDepot);
    } else {
      assignments = autoClusters(validPoints);
    }

    const clusterMap = new Map();
    for (let i = 0; i < validPoints.length; i++) {
      const c = assignments[i];
      if (!clusterMap.has(c)) clusterMap.set(c, []);
      clusterMap.get(c).push(validPoints[i]);
    }

    let result = [...clusterMap.values()].map((points) => {
      if (resolvedDepot) {
        const { ordered, distance } = computeRoute(points, resolvedDepot);
        return { points, orderedPoints: ordered, routeDistance: distance };
      }
      return { points, orderedPoints: null, routeDistance: null };
    });

    if (resolvedDepot) {
      const beforeMax   = Math.max(...result.map((c) => c.routeDistance));
      const beforeTotal = result.reduce((s, c) => s + c.routeDistance, 0);

      setStatus('Optimizing assignments…');
      result = optimizeAssignments(result, resolvedDepot, constraints);

      const afterMax   = Math.max(...result.map((c) => c.routeDistance));
      const afterTotal = result.reduce((s, c) => s + c.routeDistance, 0);
      const savedMax   = beforeMax   - afterMax;
      const savedTotal = beforeTotal - afterTotal;
      const net = result.netShippers ?? 0;
      const netNote =
        net > 0  ? ` (+${net} shipper${net > 1 ? 's' : ''} added to share overloaded routes)` :
        net < 0  ? ` (${Math.abs(net)} shipper${Math.abs(net) > 1 ? 's' : ''} removed — stops redistributed to nearby shippers)` :
        '';

      const summaryStatus =
        `Done! ${result.length} shipper${result.length > 1 ? 's' : ''}${netNote}` +
        ` — ~${afterTotal.toFixed(1)} km total` +
        (savedTotal > 0.05 || savedMax > 0.05
          ? ` (saved ${savedMax > 0.05 ? `${savedMax.toFixed(1)} km on bottleneck` : ''}` +
            `${savedMax > 0.05 && savedTotal > 0.05 ? ', ' : ''}` +
            `${savedTotal > 0.05 ? `${savedTotal.toFixed(1)} km total` : ''} vs initial assignment)`
          : ' — already optimal.');

      // Show clusters immediately with straight-line paths, then upgrade to road geometry
      setClusters(result);
      setStatus(summaryStatus + ' Fetching road routes…');

      const withGeo = [];
      for (const cluster of result) {
        const waypoints =
          cluster.orderedPoints?.length
            ? [resolvedDepot, ...cluster.orderedPoints]
            : null;
        const routeGeometry = waypoints ? await fetchRoadGeometry(waypoints) : null;
        withGeo.push({ ...cluster, routeGeometry });
      }
      setClusters(withGeo);
      setStatus(summaryStatus);
    } else {
      setClusters(result);
      setStatus(
        `Done! ${validPoints.length} addresses grouped into ${result.length} cluster${result.length > 1 ? 's' : ''}.`
      );
    }
    setLoading(false);
  };

  const help = PROVIDER_HELP[provider];

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Sidebar */}
      <div className="w-96 flex-shrink-0 bg-white shadow-lg flex flex-col overflow-hidden">
        <div className="bg-blue-700 px-4 py-4 text-white flex-shrink-0">
          <h1 className="text-lg font-bold">Delivery Cluster Planner</h1>
          <p className="text-blue-200 text-xs mt-0.5">Group addresses by proximity for efficient delivery</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Start address */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Start Address</h2>
            <p className="text-xs text-gray-400 mb-2">Warehouse or hub all shippers depart from. Enables depot-aware clustering.</p>
            <input
              type="text"
              value={startAddress}
              onChange={(e) => setStartAddress(e.target.value)}
              placeholder="e.g. 1 Bis Đinh Tiên Hoàng, District 1, Ho Chi Minh City"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </section>

          {/* Addresses */}
          <section>
            <input ref={fileInputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={loadFromFile} />
            <input ref={coordFileInputRef} type="file" accept=".txt,text/plain" className="hidden" onChange={loadFromCoordsFile} />

            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-700">Addresses</h2>
              <div className="flex gap-2 flex-wrap justify-end">
                <button onClick={loadSamples} className="text-xs text-blue-600 hover:text-blue-800 underline">Samples</button>
                <button onClick={() => fileInputRef.current.click()} className="text-xs text-blue-600 hover:text-blue-800 underline">Import</button>
                <button onClick={() => coordFileInputRef.current.click()} className="text-xs text-blue-600 hover:text-blue-800 underline" title="Import file with format: address | lat | lng">Import+Coords</button>
                <button onClick={saveToFile} disabled={addresses.length === 0} className="text-xs text-blue-600 hover:text-blue-800 underline disabled:opacity-40 disabled:cursor-not-allowed">Export</button>
                <button onClick={clearAll} className="text-xs text-gray-400 hover:text-red-500 underline">Clear</button>
              </div>
            </div>

            {coordCache.size > 0 && (
              <p className="text-xs text-green-600 mb-2 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                {coordCache.size} address{coordCache.size !== 1 ? 'es' : ''} with saved coordinates — geocoding skipped
              </p>
            )}

            <AddressInput
              addresses={addresses}
              cachedSet={coordCache.size > 0 ? new Set(coordCache.keys()) : null}
              onAdd={addAddress}
              onRemove={removeAddress}
              onEdit={editAddress}
            />
          </section>

          {/* Delivery constraints */}
          <section className="border-t pt-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Delivery Constraints</h2>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Speed', unit: 'km/h', key: 'speedKmh', min: 1 },
                { label: 'Max time', unit: 'min', key: 'maxTimeMin', min: 1 },
                { label: 'Wait/stop', unit: 'min', key: 'waitPerStopMin', min: 0 },
                { label: 'Max hub dist', unit: 'km', key: 'maxHubKm', min: 0 },
              ].map(({ label, unit, key, min }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={min}
                      value={constraints[key]}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v >= min) setConstraints((c) => ({ ...c, [key]: v }));
                      }}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-400 whitespace-nowrap">{unit}</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Max time = {Math.floor(constraints.maxTimeMin / 60)}h {constraints.maxTimeMin % 60}m per shipper,
              incl. {constraints.waitPerStopMin} min/stop at {constraints.speedKmh} km/h.
              {constraints.maxHubKm > 0 && ` Stops beyond ${constraints.maxHubKm} km are skipped.`}
            </p>
          </section>

          {/* Pricing */}
          <section className="border-t pt-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Pricing</h2>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Base km', key: 'baseKm', min: 0 },
                { label: 'Base price', key: 'basePrice', min: 0 },
                { label: 'Extra /km', key: 'extraPerKm', min: 0 },
              ].map(({ label, key, min }) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-0.5">{label}</label>
                  <input
                    type="number"
                    min={min}
                    value={pricing[key]}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v) && v >= min) setPricing((p) => ({ ...p, [key]: v }));
                    }}
                    className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Flat rate for first {pricing.baseKm} km, then +{pricing.extraPerKm.toLocaleString()} per km beyond.
            </p>
          </section>

          {/* Geocoding provider */}
          <section className="border-t pt-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Geocoding Provider</h2>

            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              {Object.values(PROVIDERS).map((p) => (
                <button
                  key={p}
                  onClick={() => switchProvider(p)}
                  className={`flex-1 py-2 transition-colors ${
                    provider === p
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>

            {requiresKey[provider] && (
              <div className="mt-3">
                <div className="flex gap-1">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={currentKey}
                    onChange={(e) => updateKey(provider, e.target.value)}
                    placeholder={`${PROVIDER_LABELS[provider]} API key`}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                  <button
                    onClick={() => setShowKey((v) => !v)}
                    className="px-2 text-gray-400 hover:text-gray-600 border border-gray-300 rounded-lg text-xs"
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                {help && (
                  <p className="text-xs text-gray-400 mt-1">
                    Get a free key at{' '}
                    <a href={help.href} target="_blank" rel="noreferrer" className="underline hover:text-blue-600">
                      {help.label}
                    </a>
                  </p>
                )}
              </div>
            )}

            {provider === PROVIDERS.NOMINATIM && (
              <p className="text-xs text-gray-400 mt-2">
                Free &amp; no key required. Rate-limited to 1 req/s. Use <strong>Import+Coords</strong> to skip geocoding for addresses that don't resolve.
              </p>
            )}
          </section>

          {/* Cluster button */}
          <section className="border-t pt-4">
            <button
              onClick={cluster}
              disabled={loading || addresses.length < 2}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg font-semibold text-sm hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Clustering…' : 'Cluster Addresses'}
            </button>

            {status && (
              <p className="mt-2 text-xs text-center text-gray-600">{status}</p>
            )}

            {errors.length > 0 && (
              <div className="mt-2 text-xs text-red-600 space-y-1">
                <p className="font-semibold">Failed to geocode:</p>
                {errors.map((e, i) => (
                  <p key={i} className="pl-2">• {e.address}: {e.error}</p>
                ))}
              </div>
            )}
          </section>

          {/* Cluster summary */}
          {clusters.length > 0 && (
            <section className="border-t pt-4">
              <ClusterSummary clusters={clusters} constraints={constraints} pricing={pricing} />
            </section>
          )}

        </div>
      </div>

      {/* Map */}
      <div className="flex-1">
        {clusters.length > 0 ? (
          <ClusterMap clusters={clusters} depot={depot} />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-5xl mb-3">🗺️</div>
              <p className="text-sm">Add addresses and click <strong>Cluster Addresses</strong></p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
