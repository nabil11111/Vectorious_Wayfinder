import { renderToStaticMarkup } from 'react-dom/server';
import { TripTimes } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { StopTip, Timeline } from './Timeline';

// Spec 022's timeline on Edit plan, drawn as the page draws it. It runs from the minute the trip leaves the depot to
// the minute it is back, with the depot at each end (AC-1), and each stop's dot is a button whose small tooltip says
// when the trip is there (AC-2). The trip is the frame's Galle trip of worked examples 3 and 4: it leaves 03:30, makes
// six stops, the last of them Fresh Koggala 5 minutes after it closes, and is back 10:20.

const GALLE = TripTimes.parse({
  district: 'Galle', leaveAt: 210, lastDoneAt: 500, backAt: 620, readyAgainAt: 650, tripMin: 290, km: 136, litres: 30.2,
  stops: [
    { seq: 1, outletId: 'OUT050', arriveAt: 315, waitMin: 15, startAt: 330, leaveAt: 345, windowOpen: 330, windowClose: 480, late: false, lateMin: 0 },
    { seq: 2, outletId: 'OUT051', arriveAt: 365, waitMin: 0, startAt: 365, leaveAt: 385, windowOpen: 180, windowClose: 480, late: false, lateMin: 0 },
    { seq: 3, outletId: 'OUT052', arriveAt: 395, waitMin: 0, startAt: 395, leaveAt: 410, windowOpen: 180, windowClose: 480, late: false, lateMin: 0 },
    { seq: 4, outletId: 'OUT053', arriveAt: 420, waitMin: 0, startAt: 420, leaveAt: 435, windowOpen: 300, windowClose: 450, late: false, lateMin: 0 },
    { seq: 5, outletId: 'OUT054', arriveAt: 455, waitMin: 0, startAt: 455, leaveAt: 470, windowOpen: 180, windowClose: 480, late: false, lateMin: 0 },
    { seq: 6, outletId: 'OUT055', arriveAt: 485, waitMin: 0, startAt: 485, leaveAt: 500, windowOpen: 330, windowClose: 480, late: true, lateMin: 5 },
  ],
});

// Each stop's shop and what is unloaded there, as the trip panel words it.
const SHOPS = new Map([
  ['OUT050', { name: 'Fresh Hikkaduwa', goods: '8 cartons chilled' }],
  ['OUT051', { name: 'Fresh Galle Fort', goods: '10 cartons chilled, 4 dry' }],
  ['OUT052', { name: 'Fresh Karapitiya', goods: '12 cartons chilled' }],
  ['OUT053', { name: 'Fresh Unawatuna', goods: '9 cartons chilled' }],
  ['OUT054', { name: 'Fresh Ahangama', goods: '6 cartons dry' }],
  ['OUT055', { name: 'Fresh Koggala', goods: '12 cartons chilled' }],
]);

const drawn = (times: TripTimes) => renderToStaticMarkup(<Timeline times={times} depot="Peliyagoda" shops={SHOPS} problems={[]} onLeaveAt={() => undefined} />);
// Where a time sits on a line of hours from start to end, from 0 to 100, as the line places it.
const on = (start: number, end: number) => (minutes: number) => ((minutes - start * 60) / ((end - start) * 60)) * 100;
const hoursOf = (markup: string) => [...markup.matchAll(/>(\d\d:\d\d)<\/span>/g)].map(([, hour]) => hour);
const depotMarks = (markup: string) => [...markup.matchAll(/<span aria-hidden="true" data-depot="(start|end)"[^>]*style="left:([\d.]+)%"/g)].map(([, end, left]) => [end, Number(left)]);

it('AC-1 stretches the hours to the return: a trip back at 10:20 is drawn on 03:00 to 11:00', () => {
  expect(hoursOf(drawn(GALLE))).toEqual(['03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00']);
});

it('AC-1 runs the track from the trip\'s leaving time to its return, with a depot mark at each end', () => {
  const markup = drawn(GALLE);
  const at = on(3, 11);
  expect(markup).toContain(`style="left:${at(210)}%;width:${at(620) - at(210)}%"`);
  expect(depotMarks(markup)).toEqual([['start', at(210)], ['end', at(620)]]);
});

it('AC-1 names the depot and its leaving time at the start and the return at the end, in the hours\' mono type', () => {
  const markup = drawn(GALLE);
  const at = on(3, 11);
  // One line from the first mark to the last, the leaving time at its start and the return at its end.
  expect(markup).toContain(`<p class="absolute flex min-w-max justify-between gap-3 font-mono text-[10px] leading-4 text-muted-foreground" style="left:${at(210)}%;width:${at(620) - at(210)}%"><span>Peliyagoda 03:30</span><span>back 10:20</span></p>`);
});

it('AC-1 keeps six hours on the line for a short trip, and its depot ends where it leaves and is back', () => {
  // Spec 010's VEH004 trip: leaves 03:30 and is back 05:24.
  const short = { ...GALLE, backAt: 324, stops: GALLE.stops.slice(0, 1) };
  const markup = drawn(short);
  expect(hoursOf(markup)).toEqual(['03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00']);
  const at = on(3, 9);
  expect(depotMarks(markup)).toEqual([['start', at(210)], ['end', at(324)]]);
  expect(markup).toContain('<span>Peliyagoda 03:30</span><span>back 05:24</span>');
});

// A stop's tooltip as it opens, and its lines.
const tipOf = (seq: number, change: Partial<TripTimes['stops'][number]> = {}) => {
  const time = { ...GALLE.stops[seq - 1]!, ...change };
  const shop = SHOPS.get(time.outletId)!;
  return renderToStaticMarkup(<StopTip time={time} name={shop.name} goods={shop.goods} />);
};
const linesOf = (markup: string) => [...markup.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map(([, text]) => text);

it('AC-2 makes each stop\'s dot a button on the line, in stop order, named for a screen reader', () => {
  const markup = drawn(GALLE);
  const dots = [...markup.matchAll(/<button\b[^>]*aria-label="(Stop [^"]*)"[^>]*>/g)];
  expect(dots.map(([, name]) => name)).toEqual([
    'Stop 1, Fresh Hikkaduwa, arrives 05:15',
    'Stop 2, Fresh Galle Fort, arrives 06:05',
    'Stop 3, Fresh Karapitiya, arrives 06:35',
    'Stop 4, Fresh Unawatuna, arrives 07:00',
    'Stop 5, Fresh Ahangama, arrives 07:35',
    'Stop 6, Fresh Koggala, arrives 08:05, 5 min late',
  ]);
  // Every dot is a plain button a keyboard reaches, sitting where its stop arrives.
  const at = on(3, 11);
  expect(dots.map(([button]) => [button.includes('type="button"'), button.includes('tabindex="-1"'), button.match(/left:([\d.]+)%/)?.[1]])).toEqual(
    GALLE.stops.map((stop) => [true, false, String(at(stop.arriveAt))]),
  );
  // The line that holds them is not hidden from a screen reader, while its track and depot marks are.
  expect(markup).toContain('<div class="relative mt-2 h-4"><div aria-hidden="true"');
  // The frame's dots inside: teal rings, and the late stop's red.
  expect(markup.match(/size-3\.5 border-2 border-good bg-card/g)).toHaveLength(5);
  expect(markup.match(/size-4 bg-bad/g)).toHaveLength(1);
});

it('AC-2 shows a stop\'s number and shop, when it arrives and leaves, its window and what is unloaded, and nothing else', () => {
  expect(linesOf(tipOf(3))).toEqual(['Stop 3 · Fresh Karapitiya', 'arrives 06:35 · leaves 06:50', 'window 03:00 to 08:00', '12 cartons chilled']);
  expect(linesOf(tipOf(2))).toEqual(['Stop 2 · Fresh Galle Fort', 'arrives 06:05 · leaves 06:25', 'window 03:00 to 08:00', '10 cartons chilled, 4 dry']);
});

it('AC-2 adds the wait when the trip waits for the window to open', () => {
  expect(linesOf(tipOf(1))).toEqual(['Stop 1 · Fresh Hikkaduwa', 'arrives 05:15 · waits 15 · leaves 05:45', 'window 05:30 to 08:00', '8 cartons chilled']);
});

it('AC-2 says in the stop\'s red how many minutes a late stop is late, from the checker (worked example 4)', () => {
  const koggala = tipOf(6);
  expect(linesOf(koggala)).toEqual(['Stop 6 · Fresh Koggala', 'arrives 08:05 · leaves 08:20', 'window 05:30 to 08:00', '12 cartons chilled', '5 min late']);
  expect(koggala).toContain('<p class="text-[11px] leading-[15px] font-semibold text-bad">5 min late</p>');
  // A stop the checker has late with no minutes after its window, such as a Fresh shop reached at 08:00, says "late".
  expect(linesOf(tipOf(6, { arriveAt: 480, startAt: 480, leaveAt: 495, lateMin: 0 })).slice(1)).toEqual(['arrives 08:00 · leaves 08:15', 'window 05:30 to 08:00', '12 cartons chilled', 'late']);
});
