import { renderToStaticMarkup } from 'react-dom/server';
import { TripTimes } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { Timeline } from './Timeline';

// Spec 022's timeline on Edit plan, drawn as the page draws it. It runs from the minute the trip leaves the depot to
// the minute it is back, with the depot at each end (AC-1). The trip is the frame's Galle trip of worked example 3:
// it leaves 03:30, makes six stops, the last of them late, and is back 10:20.

const GALLE = TripTimes.parse({
  district: 'Galle', leaveAt: 210, lastDoneAt: 500, backAt: 620, readyAgainAt: 650, tripMin: 290, km: 136, litres: 30.2,
  stops: [
    { seq: 1, outletId: 'OUT050', arriveAt: 315, waitMin: 15, startAt: 330, leaveAt: 345, windowOpen: 330, windowClose: 480, late: false },
    { seq: 2, outletId: 'OUT051', arriveAt: 365, waitMin: 0, startAt: 365, leaveAt: 385, windowOpen: 180, windowClose: 480, late: false },
    { seq: 3, outletId: 'OUT052', arriveAt: 395, waitMin: 0, startAt: 395, leaveAt: 410, windowOpen: 180, windowClose: 480, late: false },
    { seq: 4, outletId: 'OUT053', arriveAt: 420, waitMin: 0, startAt: 420, leaveAt: 435, windowOpen: 300, windowClose: 450, late: false },
    { seq: 5, outletId: 'OUT054', arriveAt: 455, waitMin: 0, startAt: 455, leaveAt: 470, windowOpen: 180, windowClose: 480, late: false },
    { seq: 6, outletId: 'OUT055', arriveAt: 485, waitMin: 0, startAt: 485, leaveAt: 500, windowOpen: 330, windowClose: 480, late: true },
  ],
});

const drawn = (times: TripTimes) => renderToStaticMarkup(<Timeline times={times} depot="Peliyagoda" problems={[]} onLeaveAt={() => undefined} />);
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
