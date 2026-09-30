import type { TripTimes } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { PlanInputError } from './errors';
import { inputFor, outlets } from './testing/shared';
import { budgetMinutes, defaultLeaveAt, timeTrip, timeVehicleDay } from './timeline';
import type { EngineOutlet, PlanSettings, PlanTrip, VehicleTimes } from './types';
import { toClock, toMinutes } from './words';

// A trip from its shops in stop order. The timeline never looks at the orders, so the stops carry none.
const trip = (vehicleId: string, tripNo: number, outletIds: string[], leaveAt?: string): PlanTrip => ({
  vehicleId, tripNo, stops: outletIds.map((outletId) => ({ outletId, orderIds: [] })), ...(leaveAt ? { leaveAt: toMinutes(leaveAt) } : {}),
});

// The chained day (D-08): dry truck VEH012 runs a Fresh trip to Gampaha and then one to Colombo.
const gampaha = trip('VEH012', 1, ['OUT026', 'OUT030', 'OUT028']);
const colombo = trip('VEH012', 2, ['OUT006', 'OUT004', 'OUT007', 'OUT014']);
// The Style trip: two mall shops in Colombo and then a shop with a rear dock.
const style = trip('VEH012', 1, ['OUT015', 'OUT017', 'OUT019']);
// Two shops that no single trip can take: OUT026 is in Gampaha and OUT006 in Colombo.
const twoDistricts = trip('VEH012', 1, ['OUT026', 'OUT006']);

type Parts = { settings?: Partial<PlanSettings>; outlets?: EngineOutlet[] };

// A trip timed the way the checker times it: as its vehicle's only trip of the day, so a trip with no leaving
// time is given one.
const timesOf = (depotId: string, only: PlanTrip, parts: Parts = {}): TripTimes => {
  const [timed] = timeVehicleDay(inputFor(depotId, { ...parts, trips: [only] }), only.vehicleId).trips;
  if (!timed?.times) throw new Error(`${only.vehicleId} trip ${only.tripNo} was not timed`);
  return timed.times;
};
const arrivals = (times: TripTimes) => times.stops.map((stop) => toClock(stop.arriveAt));
// When each trip of a day leaves and when the vehicle is ready again after it.
const leavesAndReady = (day: VehicleTimes) => day.trips.map(({ tripNo, times }) => [tripNo, times && toClock(times.leaveAt), times && toClock(times.readyAgainAt)]);

describe('trip timeline', () => {
  it('AC-6 aims a trip with no leaving time at the opening of its first stop, never before 03:30 with a Fresh stop or 07:30 without one', () => {
    const leaves = (outletIds: string[], settings?: Partial<PlanSettings>) =>
      toClock(defaultLeaveAt(inputFor('Peliyagoda', { settings }), trip('VEH012', 1, outletIds), null));
    // OUT005 (Fresh) opens at 04:00, and Colombo is 24 minutes from the depot.
    expect(leaves(['OUT005'])).toBe('03:36');
    // OUT006 (Fresh) opens at 03:00, which would mean leaving at 02:36.
    expect(leaves(['OUT006'])).toBe('03:30');
    // OUT057 (Style) opens at 09:00, and Galle is 103 minutes away, which would mean leaving at 07:17.
    expect(leaves(['OUT057'])).toBe('07:30');
    // One Fresh stop anywhere on the trip is enough for 03:30: with OUT051 (Fresh, Galle) after it, 07:17 stands.
    expect(leaves(['OUT057', 'OUT051'])).toBe('07:17');

    // A trip with no leaving time is timed from there.
    expect(arrivals(timesOf('Peliyagoda', trip('VEH012', 1, ['OUT005'])))).toEqual(['04:00']);
    expect(arrivals(timesOf('Peliyagoda', trip('VEH012', 1, ['OUT006'])))).toEqual(['03:54']);
    expect(arrivals(timesOf('Peliyagoda', trip('VEH012', 1, ['OUT057'])))).toEqual(['09:13']);

    // The earliest times are settings, one for each brand. OUT058 is a Tech shop in Galle that opens at 09:00.
    const later = { earliestLeave: { Fresh: toMinutes('04:00'), Style: toMinutes('07:30'), Tech: toMinutes('07:20') } };
    expect(leaves(['OUT006'], later)).toBe('04:00');
    expect(leaves(['OUT057'], later)).toBe('07:30');
    expect(leaves(['OUT058'], later)).toBe('07:20');
    // A trip with a Fresh stop goes by the Fresh time even when that is the later one.
    const freshLast = { earliestLeave: { Fresh: toMinutes('07:25'), Style: toMinutes('07:00'), Tech: toMinutes('07:00') } };
    expect(leaves(['OUT057'], freshLast)).toBe('07:17');
    expect(leaves(['OUT057', 'OUT051'], freshLast)).toBe('07:25');
  });

  it('AC-7 uses the leaving time a trip is given, unchanged', () => {
    // OUT005 alone would leave at 03:36.
    const set = (leaveAt: string) => {
      const times = timesOf('Peliyagoda', trip('VEH012', 1, ['OUT005'], leaveAt));
      return [toClock(times.leaveAt), ...arrivals(times)];
    };
    expect(set('05:00')).toEqual(['05:00', '05:24']);
    // Earlier than the vehicle would leave by itself is kept too, down to midnight.
    expect(set('02:00')).toEqual(['02:00', '02:24']);
    expect(set('00:00')).toEqual(['00:00', '00:24']);

    // So is a second trip set to leave before the first is ready again at 06:18. The rules report it (AC-31).
    const input = inputFor('Peliyagoda', { trips: [gampaha, { ...colombo, leaveAt: toMinutes('05:30') }] });
    expect(leavesAndReady(timeVehicleDay(input, 'VEH012'))).toEqual([[1, '03:30', '06:18'], [2, '05:30', '08:16']]);
  });

  it('AC-8 reaches the first stop after the drive to the district and each later stop after the drive between stops', () => {
    // Gampaha is 37 minutes from Peliyagoda and its stops are 9 minutes apart. Unloading takes 15, 15 and 16.
    const first = timesOf('Peliyagoda', gampaha);
    expect([first.district, toClock(first.leaveAt), ...arrivals(first)]).toEqual(['Gampaha', '03:30', '04:07', '04:31', '04:55']);
    // Badulla is 186 minutes from Kandy and its stops are 23 minutes apart.
    const badulla = timesOf('Kandy', trip('VEH044', 1, ['OUT110', 'OUT112', 'OUT111']));
    expect([badulla.district, toClock(badulla.leaveAt), ...arrivals(badulla)]).toEqual(['Badulla', '03:30', '06:36', '07:14', '07:52']);
    // Every stop carries its place on the trip and its shop.
    expect(badulla.stops.map((stop) => [stop.seq, stop.outletId])).toEqual([[1, 'OUT110'], [2, 'OUT112'], [3, 'OUT111']]);
  });

  it('AC-9 records the wait when a vehicle arrives before the window opens, and otherwise starts on arrival', () => {
    // The Style trip reaches OUT017 at 10:07, and its window opens at 10:30.
    const waits = timesOf('Peliyagoda', style).stops.map((stop) => [stop.outletId, toClock(stop.arriveAt), stop.waitMin, toClock(stop.startAt)]);
    expect(waits).toEqual([
      // Arriving just as the window opens is no wait.
      ['OUT015', '09:00', 0, '09:00'],
      ['OUT017', '10:07', 23, '10:30'],
      ['OUT019', '11:37', 0, '11:37'],
    ]);
  });

  it('AC-10 unloads for the allowance of the shop\'s brand and dock type, and leaves the stop when it ends', () => {
    const unloading = (times: TripTimes) => times.stops.map((stop) => [stop.outletId, toClock(stop.startAt), toClock(stop.leaveAt)]);
    // Style at a mall bay is 59 minutes and at a rear dock 38.
    expect(unloading(timesOf('Peliyagoda', style))).toEqual([['OUT015', '09:00', '09:59'], ['OUT017', '10:30', '11:29'], ['OUT019', '11:37', '12:15']]);
    // Fresh at a rear dock is 15 minutes and at the street 16.
    expect(unloading(timesOf('Peliyagoda', gampaha))).toEqual([['OUT026', '04:07', '04:22'], ['OUT030', '04:31', '04:46'], ['OUT028', '04:55', '05:11']]);
    // Tech at the street is 55 minutes and at a rear dock 43.
    expect(unloading(timesOf('Peliyagoda', trip('VEH012', 1, ['OUT023', 'OUT024'])))).toEqual([['OUT023', '09:00', '09:55'], ['OUT024', '10:03', '10:46']]);
  });

  it('AC-11 takes the later opening and the earlier closing of a mall shop\'s window and its mall slot', () => {
    // All 12 mall shops in the data have a slot equal to their window, so OUT017 (slot 10:30 to 12:30) is given
    // another window here.
    const at17 = (open: string, close: string, leaveAt?: string) => {
      const mall = outlets.map((o) => (o.id === 'OUT017' ? { ...o, windowOpen: toMinutes(open), windowClose: toMinutes(close) } : o));
      return timesOf('Peliyagoda', trip('VEH012', 1, ['OUT017'], leaveAt), { outlets: mall }).stops
        .map((stop) => ({ window: `${toClock(stop.windowOpen)} to ${toClock(stop.windowClose)}`, arrives: toClock(stop.arriveAt), waits: stop.waitMin, late: stop.late }));
    };
    // 09:00 to 17:00 with the slot gives the slot. A trip with no leaving time aims at 10:30, not at 09:00.
    expect(at17('09:00', '17:00')).toEqual([{ window: '10:30 to 12:30', arrives: '10:30', waits: 0, late: false }]);
    // Reached at 09:30 the vehicle waits for the mall, and reached after 12:30 it is late, though the shop is open.
    expect(at17('09:00', '17:00', '09:06')).toEqual([{ window: '10:30 to 12:30', arrives: '09:30', waits: 60, late: false }]);
    expect(at17('09:00', '17:00', '12:06')).toEqual([{ window: '10:30 to 12:30', arrives: '12:30', waits: 0, late: false }]);
    expect(at17('09:00', '17:00', '12:07')).toEqual([{ window: '10:30 to 12:30', arrives: '12:31', waits: 0, late: true }]);
    // The shop's own closing time counts when it is the earlier one.
    expect(at17('10:00', '11:30', '11:07')).toEqual([{ window: '10:30 to 11:30', arrives: '11:31', waits: 0, late: true }]);

    // 09:00 to 10:00 never overlaps the slot, so a stop there is late whenever it is reached.
    expect(at17('09:00', '10:00', '09:06')).toMatchObject([{ arrives: '09:30', late: true }]);
    expect(at17('09:00', '10:00', '10:36')).toMatchObject([{ arrives: '11:00', late: true }]);
  });

  it('AC-12 gives when the last stop is done, when the vehicle is back at the depot and when it is ready again', () => {
    const ends = (times: TripTimes) => [toClock(times.lastDoneAt), toClock(times.backAt), toClock(times.readyAgainAt)];
    // Trip 1 of the chained day: done at 05:11, the 37 minutes back to the depot, then 30 minutes to reload.
    expect(ends(timesOf('Peliyagoda', gampaha))).toEqual(['05:11', '05:48', '06:18']);
    // The Style trip, with its wait at OUT017 inside it.
    expect(ends(timesOf('Peliyagoda', style))).toEqual(['12:15', '12:39', '13:09']);
    // The reload minutes are a setting.
    expect(ends(timesOf('Peliyagoda', gampaha, { settings: { reloadMin: 45 } }))).toEqual(['05:11', '05:48', '06:33']);
  });

  it('AC-13 gives the booklet\'s 101 minutes for the Gampaha trip, with no waiting and no drive back', () => {
    // The booklet's two examples: 37 + 9 × 2 + 15 + 15 + 16 = 101, and 24 + 8 × 3 + 16 × 4 = 112.
    expect(timesOf('Peliyagoda', gampaha).tripMin).toBe(101);
    expect(timesOf('Peliyagoda', colombo).tripMin).toBe(112);
    // The 23 minutes the Style trip waits at OUT017 are not counted: 24 + 8 × 2 + 59 + 59 + 38 = 196.
    expect(timesOf('Peliyagoda', style).tripMin).toBe(196);
    // Nor are the 66 minutes a truck waits when it leaves at 03:30 for OUT008, which opens at 05:00: 24 + 15 = 39.
    expect(timesOf('Peliyagoda', trip('VEH012', 1, ['OUT008'], '03:30')).tripMin).toBe(39);
    // We count per stop, the booklet per order: two orders dropped at one stop are unloaded once.
    expect(timesOf('Peliyagoda', { vehicleId: 'VEH012', tripNo: 1, stops: [{ outletId: 'OUT008', orderIds: ['a', 'b'] }] }).tripMin).toBe(39);
  });

  it('AC-14 times a vehicle\'s trips in trip-number order, and a second trip with no leaving time waits for the first to be ready again', () => {
    // The chained day, with trip 2 listed first in the plan and another vehicle's trip beside it. OUT006 opens
    // at 03:00, so by itself trip 2 would leave at 03:30.
    const other = trip('VEH008', 1, ['OUT005']);
    const input = inputFor('Peliyagoda', { trips: [colombo, other, gampaha] });
    const day = timeVehicleDay(input, 'VEH012');
    expect(day.vehicleId).toBe('VEH012');
    expect(leavesAndReady(day)).toEqual([[1, '03:30', '06:18'], [2, '06:18', '09:04']]);
    // The plan is left in the order it came.
    expect(input.plan.trips).toEqual([colombo, other, gampaha]);

    const dayOf = (...trips: PlanTrip[]) => leavesAndReady(timeVehicleDay(inputFor('Peliyagoda', { trips }), 'VEH012'));
    // A second trip whose first shop opens later still aims at the opening: the Style trip leaves at 08:36.
    expect(dayOf(gampaha, { ...style, tripNo: 2 })).toEqual([[1, '03:30', '06:18'], [2, '08:36', '13:09']]);
    // A first trip that cannot be timed gives the second nothing to wait for.
    expect(dayOf(twoDistricts, colombo)).toEqual([[1, null, null], [2, '03:30', '07:28']]);
    // A vehicle with no trips has an empty day.
    expect(timeVehicleDay(input, 'VEH003')).toEqual({ vehicleId: 'VEH003', trips: [] });
  });

  it('times the chained day as the spec writes it out', () => {
    const at = toMinutes;
    expect(timeVehicleDay(inputFor('Peliyagoda', { trips: [gampaha, colombo] }), 'VEH012')).toEqual({
      vehicleId: 'VEH012',
      trips: [
        {
          tripNo: 1,
          times: {
            district: 'Gampaha', leaveAt: at('03:30'),
            stops: [
              { seq: 1, outletId: 'OUT026', arriveAt: at('04:07'), waitMin: 0, startAt: at('04:07'), leaveAt: at('04:22'), windowOpen: at('03:00'), windowClose: at('08:00'), late: false },
              { seq: 2, outletId: 'OUT030', arriveAt: at('04:31'), waitMin: 0, startAt: at('04:31'), leaveAt: at('04:46'), windowOpen: at('03:00'), windowClose: at('08:00'), late: false },
              { seq: 3, outletId: 'OUT028', arriveAt: at('04:55'), waitMin: 0, startAt: at('04:55'), leaveAt: at('05:11'), windowOpen: at('03:00'), windowClose: at('08:00'), late: false },
            ],
            lastDoneAt: at('05:11'), backAt: at('05:48'), readyAgainAt: at('06:18'), tripMin: 101, km: 70, litres: 10.3,
          },
        },
        {
          tripNo: 2,
          times: {
            district: 'Colombo', leaveAt: at('06:18'),
            stops: [
              { seq: 1, outletId: 'OUT006', arriveAt: at('06:42'), waitMin: 0, startAt: at('06:42'), leaveAt: at('06:58'), windowOpen: at('03:00'), windowClose: at('08:00'), late: false },
              { seq: 2, outletId: 'OUT004', arriveAt: at('07:06'), waitMin: 0, startAt: at('07:06'), leaveAt: at('07:22'), windowOpen: at('05:30'), windowClose: at('08:00'), late: false },
              { seq: 3, outletId: 'OUT007', arriveAt: at('07:30'), waitMin: 0, startAt: at('07:30'), leaveAt: at('07:46'), windowOpen: at('05:30'), windowClose: at('08:00'), late: false },
              { seq: 4, outletId: 'OUT014', arriveAt: at('07:54'), waitMin: 0, startAt: at('07:54'), leaveAt: at('08:10'), windowOpen: at('05:30'), windowClose: at('08:00'), late: false },
            ],
            lastDoneAt: at('08:10'), backAt: at('08:34'), readyAgainAt: at('09:04'), tripMin: 112, km: 36, litres: 5.3,
          },
        },
      ],
    });
  });

  it('marks a stop late when it is reached after closing time, and a Fresh shop when it is reached at 08:00 or later', () => {
    const late = (times: TripTimes) => times.stops.map((stop) => [stop.outletId, toClock(stop.arriveAt), toClock(stop.windowClose), stop.late]);
    // OUT010 closes at 07:30. Reached exactly then it is on time, and a minute later it is late.
    expect(late(timesOf('Peliyagoda', trip('VEH012', 1, ['OUT010'], '07:06')))).toEqual([['OUT010', '07:30', '07:30', false]]);
    expect(late(timesOf('Peliyagoda', trip('VEH012', 1, ['OUT010'], '07:07')))).toEqual([['OUT010', '07:31', '07:30', true]]);

    // OUT113 closes at 08:00, the hour by which the booklet wants every Fresh shop reached. Its closing time
    // stays 08:00, and reaching it at 08:00 is late all the same.
    const badulla = ['OUT110', 'OUT112', 'OUT111', 'OUT113'];
    expect(late(timesOf('Kandy', trip('VEH044', 1, badulla, '02:59')))).toEqual([
      ['OUT110', '06:05', '08:00', false], ['OUT112', '06:43', '07:45', false], ['OUT111', '07:21', '08:00', false], ['OUT113', '07:59', '08:00', false],
    ]);
    expect(late(timesOf('Kandy', trip('VEH044', 1, badulla, '03:00')))).toEqual([
      ['OUT110', '06:06', '08:00', false], ['OUT112', '06:44', '07:45', false], ['OUT111', '07:22', '08:00', false], ['OUT113', '08:00', '08:00', true],
    ]);

    // Only Fresh shops have that hour. A Style shop with the same window is on time at 08:00.
    const early = outlets.map((o) => (o.id === 'OUT019' ? { ...o, windowOpen: toMinutes('05:30'), windowClose: toMinutes('08:00') } : o));
    expect(late(timesOf('Peliyagoda', trip('VEH012', 1, ['OUT019'], '07:36'), { outlets: early }))).toEqual([['OUT019', '08:00', '08:00', false]]);
  });

  it('gives no times to a trip with no stops, with stops in more than one district, or with no drive from the plan\'s depot', () => {
    // Asked for the trip alone, and asked for the day of its vehicle, where it is first given a leaving time.
    const untimed = (depotId: string, only: PlanTrip) => {
      const input = inputFor(depotId, { trips: [only] });
      return [timeTrip(input, only, toMinutes('03:30')), timeVehicleDay(input, only.vehicleId)];
    };
    const none = (only: PlanTrip) => [null, { vehicleId: only.vehicleId, trips: [{ tripNo: only.tripNo, times: null }] }];

    const empty = trip('VEH012', 1, []);
    expect(untimed('Peliyagoda', empty)).toEqual(none(empty));
    expect(untimed('Peliyagoda', twoDistricts)).toEqual(none(twoDistricts));
    // OUT084 is in Kandy district, and the data has no drive from Peliyagoda to Kandy.
    const kandy = trip('VEH008', 1, ['OUT084']);
    expect(untimed('Peliyagoda', kandy)).toEqual(none(kandy));
    // It is the plan's depot that counts, so Kandy's own VEH059 cannot be timed in Peliyagoda's plan either.
    const visitor = trip('VEH059', 1, ['OUT084']);
    expect(untimed('Peliyagoda', visitor)).toEqual(none(visitor));
    // In Kandy's plan the same trip is 16 minutes from the depot, and OUT084 opens at 05:30.
    expect(arrivals(timesOf('Kandy', visitor))).toEqual(['05:30']);

    // A leaving time asked for such a trip is still a time of day, never Infinity or NaN.
    const input = inputFor('Peliyagoda');
    for (const untimeable of [empty, twoDistricts, kandy]) {
      expect(Number.isFinite(defaultLeaveAt(input, untimeable, null))).toBe(true);
      expect(Number.isFinite(defaultLeaveAt(input, untimeable, toMinutes('06:18')))).toBe(true);
    }
  });

  it('adds up a vehicle\'s trip minutes as Fresh, or as Style and Tech', () => {
    const minutesOf = (...trips: PlanTrip[]) => {
      const input = inputFor('Peliyagoda', { trips });
      return budgetMinutes(input, timeVehicleDay(input, 'VEH012'));
    };
    // The chained day: the booklet's 101 + 112 = 213 of the 270 Fresh minutes.
    expect(minutesOf(gampaha, colombo)).toEqual({ freshMin: 213, styleTechMin: 0 });
    expect(minutesOf(style)).toEqual({ freshMin: 0, styleTechMin: 196 });
    // One Fresh trip and one Style trip are counted apart.
    expect(minutesOf(gampaha, { ...style, tripNo: 2 })).toEqual({ freshMin: 101, styleTechMin: 196 });
    // Style and Tech share one figure: OUT023 (Tech, street) and OUT024 (Tech, rear dock) are 24 + 8 + 55 + 43 = 130.
    expect(minutesOf(style, trip('VEH012', 2, ['OUT023', 'OUT024']))).toEqual({ freshMin: 0, styleTechMin: 326 });
    // A trip with a Fresh stop counts as a Fresh trip: OUT019 (Style) then OUT006 is 24 + 8 + 38 + 16 = 86.
    expect(minutesOf(trip('VEH012', 1, ['OUT019', 'OUT006']))).toEqual({ freshMin: 86, styleTechMin: 0 });
    // A trip that cannot be timed adds nothing.
    expect(minutesOf(twoDistricts, colombo)).toEqual({ freshMin: 112, styleTechMin: 0 });
    expect(minutesOf()).toEqual({ freshMin: 0, styleTechMin: 0 });
  });

  it('throws an error that names a vehicle, shop or unloading allowance the input does not hold', () => {
    const input = inputFor('Peliyagoda');
    const out005 = trip('VEH012', 1, ['OUT005']);
    const missing: [string, () => unknown][] = [
      ['No vehicle VEH999', () => timeTrip(input, trip('VEH999', 1, ['OUT005']), toMinutes('03:36'))],
      ['No vehicle VEH999', () => timeVehicleDay(input, 'VEH999')],
      ['No shop OUT999', () => timeTrip(input, trip('VEH012', 1, ['OUT005', 'OUT999']), toMinutes('03:36'))],
      ['No shop OUT999', () => defaultLeaveAt(input, trip('VEH012', 1, ['OUT999']), null)],
      ['No shop OUT999', () => timeVehicleDay(inputFor('Peliyagoda', { trips: [trip('VEH012', 1, ['OUT999'])] }), 'VEH012')],
      // OUT005 is a Fresh shop with a rear dock.
      ['No unloading allowance for Fresh at rear_dock', () => timeTrip({ ...input, allowances: input.allowances.filter((row) => row.dockType !== 'rear_dock') }, out005, toMinutes('03:36'))],
    ];
    for (const [named, timing] of missing) {
      expect(timing).toThrow(PlanInputError);
      expect(timing).toThrow(named);
    }
  });
});
