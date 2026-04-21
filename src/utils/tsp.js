import { haversineDistance } from './clustering.js';

// Nearest-neighbor TSP heuristic
// Returns an ordered array of indices representing the route
export function nearestNeighborTSP(points) {
  if (points.length <= 1) return points.map((_, i) => i);

  const n = points.length;
  const visited = new Array(n).fill(false);
  const route = [];

  // Start from the first point
  let current = 0;
  visited[current] = true;
  route.push(current);

  for (let step = 1; step < n; step++) {
    let bestNext = -1;
    let bestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j]) {
        const d = haversineDistance(points[current], points[j]);
        if (d < bestDist) {
          bestDist = d;
          bestNext = j;
        }
      }
    }
    visited[bestNext] = true;
    route.push(bestNext);
    current = bestNext;
  }

  // Apply 2-opt improvement
  return twoOpt(points, route);
}

// 2-opt local search improvement
function twoOpt(points, route) {
  const n = route.length;
  let improved = true;

  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        if (j === n - 1 && i === 0) continue; // Skip wrap-around for open routes

        const a = route[i];
        const b = route[i + 1];
        const c = route[j];
        const d = route[(j + 1) % n];

        const currentDist =
          haversineDistance(points[a], points[b]) +
          haversineDistance(points[c], points[d]);
        const newDist =
          haversineDistance(points[a], points[c]) +
          haversineDistance(points[b], points[d]);

        if (newDist < currentDist - 1e-10) {
          // Reverse the segment between i+1 and j
          let left = i + 1;
          let right = j;
          while (left < right) {
            [route[left], route[right]] = [route[right], route[left]];
            left++;
            right--;
          }
          improved = true;
        }
      }
    }
  }

  return route;
}

// Compute total route distance in km
export function routeDistance(points, order) {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    total += haversineDistance(points[order[i]], points[order[i + 1]]);
  }
  return total;
}
