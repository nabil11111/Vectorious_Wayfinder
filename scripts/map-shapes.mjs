// Builds the Sri Lanka district shapes that the sign-in artwork and the dispatcher dashboard's fleet map draw,
// from the design's own data and code, and writes them as two TypeScript modules under apps/web/src/lib/map.
//
//   node scripts/map-shapes.mjs <path to districts.geojson>
//
// The GeoJSON is geoBoundaries gbOpen Sri Lanka ADM2 (see docs/map-data.md for the pinned download). It is not kept
// in the repo and this script is not part of the build: run it by hand and commit the two modules it writes.
//
// The maths follows the design's scripts line by line: build-fleet-map.py for the fleet map (a 340 x 280 north-up
// Mercator frame per view, rings clipped to the frame, district centres, one land-checked connection per depot and
// district) and build-login-artwork.py for the artwork (one 600 x 660 fit of every district, 12 px padding).
// Which districts are served comes from data/shared/outlets.csv.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = new URL('../', import.meta.url);
const FLEET_FILE = new URL('apps/web/src/lib/map/fleet-map-shapes.ts', repo);
const ARTWORK_FILE = new URL('apps/web/src/lib/map/login-artwork-shapes.ts', repo);
const OUTLETS_FILE = new URL('data/shared/outlets.csv', repo);
const MAX_BYTES = 60 * 1024;
// Douglas-Peucker tolerances, in frame pixels. The artwork fits at 0.25 px. The fleet map holds three views and 24
// connections: at 0.25 px it comes to 84 KB, and it first fits under 60 KB at 0.55 px. At 0.6 px it still keeps
// every island, and laid over the design's export it looks the same as 0.25 px.
const FLEET_TOLERANCE = 0.6;
const ARTWORK_TOLERANCE = 0.25;

// The depot anchors are the town centres the design used, copied from its places.json: OpenStreetMap Nominatim
// results for Peliyagoda (OSM node 668962092) and Kandy (OSM node 2908772560). Data (c) OpenStreetMap contributors,
// ODbL 1.0. [longitude, latitude]
const DEPOT_ANCHORS = { Peliyagoda: [79.8818947, 6.9633651], Kandy: [80.6350358, 7.2931208] };

// From build-fleet-map.py: each view's frame, its [west, south, east, north] box, and the depots it shows.
const FLEET = { width: 340, height: 280 };
const VIEWS = {
  Peliyagoda: { box: [79.48, 5.76, 81.32, 8.55], depots: ['Peliyagoda'] },
  Kandy: { box: [79.80, 6.57, 81.40, 8.27], depots: ['Kandy'] },
  Both: { box: [79.48, 5.76, 81.6, 8.55], depots: ['Peliyagoda', 'Kandy'] },
};
// From build-login-artwork.py.
const ARTWORK = { width: 600, height: 660, padding: 12 };

const geojsonPath = process.argv[2];
if (!geojsonPath) {
  console.error('Usage: node scripts/map-shapes.mjs <path to districts.geojson>');
  process.exit(1);
}
const geo = JSON.parse(readFileSync(geojsonPath, 'utf8'));

// ---- The design's geometry (build-fleet-map.py and build-login-artwork.py) ----

const merc = ([lon, lat]) => [lon, Math.log(Math.tan(Math.PI / 4 + lat * (Math.PI / 180) / 2)) * (180 / Math.PI)];

// North-up Mercator fitted inside the frame and centred, as build-fleet-map.py's project(box).
function project(box, { width, height }) {
  const [x0, y0] = merc([box[0], box[1]]);
  const [x1, y1] = merc([box[2], box[3]]);
  const s = Math.min(width / (x1 - x0), height / (y1 - y0));
  const ox = (width - (x1 - x0) * s) / 2;
  const oy = (height - (y1 - y0) * s) / 2;
  return p => { const [x, y] = merc(p); return [ox + (x - x0) * s, oy + (y1 - y) * s]; };
}

// The outer ring of each polygon. The district boundaries have no holes.
const ringsOf = feature => feature.geometry.type === 'MultiPolygon'
  ? feature.geometry.coordinates.map(polygon => polygon[0])
  : [feature.geometry.coordinates[0]];

function area(p) {
  let sum = 0;
  for (let i = 0; i < p.length - 1; i++) sum += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1];
  return sum / 2;
}

function centroid(p) {
  const a = area(p);
  return [0, 1].map(k => {
    let sum = 0;
    for (let i = 0; i < p.length - 1; i++) sum += (p[i][k] + p[i + 1][k]) * (p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1]);
    return sum / (6 * a);
  });
}

// Sutherland-Hodgman against the four sides of the frame, as build-fleet-map.py's clipped(poly).
function clipped(poly, { width, height }) {
  for (const [ax, b, sg] of [[0, 0, 1], [0, width, -1], [1, 0, 1], [1, height, -1]]) {
    if (poly.length === 0) return [];
    const out = [];
    let pr = poly[poly.length - 1];
    let pi = (pr[ax] - b) * sg >= 0;
    for (const c of poly) {
      const ci = (c[ax] - b) * sg >= 0;
      if (ci !== pi) {
        const t = (b - pr[ax]) / (c[ax] - pr[ax]);
        out.push([pr[0] + t * (c[0] - pr[0]), pr[1] + t * (c[1] - pr[1])]);
      }
      if (ci) out.push(c);
      pr = c;
      pi = ci;
    }
    poly = out;
  }
  return poly;
}

function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const districtName = feature => feature.properties.shapeName.replace(' District', '');
const features = geo.features;
const landRings = features.flatMap(ringsOf);
const landBounds = landRings.map(ring => [
  Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])),
  Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1])),
]);
const onLand = p => landRings.some((ring, i) => {
  const b = landBounds[i];
  return b[0] <= p[0] && p[0] <= b[2] && b[1] <= p[1] && p[1] <= b[3] && insideRing(p, ring);
});

// Each district's centre is the centroid of its largest ring, in longitude and latitude.
const centres = new Map(features.map(feature => {
  let largest = null;
  for (const ring of ringsOf(feature)) if (largest === null || Math.abs(area(ring)) > Math.abs(area(largest))) largest = ring;
  return [districtName(feature), centroid(largest)];
}));

// The depot-to-district curve: a quadratic in longitude and latitude. Its control point is the midpoint, except
// for build-fleet-map.py's inland bends that keep short local corridors off the coast.
function controlPoint(a, b, district) {
  const cp = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (district === 'Gampaha') return [a[0] + 0.36, a[1] + 0.25];
  if (district === 'Colombo') return [a[0] + 0.32, a[1] - 0.13];
  if (district === 'Kandy') return [a[0] + 0.30, a[1] + 0.24];
  if (district === 'Puttalam') cp[0] += 0.12;
  return cp;
}
const sample = (a, control, b, steps) => Array.from({ length: steps + 1 }, (_, i) => {
  const t = i / steps;
  return [0, 1].map(k => (1 - t) ** 2 * a[k] + 2 * (1 - t) * t * control[k] + t * t * b[k]);
});

// ---- The shops: which districts each depot serves ----

const [header, ...rows] = readFileSync(OUTLETS_FILE, 'utf8').trim().split(/\r?\n/).map(line => line.split(','));
const depotColumn = header.indexOf('depot');
const districtColumn = header.indexOf('district');
if (depotColumn < 0 || districtColumn < 0) throw new Error('outlets.csv has no depot or district column.');
const servedBy = new Map(Object.keys(DEPOT_ANCHORS).map(depot => [depot, new Set()]));
for (const row of rows) {
  const served = servedBy.get(row[depotColumn]);
  if (!served) throw new Error(`outlets.csv names a depot with no anchor: ${row[depotColumn]}`);
  if (!centres.has(row[districtColumn])) throw new Error(`outlets.csv names a district the boundaries do not have: ${row[districtColumn]}`);
  served.add(row[districtColumn]);
}

// ---- Making the shapes small: simplify, round, write compact paths ----

function distanceToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Douglas-Peucker on a closed ring, in pixels. The ring is walked from its first point back to it, so the first
// point always stays.
function simplify(ring, tolerance) {
  const open = ring.filter((p, i) => i === 0 || p[0] !== ring[i - 1][0] || p[1] !== ring[i - 1][1]);
  while (open.length > 1 && open[open.length - 1][0] === open[0][0] && open[open.length - 1][1] === open[0][1]) open.pop();
  if (open.length < 3) return open;
  const closed = [...open, open[0]];
  const keep = new Uint8Array(closed.length);
  keep[0] = keep[closed.length - 1] = 1;
  const spans = [[0, closed.length - 1]];
  while (spans.length > 0) {
    const [first, last] = spans.pop();
    let farthest = -1;
    let distance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const d = distanceToSegment(closed[i], closed[first], closed[last]);
      if (d > distance) { distance = d; farthest = i; }
    }
    if (farthest >= 0) { keep[farthest] = 1; spans.push([first, farthest], [farthest, last]); }
  }
  return closed.filter((_, i) => keep[i]).slice(0, -1);
}

// A ring in tenths of a pixel, without repeated points. Rings left with fewer than three points are dropped.
function tenths(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [Math.round(x * 10), Math.round(y * 10)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  while (out.length > 1 && out[out.length - 1][0] === out[0][0] && out[out.length - 1][1] === out[0][1]) out.pop();
  return out.length >= 3 ? out : null;
}

// A whole number of tenths as the shortest decimal: 15 -> 1.5, -5 -> -.5, 30 -> 3.
function decimal(n) {
  const whole = Math.trunc(Math.abs(n) / 10);
  const tenth = Math.abs(n) % 10;
  return (n < 0 ? '-' : '') + (tenth === 0 ? String(whole) : `${whole === 0 ? '' : whole}.${tenth}`);
}

// Numbers run together where the SVG path grammar allows: a minus sign starts a new number, and so does a second
// decimal point (1.2.5 reads as 1.2 then .5).
function numbers(values) {
  let out = '';
  let dotted = false;
  for (const s of values.map(decimal)) {
    if (out !== '' && !s.startsWith('-') && !(s.startsWith('.') && dotted)) out += ' ';
    out += s;
    dotted = s.includes('.');
  }
  return out;
}

// Each ring starts with an absolute M, goes on with relative l steps, and closes with z.
function pathOf(rings) {
  return rings.map(ring => {
    const steps = ring.slice(1).flatMap((p, i) => [p[0] - ring[i][0], p[1] - ring[i][1]]);
    return `M${numbers(ring[0])}l${numbers(steps)}z`;
  }).join('');
}

// Depot anchors, centres and connection samples keep two decimals: at 0.1 px the pointer angle along the short
// Colombo connection would be off by up to 30 degrees.
const point = ([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
const quote = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const pair = ([x, y]) => `[${x},${y}]`;

// ---- The fleet map ----

const problems = [];
const straight = [];
const fleet = Object.entries(VIEWS).map(([view, { box, depots }]) => {
  const proj = project(box, FLEET);
  const served = new Set(depots.flatMap(depot => [...servedBy.get(depot)]));
  const districts = features.map(feature => {
    const name = districtName(feature);
    const rings = ringsOf(feature)
      .map(ring => clipped(ring.map(proj), FLEET))
      .filter(ring => ring.length > 2)
      .map(ring => tenths(simplify(ring, FLEET_TOLERANCE)))
      .filter(ring => ring !== null);
    return { name, d: pathOf(rings), served: served.has(name), centre: point(proj(centres.get(name))) };
  });
  const pairs = depots.flatMap(depot => [...servedBy.get(depot)].map(district => ({ depot, district })))
    .sort((a, b) => (a.district < b.district ? -1 : a.district > b.district ? 1 : a.depot < b.depot ? -1 : 1));
  const connections = pairs.map(({ depot, district }) => {
    const a = DEPOT_ANCHORS[depot];
    const b = centres.get(district);
    // Like the design, a curve that leaves land falls back to a straight line, which must then stay on land.
    let control = controlPoint(a, b, district);
    if (!sample(a, control, b, 240).every(onLand)) {
      control = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      straight.push(`${view}: ${depot} to ${district}`);
    }
    const offLand = sample(a, control, b, 240).filter(p => !onLand(p)).length;
    if (offLand > 0) problems.push(`${view}: ${depot} to ${district} leaves land at ${offLand} of 241 samples`);
    return { depot, district, points: sample(a, control, b, 40).map(p => point(proj(p))) };
  });
  return { view, districts, depots: depots.map(name => ({ name, at: point(proj(DEPOT_ANCHORS[name])) })), connections };
});

if (problems.length > 0) {
  console.error(`A connection leaves land, so nothing was written:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

// ---- The sign-in artwork ----

// One north-up Mercator fit of every point of every district, inside the padding, as build-login-artwork.py.
function fitAll(rings, { width, height, padding }) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    for (const p of ring) {
      const [x, y] = merc(p);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  const s = Math.min((width - 2 * padding) / (x1 - x0), (height - 2 * padding) / (y1 - y0));
  const ox = (width - (x1 - x0) * s) / 2;
  const oy = (height - (y1 - y0) * s) / 2;
  return p => { const [x, y] = merc(p); return [ox + (x - x0) * s, oy + (y1 - y) * s]; };
}

const artProj = fitAll(landRings, ARTWORK);
const servedAnywhere = new Set([...servedBy.values()].flatMap(set => [...set]));
const artwork = features.map(feature => {
  const rings = ringsOf(feature).map(ring => tenths(simplify(ring.map(artProj), ARTWORK_TOLERANCE))).filter(ring => ring !== null);
  return { name: districtName(feature), d: pathOf(rings), served: servedAnywhere.has(districtName(feature)) };
});

// ---- Writing the modules ----

const SOURCE = `// Derived district shapes for Sri Lanka: schematic, not GPS. Source: geoBoundaries gbOpen Sri Lanka ADM2,
// boundary year 2017, pinned at
// https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/LKA/ADM2/geoBoundaries-LKA-ADM2.geojson
// (c) OpenStreetMap contributors. Open Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright
// These derived shapes stay under the ODbL. Depot anchors are OpenStreetMap Nominatim town centres, (c) OpenStreetMap
// contributors, ODbL 1.0. More in docs/map-data.md.
//
// Generated by scripts/map-shapes.mjs. Do not edit by hand: download the GeoJSON above and run
//   node scripts/map-shapes.mjs <path to districts.geojson>
`;

const fleetModule = `${SOURCE}//
// The dispatcher dashboard's fleet map, as the design's build-fleet-map.py draws it: one 340 x 280 frame per view,
// north-up Mercator fitted to the view's box, every district's rings clipped to the frame (a district the view
// cuts off has an empty d), simplified at ${FLEET_TOLERANCE} px and rounded to 0.1 px. Coordinates are frame pixels.
// served: the view's depots have shops in the district (data/shared/outlets.csv). centre: the centroid of the
// district's largest ring, which can fall outside the frame for a district the view cuts off. Each connection is the
// design's curve from a depot anchor to a district it serves, checked to stay on land at 241 samples, and given as 41
// evenly spaced samples (t = i / 40) for pointAt and angleAt in ./geometry.

export type MapView = 'Peliyagoda' | 'Kandy' | 'Both';

export const FLEET_MAP_SIZE = { width: ${FLEET.width}, height: ${FLEET.height} } as const;

export const FLEET_MAP: Record<MapView, {
  districts: { name: string; d: string; served: boolean; centre: [number, number] }[];
  depots: { name: 'Peliyagoda' | 'Kandy'; at: [number, number] }[];
  connections: { depot: 'Peliyagoda' | 'Kandy'; district: string; points: [number, number][] }[];
}> = {
${fleet.map(({ view, districts, depots, connections }) => `  ${view}: {
    districts: [
${districts.map(d => `      { name: ${quote(d.name)}, served: ${d.served}, centre: ${pair(d.centre)}, d: ${quote(d.d)} },`).join('\n')}
    ],
    depots: [
${depots.map(depot => `      { name: ${quote(depot.name)}, at: ${pair(depot.at)} },`).join('\n')}
    ],
    connections: [
${connections.map(c => `      { depot: ${quote(c.depot)}, district: ${quote(c.district)}, points: [${c.points.map(pair).join(',')}] },`).join('\n')}
    ],
  },`).join('\n')}
};
`;

const artworkModule = `${SOURCE}//
// The sign-in artwork, as the design's build-login-artwork.py draws it: all 25 districts in one north-up Mercator
// fit of a 600 x 660 frame with 12 px padding, simplified at ${ARTWORK_TOLERANCE} px and rounded to 0.1 px. served: either
// depot has shops in the district (data/shared/outlets.csv).

export const ARTWORK_SIZE = { width: ${ARTWORK.width}, height: ${ARTWORK.height} } as const;

export const ARTWORK_DISTRICTS: { name: string; d: string; served: boolean }[] = [
${artwork.map(d => `  { name: ${quote(d.name)}, served: ${d.served}, d: ${quote(d.d)} },`).join('\n')}
];
`;

const modules = [[FLEET_FILE, fleetModule], [ARTWORK_FILE, artworkModule]];
for (const [file, text] of modules) {
  const bytes = Buffer.byteLength(text);
  console.log(`${fileURLToPath(file).slice(fileURLToPath(repo).length)}: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
}
if (modules.some(([, text]) => Buffer.byteLength(text) > MAX_BYTES)) {
  console.error(`A module is over ${MAX_BYTES / 1024} KB, so nothing was written.`);
  process.exit(1);
}
for (const [file, text] of modules) writeFileSync(file, text);
const connections = fleet.reduce((sum, { connections: list }) => sum + list.length, 0);
console.log(`${connections} connections, each on land at all 241 samples.`);
if (straight.length > 0) console.log(`Drawn straight because the curve left land:\n  ${straight.join('\n  ')}`);
