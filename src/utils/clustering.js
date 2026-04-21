// Haversine distance between two lat/lng points (in km)
export function haversineDistance(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sinDLng *
      sinDLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ─── DBSCAN ──────────────────────────────────────────────────────────────────

const UNVISITED = -2;
const NOISE = -1;

function regionQuery(points, idx, epsilon) {
  const result = [];
  for (let j = 0; j < points.length; j++) {
    if (haversineDistance(points[idx], points[j]) <= epsilon) result.push(j);
  }
  return result;
}

function dbscan(points, epsilon, minPts) {
  const labels = new Array(points.length).fill(UNVISITED);
  let clusterId = 0;

  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== UNVISITED) continue;

    const neighbors = regionQuery(points, i, epsilon);
    if (neighbors.length < minPts) {
      labels[i] = NOISE;
      continue;
    }

    labels[i] = clusterId;
    const seedSet = new Set(neighbors);
    seedSet.delete(i);

    for (const j of seedSet) {
      if (labels[j] === NOISE) labels[j] = clusterId;
      if (labels[j] !== UNVISITED) continue;

      labels[j] = clusterId;
      const jNeighbors = regionQuery(points, j, epsilon);
      if (jNeighbors.length >= minPts) {
        for (const nb of jNeighbors) seedSet.add(nb);
      }
    }

    clusterId++;
  }

  return labels;
}

// ─── Epsilon auto-estimation (k-NN elbow / kneedle) ─────────────────────────

// For each point, compute distance to its 2nd nearest neighbor (k=2).
// Using k=2 is more stable than k=1 — a single anomalously close pair
// won't collapse the entire estimate. Sort these and find the elbow.
function estimateEpsilon(points) {
  const n = points.length;
  const k = Math.min(2, n - 1); // 2nd nearest neighbour (1st when n=2)
  const knnDists = [];

  for (let i = 0; i < n; i++) {
    const dists = [];
    for (let j = 0; j < n; j++) {
      if (i !== j) dists.push(haversineDistance(points[i], points[j]));
    }
    dists.sort((a, b) => a - b);
    knnDists.push(dists[k - 1]);
  }

  knnDists.sort((a, b) => a - b);
  return findKnee(knnDists);
}

// A sorted ascending k-NN distance curve is concave-up: it rises slowly
// then steeply. After normalising both axes to [0,1], every interior point
// sits BELOW the diagonal y = x (i.e. y − x < 0). The elbow — where the
// slow rise becomes steep — corresponds to the point with the MOST NEGATIVE
// deviation from the diagonal. That is the correct knee for this curve shape.
//
// Previous bug: the code searched for the MAX of (y − x), which is always 0
// at i = 0 (the only non-negative value), pinning kneeIdx = 0 and producing
// an epsilon equal to the minimum k-NN distance — far too small, causing
// DBSCAN to label almost everything as noise and collapse into 1 cluster.
function findKnee(sortedDists) {
  const n = sortedDists.length;
  if (n <= 2) return sortedDists[n - 1];

  const minD = sortedDists[0];
  const maxD = sortedDists[n - 1];
  const range = maxD - minD;
  if (range === 0) return minD;

  let minDiff = 0;               // track the most-negative (y − x)
  let kneeIdx = Math.floor(n / 2); // fallback: median index

  for (let i = 1; i < n - 1; i++) {
    const x = i / (n - 1);
    const y = (sortedDists[i] - minD) / range;
    const diff = y - x;          // negative for concave-up curves
    if (diff < minDiff) {
      minDiff = diff;
      kneeIdx = i;
    }
  }

  return sortedDists[kneeIdx];
}

// ─── Depot-aware clustering ───────────────────────────────────────────────────

/**
 * Nearest-neighbour tour starting and ending at depot.
 * Returns { ordered: point[], distance: number }.
 * `ordered` is the sequence of clusterPoints in visit order.
 */
export function computeRoute(clusterPoints, depot) {
  if (clusterPoints.length === 0) return { ordered: [], distance: 0 };
  if (clusterPoints.length === 1) {
    return {
      ordered: [clusterPoints[0]],
      distance: haversineDistance(depot, clusterPoints[0]),
    };
  }

  const visited = new Set();
  let current = depot;
  let total = 0;
  const ordered = [];

  while (visited.size < clusterPoints.length) {
    let best = -1, bestDist = Infinity;
    for (let j = 0; j < clusterPoints.length; j++) {
      if (!visited.has(j)) {
        const d = haversineDistance(current, clusterPoints[j]);
        if (d < bestDist) { bestDist = d; best = j; }
      }
    }
    total += bestDist;
    visited.add(best);
    ordered.push(clusterPoints[best]);
    current = clusterPoints[best];
  }

  return { ordered, distance: total };
}

// Convenience wrapper used internally for scoring.
export function estimateRouteDistance(clusterPoints, depot) {
  return computeRoute(clusterPoints, depot).distance;
}

// Initialise k centroids by splitting points into equal angular sectors
// around the depot. Shippers spread out in different directions from day 1.
function initBySector(points, depot, k) {
  const sorted = [...points]
    .map((p, i) => ({ i, angle: Math.atan2(p.lat - depot.lat, p.lng - depot.lng) }))
    .sort((a, b) => a.angle - b.angle);

  return Array.from({ length: k }, (_, s) => {
    const mid = sorted[Math.floor((s + 0.5) * (points.length / k)) % points.length];
    return { lat: points[mid.i].lat, lng: points[mid.i].lng };
  });
}

// K-means given explicit initial centroids.
function kMeansFixed(points, k, centroids, maxIter = 150) {
  centroids = centroids.map(c => ({ ...c }));
  let assignments = new Array(points.length).fill(0);
  let changed = true;

  for (let iter = 0; iter < maxIter && changed; iter++) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0, bestDist = Infinity;
      for (let j = 0; j < k; j++) {
        const d = haversineDistance(points[i], centroids[j]);
        if (d < bestDist) { bestDist = d; best = j; }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true; }
    }
    const sums = Array.from({ length: k }, () => ({ lat: 0, lng: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      sums[assignments[i]].lat += points[i].lat;
      sums[assignments[i]].lng += points[i].lng;
      sums[assignments[i]].n++;
    }
    for (let j = 0; j < k; j++) {
      if (sums[j].n > 0) centroids[j] = { lat: sums[j].lat / sums[j].n, lng: sums[j].lng / sums[j].n };
    }
  }
  return assignments;
}

function remapIds(assignments) {
  const idMap = new Map();
  let next = 0;
  return assignments.map(id => {
    if (!idMap.has(id)) idMap.set(id, next++);
    return idMap.get(id);
  });
}

/**
 * Depot-aware clustering with time + cost optimisation.
 *
 * Scoring: max_route(k) + k × (route₁ / n)
 *
 * • max_route(k) — the slowest shipper's round-trip distance, which determines
 *   overall delivery completion time.  Using max (not sum) means splitting the
 *   longest route always pays off, naturally pushing toward more shippers until
 *   the per-shipper penalty catches up.
 *
 * • shipper penalty = route₁ / n — cost of one extra shipper expressed as the
 *   average per-stop km in the single-shipper scenario.  Self-calibrated: tight
 *   city data gets a small penalty (splitting is cheap), spread-out data gets a
 *   larger one (transit overhead is real).
 *
 * maxK is auto-set to ≈ 1.5 √n so the search space scales with dataset size.
 */
export function depotAwareClusters(points, depot) {
  const n = points.length;
  if (n <= 1) return points.map((_, i) => i);

  const route1 = estimateRouteDistance(points, depot);
  const shipperPenalty = route1 / n;                          // 1 avg-stop-km per shipper
  const maxK = Math.min(Math.ceil(Math.sqrt(n) * 1.5), n, 12);

  let bestScore = Infinity;
  let bestAssignments = null;

  for (let k = 1; k <= maxK; k++) {
    const centroids = initBySector(points, depot, k);
    const assignments = kMeansFixed(points, k, centroids);

    const groups = new Map();
    for (let i = 0; i < n; i++) {
      if (!groups.has(assignments[i])) groups.set(assignments[i], []);
      groups.get(assignments[i]).push(points[i]);
    }

    // Bottleneck = slowest shipper (determines when ALL deliveries are done)
    let maxRoute = 0;
    for (const pts of groups.values())
      maxRoute = Math.max(maxRoute, estimateRouteDistance(pts, depot));

    const score = maxRoute + k * shipperPenalty;
    if (score < bestScore) { bestScore = score; bestAssignments = assignments; }
  }

  return remapIds(bestAssignments);
}

// ─── Delivery constraints ─────────────────────────────────────────────────────

export const DEFAULT_CONSTRAINTS = {
  speedKmh:        20,   // average travel speed
  maxTimeMin:      105,  // 1 h 45 m per shipper
  waitPerStopMin:  7,    // time spent at each stop
  maxHubKm:        50,   // ignore stops farther than this from the hub (0 = no limit)
};

/** Total delivery time in minutes for one shipper. */
export function routeTimeMin(distanceKm, numStops, constraints = DEFAULT_CONSTRAINTS) {
  return (distanceKm / constraints.speedKmh) * 60 + numStops * constraints.waitPerStopMin;
}

/** True when the shipper can complete the route within the time budget. */
export function isFeasible(distanceKm, numStops, constraints = DEFAULT_CONSTRAINTS) {
  return routeTimeMin(distanceKm, numStops, constraints) <= constraints.maxTimeMin;
}

// ─── Local-search post-processing ────────────────────────────────────────────

/**
 * Score a set of clusters by delivery TIME (not raw distance).
 * Time = travel time + wait time per stop, so this naturally balances both
 * route length and stop count — a shipper with many close stops scores the
 * same as one with fewer but farther stops if total time is equal.
 *
 * Objective: minimise  2 × max_time  +  sum_time
 *   The ×2 weight on max means cutting the bottleneck 1 min beats cutting
 *   the total by 2 min — strongly prioritising delivery completion time.
 */
function scoreByTime(groups, routes, constraints) {
  const times = groups.map((g, i) =>
    routeTimeMin(routes[i].distance, g.length, constraints)
  );
  return (
    2 * Math.max(...times) +
    times.reduce((s, t) => s + t, 0)
  );
}

/**
 * One pass of best-improvement local search over `groups`/`routes` arrays.
 * Mutates groups in-place; returns updated routes.
 * Scoring is TIME-based so both travel distance and stop count are balanced.
 * Rejects any move that would leave a cluster infeasible under `constraints`.
 */
function localSearchPass(groups, routes, depot, constraints) {
  let searching = true;

  while (searching) {
    searching = false;
    let bestDelta = 0;
    let bestMove  = null;
    const curScore = scoreByTime(groups, routes, constraints);

    // ── Relocate: move one stop from cluster `fi` to cluster `ti` ──────────
    for (let fi = 0; fi < groups.length; fi++) {
      if (groups[fi].length <= 1) continue; // never empty a cluster
      for (let pi = 0; pi < groups[fi].length; pi++) {
        const point = groups[fi][pi];
        for (let ti = 0; ti < groups.length; ti++) {
          if (ti === fi) continue;

          const newTo   = [...groups[ti], point];
          const newToRt = computeRoute(newTo, depot);
          if (!isFeasible(newToRt.distance, newTo.length, constraints)) continue;

          const newFrom = groups[fi].filter((_, i) => i !== pi);
          const newRts  = routes.map((r, i) =>
            i === fi ? computeRoute(newFrom, depot)
            : i === ti ? newToRt
            : r
          );

          // Score with updated group sizes: fi loses one stop, ti gains one
          const newTimes = newRts.map((r, i) => {
            const size = i === fi ? groups[fi].length - 1
                       : i === ti ? groups[ti].length + 1
                       : groups[i].length;
            return routeTimeMin(r.distance, size, constraints);
          });
          const newScore = 2 * Math.max(...newTimes) + newTimes.reduce((s, t) => s + t, 0);

          const delta = newScore - curScore;
          if (delta < bestDelta - 1e-9) {
            bestDelta = delta;
            bestMove  = { type: 'relocate', fi, pi, ti, newFrom, newTo, newRts };
          }
        }
      }
    }

    // ── Swap: exchange one stop between clusters `ai` and `bi` ─────────────
    for (let ai = 0; ai < groups.length; ai++) {
      for (let bi = ai + 1; bi < groups.length; bi++) {
        for (let ap = 0; ap < groups[ai].length; ap++) {
          for (let bp = 0; bp < groups[bi].length; bp++) {
            const newA = [...groups[ai]];
            const newB = [...groups[bi]];
            [newA[ap], newB[bp]] = [newB[bp], newA[ap]];

            const newARt = computeRoute(newA, depot);
            const newBRt = computeRoute(newB, depot);
            if (!isFeasible(newARt.distance, newA.length, constraints)) continue;
            if (!isFeasible(newBRt.distance, newB.length, constraints)) continue;

            const newRts = routes.map((r, i) =>
              i === ai ? newARt : i === bi ? newBRt : r
            );

            // Swap doesn't change group sizes, only distances
            const delta = scoreByTime(groups, newRts, constraints) - curScore;
            if (delta < bestDelta - 1e-9) {
              bestDelta = delta;
              bestMove  = { type: 'swap', ai, ap, bi, bp, newA, newB, newRts };
            }
          }
        }
      }
    }

    if (bestMove) {
      searching = true;
      if (bestMove.type === 'relocate') {
        groups[bestMove.fi] = bestMove.newFrom;
        groups[bestMove.ti] = bestMove.newTo;
      } else {
        groups[bestMove.ai] = bestMove.newA;
        groups[bestMove.bi] = bestMove.newB;
      }
      routes = bestMove.newRts;
    }
  }

  return { routes };
}

/**
 * Split one cluster into two sub-clusters using depot-aware k-means (k=2).
 * Returns an array of two point arrays, or the original single array wrapped
 * if it cannot be split (≤1 point).
 */
function splitCluster(points, depot) {
  if (points.length <= 1) return [points];
  const centroids = initBySector(points, depot, 2);
  const assignments = kMeansFixed(points, 2, centroids);
  const groupA = points.filter((_, i) => assignments[i] === 0);
  const groupB = points.filter((_, i) => assignments[i] === 1);
  // Guard: k-means may degenerate and put everything in one group
  if (groupA.length === 0 || groupB.length === 0) return [points];
  return [groupA, groupB];
}

/**
 * Improves an existing cluster assignment by:
 *   1. Force-splitting any cluster that violates the time budget (hard constraint).
 *   2. Running best-improvement local search (relocate + swap) — moves that would
 *      create an infeasible cluster are rejected outright.
 *   3. For each statistical outlier (route > avg + 1.5σ), evaluating:
 *        A. Dissolve — redistribute stops to existing shippers (saves cost).
 *        B. Split    — break into two clusters, hire one more shipper.
 *      Accept whichever lowers the cost-aware score more; dissolve is rejected if
 *      any resulting cluster would violate the time budget.
 *
 * Scoring: 2 × max_route + total_route + k × shipperPenalty
 *
 * Input/output: array of { points, orderedPoints, routeDistance }
 * result.netShippers = net shippers added (negative = dissolved, positive = added)
 */
export function optimizeAssignments(clusters, depot, constraints = DEFAULT_CONSTRAINTS) {
  if (!depot || clusters.length <= 1) {
    const result = clusters.slice();
    result.netShippers = 0;
    return result;
  }

  const totalPoints = clusters.reduce((s, c) => s + c.points.length, 0);
  const shipperCap  = Math.min(Math.ceil(Math.sqrt(totalPoints) * 2), 15);

  let groups = clusters.map((c) => [...c.points]);
  let routes = groups.map((pts) => computeRoute(pts, depot));

  // ── Phase 0: force-split any cluster that already violates the time budget ──
  let forceSplits = 0;
  let anyInfeasible = true;
  while (anyInfeasible && groups.length < shipperCap) {
    anyInfeasible = false;
    for (let i = 0; i < groups.length; i++) {
      if (isFeasible(routes[i].distance, groups[i].length, constraints)) continue;
      if (groups[i].length < 2) continue; // single stop and still infeasible — nothing we can do
      anyInfeasible = true;
      const [subA, subB] = splitCluster(groups[i], depot);
      if (subA === groups[i]) break; // degenerate — give up
      groups.splice(i, 1, subA, subB);
      routes.splice(i, 1, computeRoute(subA, depot), computeRoute(subB, depot));
      forceSplits++;
      break; // restart scan after every split
    }
  }

  // ── Phase 1: local search (time-balanced, feasibility-constrained) ──────────
  ({ routes } = localSearchPass(groups, routes, depot, constraints));

  // Shipper cost proxy: avg delivery time per stop (in minutes), computed once.
  // Using time (not distance) keeps the penalty unit consistent with scoring.
  const allTimes0    = groups.map((g, i) => routeTimeMin(routes[i].distance, g.length, constraints));
  const shipperPenalty = allTimes0.reduce((s, t) => s + t, 0) / totalPoints;

  // Cost-aware score: time-based objective + k × penalty discourages extra shippers
  const scoreWithCost = (grps, rts) => {
    const times = grps.map((g, i) => routeTimeMin(rts[i].distance, g.length, constraints));
    return (
      2 * Math.max(...times) +
      times.reduce((s, t) => s + t, 0) +
      rts.length * shipperPenalty
    );
  };

  // ── Phase 2: dissolve or split TIME outliers ──────────────────────────────
  let netShippers = forceSplits;
  let changed = true;

  while (changed) {
    changed = false;

    // Detect outlier by DELIVERY TIME (travel + wait per stop)
    const times     = groups.map((g, i) => routeTimeMin(routes[i].distance, g.length, constraints));
    const avg       = times.reduce((s, t) => s + t, 0) / times.length;
    const sigma     = Math.sqrt(times.reduce((s, t) => s + (t - avg) ** 2, 0) / times.length);
    const threshold = avg + 1.5 * sigma;

    let worstIdx = -1, worstTime = threshold;
    for (let i = 0; i < times.length; i++) {
      if (times[i] > worstTime) { worstTime = times[i]; worstIdx = i; }
    }
    if (worstIdx === -1) break;

    const curScore = scoreWithCost(groups, routes);

    // ── Option A: dissolve — assign each stop to its nearest other cluster ──
    let dissolveResult = null;
    if (groups.length > 1) {
      const dGroups = groups.filter((_, i) => i !== worstIdx).map((g) => [...g]);

      for (const point of groups[worstIdx]) {
        let best = 0, bestD = Infinity;
        for (let j = 0; j < dGroups.length; j++) {
          const cLat = dGroups[j].reduce((s, p) => s + p.lat, 0) / dGroups[j].length;
          const cLng = dGroups[j].reduce((s, p) => s + p.lng, 0) / dGroups[j].length;
          const d = haversineDistance(point, { lat: cLat, lng: cLng });
          if (d < bestD) { bestD = d; best = j; }
        }
        dGroups[best].push(point);
      }

      const dRoutesPre = dGroups.map((pts) => computeRoute(pts, depot));
      const allFeasible = dGroups.every((g, i) =>
        isFeasible(dRoutesPre[i].distance, g.length, constraints)
      );
      if (allFeasible) {
        const { routes: dRoutes } = localSearchPass(dGroups, dRoutesPre, depot, constraints);
        const dScore = scoreWithCost(dGroups, dRoutes);
        if (dScore < curScore - 1e-9) {
          dissolveResult = { groups: dGroups, routes: dRoutes, score: dScore };
        }
      }
    }

    // ── Option B: split — break the bottleneck into two sub-clusters ────────
    let splitResult = null;
    if (groups.length < shipperCap && groups[worstIdx].length >= 2) {
      const [subA, subB] = splitCluster(groups[worstIdx], depot);
      if (subA !== groups[worstIdx]) {
        const sGroups = [
          ...groups.slice(0, worstIdx),
          subA, subB,
          ...groups.slice(worstIdx + 1),
        ];
        const sRoutesPre = [
          ...routes.slice(0, worstIdx),
          computeRoute(subA, depot),
          computeRoute(subB, depot),
          ...routes.slice(worstIdx + 1),
        ];
        const { routes: sRoutes } = localSearchPass(sGroups, sRoutesPre, depot, constraints);
        const sScore = scoreWithCost(sGroups, sRoutes);
        if (sScore < curScore - 1e-9) {
          splitResult = { groups: sGroups, routes: sRoutes, score: sScore };
        }
      }
    }

    // Accept the better option (dissolve preferred when scores are equal)
    if (dissolveResult && (!splitResult || dissolveResult.score <= splitResult.score)) {
      groups = dissolveResult.groups;
      routes = dissolveResult.routes;
      netShippers--;
      changed = true;
    } else if (splitResult) {
      groups = splitResult.groups;
      routes = splitResult.routes;
      netShippers++;
      changed = true;
    }
  }

  const result = groups
    .map((pts, i) => ({
      points:        pts,
      orderedPoints: routes[i].ordered,
      routeDistance: routes[i].distance,
    }))
    .filter((c) => c.points.length > 0);

  result.netShippers = netShippers;
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Automatically cluster points using DBSCAN with auto-estimated epsilon.
 * Returns an array of cluster IDs (0-based, contiguous) aligned with `points`.
 */
export function autoClusters(points) {
  if (points.length <= 1) return points.map((_, i) => i);

  const minPts = 2;
  const epsilon = estimateEpsilon(points);
  const labels = dbscan(points, epsilon, minPts);

  // Collect valid cluster IDs (excluding noise)
  const clusterIds = [...new Set(labels.filter((l) => l >= 0))];

  if (clusterIds.length === 0) {
    // All points labeled as noise — treat as one cluster
    return points.map(() => 0);
  }

  // Assign noise points to the nearest cluster centroid
  if (labels.includes(NOISE)) {
    const centroids = clusterIds.map((cId) => {
      const pts = points.filter((_, i) => labels[i] === cId);
      return {
        lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
        lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
      };
    });

    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== NOISE) continue;
      let minDist = Infinity;
      let nearest = clusterIds[0];
      for (let j = 0; j < clusterIds.length; j++) {
        const d = haversineDistance(points[i], centroids[j]);
        if (d < minDist) {
          minDist = d;
          nearest = clusterIds[j];
        }
      }
      labels[i] = nearest;
    }
  }

  // Remap to contiguous 0-based IDs
  const idMap = new Map();
  let nextId = 0;
  return labels.map((id) => {
    if (!idMap.has(id)) idMap.set(id, nextId++);
    return idMap.get(id);
  });
}
