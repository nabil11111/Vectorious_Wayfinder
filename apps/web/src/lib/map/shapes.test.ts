import { describe, expect, it } from 'vitest';
import outletsCsv from '../../../../../data/shared/outlets.csv?raw';
import { FLEET_MAP, FLEET_MAP_SIZE, type MapView } from './fleet-map-shapes';
import { angleAt, pointAt } from './geometry';
import { ARTWORK_DISTRICTS, ARTWORK_SIZE } from './login-artwork-shapes';

// scripts/map-shapes.mjs generates the two shape modules from the design's district boundaries and code. The
// reference numbers below were printed by the design's own Python (build-fleet-map.py and build-login-artwork.py)
// on the same boundaries, so these tests hold the modules to the Figma frames.

type Point = readonly [number, number];
type Depot = 'Peliyagoda' | 'Kandy';

const [header, ...rows] = outletsCsv.trim().split(/\r?\n/).map(line => line.split(','));
const depotColumn = header.indexOf('depot');
const districtColumn = header.indexOf('district');
const districtsServedBy = (depots: readonly string[]) =>
  new Set(rows.filter(row => depots.includes(row[depotColumn])).map(row => row[districtColumn]));

const DEPOTS_IN: Record<MapView, readonly Depot[]> = { Peliyagoda: ['Peliyagoda'], Kandy: ['Kandy'], Both: ['Peliyagoda', 'Kandy'] };
const VIEWS = Object.keys(DEPOTS_IN) as MapView[];

// What build-fleet-map.py's projection gives for each view's 340 x 280 frame: the depot anchors, one served district
// centre and one that is not served.
const FLEET_REFERENCES: Record<MapView, { depots: Partial<Record<Depot, Point>>; centres: Record<string, Point> }> = {
  Peliyagoda: { depots: { Peliyagoda: [118.4139, 159.4402] }, centres: { Colombo: [132.1486, 168.868], Ratnapura: [186.5429, 197.1717] } },
  Kandy: { depots: { Kandy: [175.7221, 161.0292] }, centres: { Kandy: [187.9237, 164.3573], Polonnaruwa: [239.5829, 45.4973] } },
  Both: {
    depots: { Peliyagoda: [104.4746, 159.4402], Kandy: [179.4624, 126.3517] },
    centres: { Matara: [170.0267, 241.747], Hambantota: [225.5552, 229.9852] },
  },
};
// Where build-fleet-map.py's connection is halfway along (t = 0.5): the inland bends for Colombo, Gampaha, Puttalam
// and Kandy, and two plain curves.
const MIDPOINT_REFERENCES: Record<MapView, Record<string, Point>> = {
  Peliyagoda: { Colombo: [137.7783, 168.3165], Gampaha: [139.7339, 142.8866], Puttalam: [125.9931, 108.7824], Galle: [136.8556, 196.5693] },
  Kandy: { Kandy: [203.2705, 142.1005], Badulla: [209.1947, 178.9357] },
  Both: { Kandy: [196.2571, 114.812], Puttalam: [112.0538, 108.7824] },
};
// What build-login-artwork.py's projection gives for the first point of these districts in the 600 x 660 artwork.
const ARTWORK_REFERENCES: Record<string, Point> = {
  Colombo: [156.0885, 476.3931],
  Hambantota: [284.7629, 585.3938],
  Trincomalee: [300.1611, 158.5048],
};

// The vertices of an SVG path, ring by ring. Reads M, L, H, V and Z, absolute and relative.
function ringsOf(d: string): Point[][] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const rings: Point[][] = [];
  const clean = (value: number) => Math.round(value * 1e6) / 1e6;
  let at: Point = [0, 0];
  let command = '';
  for (let i = 0; i < tokens.length;) {
    if (/[A-Za-z]/.test(tokens[i])) {
      command = tokens[i++];
      if (command === 'Z' || command === 'z') { at = rings[rings.length - 1][0]; continue; }
    }
    const [baseX, baseY] = command === command.toLowerCase() ? at : [0, 0];
    const next = () => Number(tokens[i++]);
    switch (command.toUpperCase()) {
      case 'M': at = [clean(baseX + next()), clean(baseY + next())]; rings.push([at]); command = command === 'm' ? 'l' : 'L'; break;
      case 'L': at = [clean(baseX + next()), clean(baseY + next())]; rings[rings.length - 1].push(at); break;
      case 'H': at = [clean(baseX + next()), at[1]]; rings[rings.length - 1].push(at); break;
      case 'V': at = [at[0], clean(baseY + next())]; rings[rings.length - 1].push(at); break;
      default: throw new Error(`Unexpected path command ${command} in ${d.slice(0, 40)}`);
    }
  }
  return rings;
}

const outside = (points: readonly Point[], size: { width: number; height: number }) =>
  points.filter(([x, y]) => !(x >= 0 && x <= size.width && y >= 0 && y <= size.height));

function expectNear(actual: Point | undefined, expected: Point) {
  expect(actual).toBeDefined();
  expect(Math.hypot(actual![0] - expected[0], actual![1] - expected[1])).toBeLessThanOrEqual(0.15);
}

describe('fleet map shapes', () => {
  it('has the three map views, each drawing all 25 districts once', () => {
    expect(Object.keys(FLEET_MAP).sort()).toEqual([...VIEWS].sort());
    const names = ARTWORK_DISTRICTS.map(district => district.name).sort();
    for (const view of VIEWS) {
      expect(FLEET_MAP[view].districts).toHaveLength(25);
      expect(FLEET_MAP[view].districts.map(district => district.name).sort()).toEqual(names);
    }
  });

  it('marks as served exactly the districts where the view\'s depots have shops', () => {
    for (const view of VIEWS) {
      const served = FLEET_MAP[view].districts.filter(district => district.served).map(district => district.name);
      expect(new Set(served)).toEqual(districtsServedBy(DEPOTS_IN[view]));
    }
  });

  it('places each view\'s own depots and nothing else', () => {
    for (const view of VIEWS) expect(FLEET_MAP[view].depots.map(depot => depot.name)).toEqual(DEPOTS_IN[view]);
  });

  it('keeps every point inside its frame, and every ring has at least three points', () => {
    for (const view of VIEWS) {
      const { districts, depots, connections } = FLEET_MAP[view];
      const rings = districts.flatMap(district => ringsOf(district.d));
      expect(rings.filter(ring => ring.length < 3)).toEqual([]);
      expect(outside(rings.flat(), FLEET_MAP_SIZE)).toEqual([]);
      expect(outside(depots.map(depot => depot.at), FLEET_MAP_SIZE)).toEqual([]);
      expect(outside(districts.filter(district => district.served).map(district => district.centre), FLEET_MAP_SIZE)).toEqual([]);
      expect(outside(connections.flatMap(connection => connection.points), FLEET_MAP_SIZE)).toEqual([]);
    }
  });

  it('draws every district the view serves', () => {
    for (const view of VIEWS) {
      expect(FLEET_MAP[view].districts.filter(district => district.served && ringsOf(district.d).length === 0)).toEqual([]);
    }
  });

  it('runs one connection from each depot to each district it serves, as 41 samples', () => {
    for (const view of VIEWS) {
      const { districts, depots, connections } = FLEET_MAP[view];
      const expected = DEPOTS_IN[view].flatMap(depot => [...districtsServedBy([depot])].map(district => `${depot} to ${district}`));
      expect(connections.map(connection => `${connection.depot} to ${connection.district}`).sort()).toEqual(expected.sort());
      for (const connection of connections) {
        expect(connection.points).toHaveLength(41);
        expect(connection.points[0]).toEqual(depots.find(depot => depot.name === connection.depot)?.at);
        expect(connection.points[40]).toEqual(districts.find(district => district.name === connection.district)?.centre);
      }
    }
  });

  it('matches the design script\'s projection within 0.15 px', () => {
    for (const view of VIEWS) {
      const { depots, centres } = FLEET_REFERENCES[view];
      for (const [name, at] of Object.entries(depots)) expectNear(FLEET_MAP[view].depots.find(depot => depot.name === name)?.at, at);
      for (const [name, centre] of Object.entries(centres)) {
        expectNear(FLEET_MAP[view].districts.find(district => district.name === name)?.centre, centre);
      }
    }
  });

  it('bends each connection the way the design script does', () => {
    for (const view of VIEWS) {
      for (const [district, middle] of Object.entries(MIDPOINT_REFERENCES[view])) {
        expectNear(FLEET_MAP[view].connections.find(connection => connection.district === district)?.points[20], middle);
      }
    }
  });
});

describe('sign-in artwork shapes', () => {
  it('draws all 25 districts once', () => {
    expect(ARTWORK_DISTRICTS).toHaveLength(25);
    expect(new Set(ARTWORK_DISTRICTS.map(district => district.name)).size).toBe(25);
  });

  it('marks as served exactly the districts where either depot has shops', () => {
    const served = ARTWORK_DISTRICTS.filter(district => district.served).map(district => district.name);
    expect(new Set(served)).toEqual(districtsServedBy(['Peliyagoda', 'Kandy']));
  });

  it('keeps every point inside the artwork, and every ring has at least three points', () => {
    const rings = ARTWORK_DISTRICTS.flatMap(district => ringsOf(district.d));
    expect(rings.filter(ring => ring.length < 3)).toEqual([]);
    expect(outside(rings.flat(), ARTWORK_SIZE)).toEqual([]);
  });

  it('matches the design script\'s projection within 0.15 px', () => {
    for (const [name, first] of Object.entries(ARTWORK_REFERENCES)) {
      const district = ARTWORK_DISTRICTS.find(each => each.name === name);
      expectNear(district && ringsOf(district.d)[0][0], first);
    }
  });
});

describe('pointAt and angleAt', () => {
  const corner: Point[] = [[0, 0], [10, 0], [10, 10]];

  it('walks the samples evenly, from the first point at 0 to the last at 1', () => {
    expect(pointAt(corner, 0)).toEqual([0, 0]);
    expect(pointAt(corner, 0.25)).toEqual([5, 0]);
    expect(pointAt(corner, 0.5)).toEqual([10, 0]);
    expect(pointAt(corner, 0.75)).toEqual([10, 5]);
    expect(pointAt(corner, 1)).toEqual([10, 10]);
  });

  it('keeps t between 0 and 1, and needs two points', () => {
    expect(pointAt(corner, -0.5)).toEqual([0, 0]);
    expect(pointAt(corner, 1.5)).toEqual([10, 10]);
    expect(() => pointAt([[1, 1]], 0.5)).toThrow(RangeError);
  });

  it('gives the turn in degrees for a pointer drawn tip up', () => {
    expect(angleAt(corner, 0.2)).toBeCloseTo(90);
    expect(angleAt(corner, 0.8)).toBeCloseTo(180);
    expect(angleAt([[0, 10], [0, 0]], 0.5)).toBeCloseTo(0);
    expect(angleAt([[10, 0], [0, 0]], 0.5)).toBeCloseTo(270);
  });

  it('looks a hundredth of the way either side, held inside the ends', () => {
    expect(angleAt(corner, 0.5)).toBeCloseTo(135);
    expect(angleAt(corner, 0)).toBeCloseTo(90);
    expect(angleAt(corner, 1)).toBeCloseTo(180);
  });

  it('lands on a connection\'s samples at t = i / 40', () => {
    for (const { points } of FLEET_MAP.Both.connections) {
      points.forEach((sample, i) => {
        const at = pointAt(points, i / 40);
        expect(at[0]).toBeCloseTo(sample[0], 9);
        expect(at[1]).toBeCloseTo(sample[1], 9);
      });
    }
  });
});
