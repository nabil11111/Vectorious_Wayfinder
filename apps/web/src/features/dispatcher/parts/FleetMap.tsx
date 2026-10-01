import type { CSSProperties, ReactNode } from 'react';
import { BOTH_DEPOTS } from '@wayfinder/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { ICON } from '@/features/live/parts/icons';
import { CARD } from '@/features/live/parts/ui';
import { truckName } from '@/features/loader/words';
import { FLEET_MAP, FLEET_MAP_SIZE, type MapView } from '@/lib/map/fleet-map-shapes';
import { cn } from '@/lib/utils';
import { useSwitchDepot } from '../depots';
import { CARD_SIZE, OCEAN_LABEL, VIEWS, deliveredList, drawingOf, liveLine, statsOf, type MapDrawing, type MapRead } from './fleet-map';

// One of the frame's pixels. The wide card sets it to its own width over 520, so it is the frame scaled to its column
// and never scrolls sideways, up to one and a half times the frame; the narrow card sets it to 1px.
const u = (n: number) => `calc(var(--u) * ${n})`;
const WIDE_UNIT = `min(calc(100cqw / ${CARD_SIZE.width}), 1.5px)`;
// Where the script puts a node: x and y from the card's corner, and its size when it has one.
const at = (x: number, y: number, width?: number, height?: number): CSSProperties =>
  ({ position: 'absolute', left: u(x), top: u(y), width: width === undefined ? undefined : u(width), height: height === undefined ? undefined : u(height) });
// The same node held to the card's right edge, where the frame's right side is: when the card is wider than the frame
// at one and a half times, the header's right half stays at the right and the list takes the width.
const atRight = (x: number, y: number, width: number, height?: number): CSSProperties =>
  ({ position: 'absolute', right: u(CARD_SIZE.width - x - width), top: u(y), width: u(width), height: height === undefined ? undefined : u(height) });
// A key's place across the card, as a share of the frame's width.
const across = (x: number, y: number): CSSProperties => ({ position: 'absolute', left: `${(100 * x) / CARD_SIZE.width}%`, top: u(y) });
// The script's text: Inter at a size, on a line 1.3 times as tall rounded up, at a weight. Colours are the map tokens.
const type = (size: number, weight = 400): CSSProperties =>
  ({ display: 'block', fontSize: u(size), lineHeight: u(Math.ceil(size * 1.3)), fontWeight: weight, whiteSpace: 'nowrap' });

// In the map's pixels: the baseline of an SVG text whose box the script puts at y, half the spare line height above
// Inter's ascent and descent (0.96875 and 0.2412 of the size), where Figma and CSS both put it.
const baseline = (y: number, size: number) => y + (Math.ceil(size * 1.3) - 1.20996 * size) / 2 + 0.96875 * size;
const n2 = (n: number) => n.toFixed(2);
const pathOf = (points: readonly (readonly [number, number])[]) => points.map((p, i) => `${i ? 'L' : 'M'}${n2(p[0])} ${n2(p[1])}`).join(' ');

// The map's view is the depot the read is for, the one the dispatcher chose (D-93), or Both, which draws both depots
// together (spec 021). A view the shapes do not have gets no drawing, and says so.
const viewOf = (view: string): MapView | null => (view === 'Peliyagoda' || view === 'Kandy' || view === 'Both' ? view : null);
type Drawing = MapDrawing & { ocean: readonly [number, number] | null };

// The dashboard's district map (spec 019), the card right of Needs you on Dispatcher · Dashboard (53:11540), as the
// design's map-fleet-overview.js draws it, with the live day's numbers (D-92). From 640 wide it is the frame's card
// scaled to its column; below that its parts stack, the list under the map. Hover details are not built. view is the
// depot on show, or Both; read is what the card draws, null until every depot's day is read, and failed says one could
// not be.
export function FleetMap({ view, read, failed = false }: { view: string; read: MapRead | null; failed?: boolean }) {
  if (!read) return <WaitingMap view={view} failed={failed} />;
  const mapView = viewOf(read.view);
  const drawing: Drawing | null = mapView && { ...drawingOf(read, FLEET_MAP[mapView]), ocean: OCEAN_LABEL[mapView] };
  const list = deliveredList(read.map);
  const stats = statsOf(read);
  const last = VIEWS[VIEWS.length - 1];
  return (
    <section aria-label="District map" className={cn(CARD, '@container overflow-hidden')}>
      <div data-layout="wide" className="relative hidden sm:block" style={{ '--u': WIDE_UNIT, height: u(CARD_SIZE.height) } as CSSProperties}>
        <h2 className="font-sans text-map-title" style={{ ...at(16, 15), ...type(14, 600) }}>{liveLine(read)}</h2>
        {/* "Map view" ends 12 px before the switch, which ends 26 px from the card's right edge. */}
        <div className="flex items-start justify-end" style={{ ...atRight(222, 11, last.x + last.width - 222), gap: u(12) }}>
          <span className="text-map-muted" style={{ ...type(9), marginTop: u(9) }}>Map view</span>
          <ViewSwitch depot={read.view} />
        </div>
        <span className="text-map-stores" style={{ ...at(16, 51), ...type(11, 600) }}>{stats.stores}</span>
        <span className="text-map-muted" style={{ ...at(108, 51), ...type(11) }}>{stats.vehicles}</span>
        <span className="text-map-muted" style={{ ...at(214, 51), ...type(11) }}>{stats.routes}</span>
        <ActiveChip active={stats.active} style={atRight(399, 48, 105)} />
        <MapPicture drawing={drawing} read={read} style={at(0, 77, FLEET_MAP_SIZE.width, FLEET_MAP_SIZE.height)} />
        <span aria-hidden="true" className="bg-map-divider" style={at(340, 77, 1, FLEET_MAP_SIZE.height)} />
        <Delivered list={list} style={{ ...at(354, 88), right: u(CARD_SIZE.width - 354 - 153) }} />
        <KeyItem style={across(16, 357)} sign={<VehicleKey style={at(0, 7)} />} words="Vehicle" gap={17} />
        <KeyItem style={across(117, 357)} sign={<TripKey style={at(0, 8)} />} words="Second trip" gap={17} />
        <KeyItem style={across(248, 357)} sign={<DepotKey style={at(0, 9)} />} words="Warehouse" gap={17} />
        <KeyItem style={across(398, 357)} sign={<RouteKey style={at(0, 14)} />} words="Shared route" gap={19} />
        <Source style={at(16, 386)} />
      </div>

      <div data-layout="narrow" className="pb-3 sm:hidden" style={{ '--u': '1px' } as CSSProperties}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 px-4 pt-[15px]">
          <h2 className="font-sans text-map-title" style={type(14, 600)}>{liveLine(read)}</h2>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="text-map-muted" style={type(9)}>Map view</span>
            <ViewSwitch depot={read.view} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-4">
          <span className="text-map-stores" style={type(11, 600)}>{stats.stores}</span>
          <span className="text-map-muted" style={type(11)}>{stats.vehicles}</span>
          <span className="text-map-muted" style={type(11)}>{stats.routes}</span>
          <ActiveChip active={stats.active} className="ml-auto" />
        </div>
        <MapPicture drawing={drawing} read={read} className="mt-3 block aspect-[340/280] h-auto w-full" />
        <Delivered list={list} className="px-4 pt-[11px]" />
        <ul aria-label="Map key" className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2 px-4">
          <li className="flex items-center gap-[7px]"><VehicleKey /><span className="text-map-muted" style={type(9)}>Vehicle</span></li>
          <li className="flex items-center gap-[7px]"><TripKey /><span className="text-map-muted" style={type(9)}>Second trip</span></li>
          <li className="flex items-center gap-[7px]"><DepotKey /><span className="text-map-muted" style={type(9)}>Warehouse</span></li>
          <li className="flex items-center gap-[7px]"><RouteKey /><span className="text-map-muted" style={type(9)}>Shared route</span></li>
        </ul>
        <Source className="mt-2.5 px-4" wrap />
      </div>
    </section>
  );
}

// The card before its map can be drawn: a day still on its way, or one that could not be read. The drawing and its
// figures need every depot's day, but the Map view switch stays, as it is the only depot switch below 1280 wide.
function WaitingMap({ view, failed }: { view: string; failed: boolean }) {
  return (
    <section aria-label="District map" className={cn(CARD, 'px-4 pt-[15px] pb-4')} style={{ '--u': '1px' } as CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
        {failed ? <h2 className="font-sans text-map-title" style={type(14, 600)}>District map</h2> : <Skeleton className="h-3.5 w-24 rounded-full" />}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="text-map-muted" style={type(9)}>Map view</span>
          <ViewSwitch depot={view} />
        </div>
      </div>
      {failed ? (
        <p className="mt-3 text-xs leading-4 text-muted-foreground">{view === BOTH_DEPOTS ? 'The map shows once both depots\' days are read.' : 'The map shows once the day is read.'}</p>
      ) : (
        <div role="status" aria-label="Loading the district map" className="mt-3">
          <Skeleton className="aspect-[340/280] w-full rounded-[10px]" />
        </div>
      )}
    </section>
  );
}

// "Map view": the view the card draws chosen, and the others buttons that switch every page to them, as the top bar's
// switch does (D-93), Both included (spec 021). This is how a dispatcher switches below 1280 wide, where the top bar
// hides its switch. A button centres its words, so the box puts them where the frame does, 7 px from the top.
function ViewSwitch({ depot }: { depot: string }) {
  const { chosen, switching, choose } = useSwitchDepot(depot);
  return (
    <div role="group" aria-label="Map view" aria-busy={switching} className="flex shrink-0" style={{ gap: u(3) }}>
      {VIEWS.map((view) => {
        const box: CSSProperties = { ...type(10, 600), display: 'flex', alignItems: 'flex-start', width: u(view.width), height: u(29), borderRadius: u(6), paddingLeft: u(view.inset), paddingTop: u(7) };
        return (
          <button key={view.name} type="button" aria-pressed={view.name === chosen} onClick={() => choose(view.name)} style={box}
            className={cn('shrink-0 outline-none focus-visible:ring-3 focus-visible:ring-ring/50', view.name === chosen ? 'bg-map-chosen text-white' : 'bg-map-option text-map-option-ink')}>
            {view.name}
          </button>
        );
      })}
    </div>
  );
}

// "12 active": the trucks out now, the same number as the tile, beside the design's lorry.
function ActiveChip({ active, style, className }: { active: string; style?: CSSProperties; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center bg-map-active-tint', className)} style={{ ...style, width: u(105), height: u(23), borderRadius: u(5), paddingLeft: u(6), gap: u(7) }}>
      <img src={ICON.trucks} alt="" className="shrink-0 object-contain" style={{ width: u(16), height: u(16) }} />
      <span className="text-map-active-ink" style={type(10, 600)}>{active}</span>
    </span>
  );
}

// The 340 by 280 map in the script's order: sea, districts, lines, arrows, the trip badges, district names and line
// ends, the depot and "INDIAN OCEAN" last, where the view has sea enough for it.
function MapPicture({ drawing, read, style, className }: { drawing: Drawing | null; read: MapRead; style?: CSSProperties; className?: string }) {
  const { width, height } = FLEET_MAP_SIZE;
  const trips = drawing?.arrows.map((arrow) => `${truckName(arrow)} to ${arrow.district}`) ?? [];
  const words = `${read.whose} districts on a schematic map. ${trips.length ? `On the road: ${trips.join(', ')}.` : 'No truck on the road.'}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={drawing ? words : `No district map for ${read.name}.`} className={className} style={style}>
      <rect width={width} height={height} className="fill-map-sea" />
      {drawing ? (
        <>
          {drawing.districts.map((district) => (
            <path key={district.name} d={district.d} strokeWidth={0.85} className={cn('stroke-white', district.served ? 'fill-map-served' : 'fill-map-unserved')} />
          ))}
          {drawing.lines.map((line) => (
            <path key={line.district} data-line={line.district} d={pathOf(line.points)} fill="none" strokeWidth={1.1} strokeOpacity={line.active ? 0.78 : 0.5} strokeLinecap="round"
              className={line.active ? 'stroke-map-line' : 'stroke-map-line-muted'} />
          ))}
          {drawing.arrows.map((arrow) => (
            <g key={arrow.tripId} data-vehicle={arrow.vehicleId} transform={`translate(${n2(arrow.at[0])} ${n2(arrow.at[1])}) rotate(${n2(arrow.rotate)})`}>
              <path d="M0 -4.8L3.6 3.8L0 2L-3.6 3.8Z" strokeWidth={0.9} strokeLinejoin="round" className="fill-map-arrow stroke-white" />
            </g>
          ))}
          {drawing.arrows.filter((arrow) => arrow.tripNo > 1).map((arrow) => (
            <g key={`${arrow.tripId} trip`} data-badge={arrow.vehicleId}>
              <rect x={n2(arrow.at[0] - 13)} y={n2(arrow.at[1] - 6)} width={9} height={10} rx={3} className="fill-white" />
              <text x={n2(arrow.at[0] - 11)} y={n2(baseline(arrow.at[1] - 6.5, 8))} fontSize={8} fontWeight={600} className="fill-map-badge-ink">{arrow.tripNo}</text>
            </g>
          ))}
          {drawing.ends.map((end) => (
            <g key={end.name}>
              {end.label && <text x={n2(end.label[0])} y={n2(baseline(end.label[1], 9))} fontSize={9} fontWeight={500} className="fill-map-label">{end.name}</text>}
              <rect x={n2(end.centre[0] - 1)} y={n2(end.centre[1] - 1)} width={2} height={2} rx={1} className="fill-map-end" />
            </g>
          ))}
          {drawing.depots.map((place) => (
            <g key={place.name}>
              <Diamond x={place.at[0] - 5} y={place.at[1] - 5} />
              {place.label && <text x={n2(place.label[0])} y={n2(baseline(place.label[1], 9))} fontSize={9} fontWeight={600} className="fill-map-heading">{place.name}</text>}
            </g>
          ))}
          {drawing.ocean && <text x={drawing.ocean[0]} y={n2(baseline(drawing.ocean[1], 7))} fontSize={7} className="fill-map-ocean">INDIAN OCEAN</text>}
        </>
      ) : <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={11} className="fill-map-muted">No district map for {read.name}.</text>}
    </svg>
  );
}

// The depot: the script's 10 px diamond with a white square in it.
function Diamond({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${n2(x)} ${n2(y)})`}>
      <path d="M5 .6L9.4 5L5 9.4L.6 5Z" strokeWidth={0.9} strokeLinejoin="round" className="fill-map-depot stroke-white" />
      <rect x={4} y={4} width={2} height={2} rx={0.3} className="fill-white" />
    </g>
  );
}

// Stores delivered: the total, then each district by name with "7/24" and its bar.
function Delivered({ list, style, className }: { list: ReturnType<typeof deliveredList>; style?: CSSProperties; className?: string }) {
  return (
    <div className={className} style={style}>
      <h3 className="font-sans text-map-heading" style={type(11, 600)}>Stores delivered</h3>
      <p className="text-map-note" style={{ ...type(9), marginTop: u(3) }}>{list.total}</p>
      <ul style={{ marginTop: u(10) }}>
        {list.rows.map((row) => (
          <li key={row.district} className="relative" style={{ height: u(list.rowHeight) }}>
            <span className="text-map-district" style={type(9)}>{row.district}</span>
            <span className="absolute top-0 right-0 text-map-count" style={type(9, 600)}>{row.count}</span>
            {list.bars && (
              <span role="meter" aria-label={`${row.district} stores delivered`} aria-valuemin={0} aria-valuemax={row.shops}
                aria-valuenow={row.delivered ?? undefined} aria-valuetext={row.delivered === null ? 'not recorded' : undefined}
                className="absolute inset-x-0 block overflow-hidden bg-map-track" style={{ top: u(17), height: u(2), borderRadius: u(1) }}>
                {row.delivered !== null && row.delivered > 0 && row.shops > 0 && (
                  <span className="block h-full bg-map-bar" style={{ width: `${(100 * row.delivered) / row.shops}%`, borderRadius: u(1) }} />
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// One sign of the wide card's key with its words, which start `gap` px after the sign's left edge as the frame's do.
function KeyItem({ style, sign, words, gap }: { style: CSSProperties; sign: ReactNode; words: string; gap: number }) {
  return (
    <span className="block" style={style}>
      {sign}
      <span className="text-map-muted" style={{ ...at(gap, 8), ...type(9) }}>{words}</span>
    </span>
  );
}

// The key's four signs, as the script draws them.
const VehicleKey = ({ style }: { style?: CSSProperties }) => (
  <svg aria-hidden="true" viewBox="0 0 10 15" className="shrink-0" style={{ ...style, width: u(10), height: u(15) }}><path d="M5 2L9 12L5 10L1 12Z" className="fill-map-arrow" /></svg>
);
const TripKey = ({ style }: { style?: CSSProperties }) => (
  <span aria-hidden="true" className="shrink-0 bg-map-badge-tint text-map-badge-ink" style={{ ...type(9, 600), ...style, width: u(10), height: u(13), borderRadius: u(3), paddingLeft: u(2) }}>2</span>
);
const DepotKey = ({ style }: { style?: CSSProperties }) => (
  <svg aria-hidden="true" viewBox="0 0 10 10" className="shrink-0" style={{ ...style, width: u(10), height: u(10) }}><Diamond x={0} y={0} /></svg>
);
const RouteKey = ({ style }: { style?: CSSProperties }) => (
  <span aria-hidden="true" className="block shrink-0 bg-map-line" style={{ ...style, width: u(12), height: u(1) }} />
);

// The script's source line, with the credit the district outlines need (D-92, docs/map-data.md).
function Source({ style, className, wrap = false }: { style?: CSSProperties; className?: string; wrap?: boolean }) {
  return (
    <p className={cn('text-map-muted', className)} style={{ ...type(8.5), ...(wrap ? { whiteSpace: 'normal' } : {}), ...style }}>
      Schematic district routes · not GPS ·{' '}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline underline-offset-2">© OpenStreetMap contributors</a>
    </p>
  );
}
