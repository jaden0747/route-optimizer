export const PROVIDERS = {
  NOMINATIM: 'nominatim',
  GOONG: 'goong',
  GOOGLE: 'google',
};

export const PROVIDER_LABELS = {
  [PROVIDERS.NOMINATIM]: 'OpenStreetMap',
  [PROVIDERS.GOONG]: 'Goong',
  [PROVIDERS.GOOGLE]: 'Google',
};

// Whether the provider requires an API key
export const requiresKey = {
  [PROVIDERS.NOMINATIM]: false,
  [PROVIDERS.GOONG]: true,
  [PROVIDERS.GOOGLE]: true,
};

// Nominatim enforces 1 request/second
export const rateLimitMs = {
  [PROVIDERS.NOMINATIM]: 1100,
  [PROVIDERS.GOONG]: 0,
  [PROVIDERS.GOOGLE]: 0,
};

// ─── Provider implementations ─────────────────────────────────────────────────

async function geocodeNominatim(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en', 'User-Agent': 'RouteOptimizer/1.0' },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.statusText}`);
  const data = await res.json();
  if (!data.length) throw new Error(`Address not found: "${address}"`);
  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    displayName: data[0].display_name,
  };
}

async function geocodeGoong(address, apiKey) {
  const url = `https://rsapi.goong.io/Geocode?address=${encodeURIComponent(address)}&api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.statusText}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length)
    throw new Error(`Address not found: "${address}"`);
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng, displayName: data.results[0].formatted_address };
}

async function geocodeGoogle(address, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.statusText}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length)
    throw new Error(`Address not found: "${address}" (status: ${data.status})`);
  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng, displayName: data.results[0].formatted_address };
}

// ─── Unified entry point ──────────────────────────────────────────────────────

export async function geocodeAddress(address, provider, apiKey) {
  switch (provider) {
    case PROVIDERS.NOMINATIM: return geocodeNominatim(address);
    case PROVIDERS.GOONG:     return geocodeGoong(address, apiKey);
    case PROVIDERS.GOOGLE:    return geocodeGoogle(address, apiKey);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}
