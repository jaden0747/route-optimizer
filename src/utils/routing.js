/**
 * Fetches actual road geometry for an ordered sequence of waypoints using OSRM.
 * OSRM uses OpenStreetMap road data and requires no API key.
 *
 * Returns an array of [lat, lng] pairs suitable for a Leaflet Polyline,
 * or null if the request fails (caller should fall back to straight lines).
 */
export async function fetchRoadGeometry(waypoints) {
  if (!waypoints || waypoints.length < 2) return null;

  // OSRM expects coordinates as lng,lat (longitude first)
  const coords = waypoints.map((p) => `${p.lng},${p.lat}`).join(';');

  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}` +
      `?overview=full&geometries=geojson`
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.code !== 'Ok' || !data.routes?.[0]?.geometry) return null;

    // GeoJSON coordinates are [lng, lat]; convert to [lat, lng] for Leaflet
    return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  } catch {
    return null;
  }
}
