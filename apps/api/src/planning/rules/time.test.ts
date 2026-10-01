import { Problem, type ProblemCode } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { PlanInputError } from '../errors';
import { inputFor, outlets } from '../testing/shared';
import { timeVehicleDay } from '../timeline';
import type { EngineOutlet, PlanInput, PlanSettings, PlanTrip, VehicleTimes } from '../types';
import { toMinutes } from '../words';
import { timeProblems } from './time';

// A trip from its shops in stop order. The time rules never look at the orders, so the stops carry none.
const trip = (vehicleId: string, tripNo: number, outletIds: string[], leaveAt?: string): PlanTrip => ({
  vehicleId, tripNo, stops: outletIds.map((outletId) => ({ outletId, orderIds: [] })), ...(leaveAt ? { leaveAt: toMinutes(leaveAt) } : {}),
});

// The chained day (D-08): dry truck VEH012 runs a Fresh trip to Gampaha and is ready again at 06:18, then one
// to Colombo.
const gampaha = trip('VEH012', 1, ['OUT026', 'OUT030', 'OUT028']);
const colombo = trip('VEH012', 2, ['OUT006', 'OUT004', 'OUT007', 'OUT014']);
// The same Colombo trip with OUT010, which closes at 07:30, in place of OUT014.
const toOut010 = ['OUT006', 'OUT004', 'OUT007', 'OUT010'];
// The Style trip: two mall shops in Colombo and then a shop with a rear dock.
const styleShops = ['OUT015', 'OUT017', 'OUT019'];
// Four Fresh shops in Badulla, 186 minutes from Kandy and 23 minutes apart.
const badulla = ['OUT110', 'OUT112', 'OUT111', 'OUT113'];

type Parts = { settings?: Partial<PlanSettings>; outlets?: EngineOutlet[] };

// Every vehicle of the plan, timed the way the checker times it.
const timesOf = (input: PlanInput): VehicleTimes[] => [...new Set(input.plan.trips.map((t) => t.vehicleId))].map((id) => timeVehicleDay(input, id));
const check = (depotId: string, trips: PlanTrip[], parts: Parts = {}) => {
  const input = inputFor(depotId, { ...parts, trips });
  return timeProblems(input, timesOf(input));
};
const only = (problems: Problem[], ...codes: ProblemCode[]) => problems.filter((problem) => codes.includes(problem.code));
// The shops with one of them changed, for what no shop in the data has. OUT017 sits in a mall that lets deliveries
// in from 10:30 to 12:30, and every mall shop in the data has a window equal to its slot, so a test about the two
// being different gives OUT017 another window.
const changed = (outletId: string, change: Partial<EngineOutlet>) => outlets.map((o) => (o.id === outletId ? { ...o, ...change } : o));
const hours = (open: string, close: string) => ({ windowOpen: toMinutes(open), windowClose: toMinutes(close) });
const out017Open = (open: string, close: string) => changed('OUT017', hours(open, close));

describe('rules for time', () => {
  it('finds nothing wrong with the chained day or the Style trip', () => {
    expect(check('Peliyagoda', [gampaha, colombo])).toEqual([]);
    // The plan may list a vehicle's trips in any order.
    expect(check('Peliyagoda', [colombo, gampaha])).toEqual([]);
    expect(check('Peliyagoda', [trip('VEH012', 1, styleShops)])).toEqual([]);
  });

  it('AC-29 reports cross_district for a trip with stops in more than one district, and gives it no times', () => {
    // OUT026 (Gampaha) and OUT006 (Colombo) on one trip.
    const input = inputFor('Peliyagoda', { trips: [trip('VEH012', 1, ['OUT026', 'OUT006'])] });
    const times = timesOf(input);
    expect(times).toEqual([{ vehicleId: 'VEH012', trips: [{ tripNo: 1, times: null }] }]);
    expect(timeProblems(input, times)).toEqual([{
      code: 'cross_district', level: 'block', vehicleId: 'VEH012', tripNo: 1,
      message: 'The dry truck VEH012 goes to Gampaha and Colombo on one trip, and a trip stays in one district.', fix: 'Move the Colombo stops to another trip.',
    }]);

    // With no times the rules about leaving and arriving have nothing to check, so an early leaving time adds nothing.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT026', 'OUT006'], '02:00')]).map((p) => p.code)).toEqual(['cross_district']);
    // The vehicle's other trip is still checked: alone, the Colombo trip leaves at 03:30 and waits at OUT004.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT026', 'OUT006']), colombo]).map((p) => p.code)).toEqual(['cross_district', 'long_wait']);
  });

  it('AC-49 reports no_travel_data for a district the data has no drive to from the plan\'s depot, and gives the trip no times', () => {
    // OUT084 is in Kandy district, and the data has no drive from Peliyagoda to Kandy.
    const input = inputFor('Peliyagoda', { trips: [trip('VEH008', 1, ['OUT084'])] });
    const times = timesOf(input);
    expect(times).toEqual([{ vehicleId: 'VEH008', trips: [{ tripNo: 1, times: null }] }]);
    expect(timeProblems(input, times)).toEqual([{
      code: 'no_travel_data', level: 'block', vehicleId: 'VEH008', tripNo: 1,
      message: 'There are no travel figures from the Peliyagoda depot to Kandy, and the dry truck VEH008 goes there.',
    }]);

    // From Kandy's own depot the district is 16 minutes away.
    expect(check('Kandy', [trip('VEH044', 1, ['OUT084'])])).toEqual([]);
  });

  it('AC-30 reports too_many_trips for more than two trips, two trips with the same number, or a number other than 1 or 2', () => {
    // Three short Colombo trips that follow each other in time, so nothing else is wrong with them.
    const first = trip('VEH012', 1, ['OUT006']);
    const second = trip('VEH012', 2, ['OUT005']);
    expect(check('Peliyagoda', [first, second, trip('VEH012', 3, ['OUT011'])])).toEqual([{
      code: 'too_many_trips', level: 'block', vehicleId: 'VEH012',
      message: 'The dry truck VEH012 has 3 trips, and a vehicle runs at most two a day.',
    }]);
    expect(check('Peliyagoda', [first, { ...second, tripNo: 1 }])).toEqual([{
      code: 'too_many_trips', level: 'block', vehicleId: 'VEH012', tripNo: 1,
      message: 'The dry truck VEH012 has two trips numbered 1, and a vehicle\'s trips are numbered 1 and 2.',
    }]);
    for (const tripNo of [3, 0]) {
      expect(check('Peliyagoda', [{ ...first, tripNo }])).toEqual([{
        code: 'too_many_trips', level: 'block', vehicleId: 'VEH012', tripNo,
        message: `The dry truck VEH012 has a trip numbered ${tripNo}, and a vehicle's trips are numbered 1 and 2.`,
      }]);
    }

    // Two trips numbered 1 and 2 are fine, on as many vehicles as there are.
    expect(check('Peliyagoda', [first, second, trip('VEH008', 1, ['OUT011']), trip('VEH008', 2, ['OUT009'])])).toEqual([]);
    expect(check('Peliyagoda', [trip('VEH012', 2, ['OUT006'])])).toEqual([]);
  });

  it('AC-31 reports trips_overlap when a second trip leaves before the first is ready again, and gives the earliest it can leave', () => {
    const overlap = (leaveAt: string) => [{
      code: 'trips_overlap', level: 'block', vehicleId: 'VEH012', tripNo: 2,
      message: `The second trip of the dry truck VEH012 leaves at ${leaveAt}, before it is back and reloaded at 06:18.`, fix: 'Leave at 06:18 or later.', leaveAt: 378,
    }];
    const chained = (leaveAt: string) => check('Peliyagoda', [gampaha, { ...colombo, leaveAt: toMinutes(leaveAt) }]);
    expect(chained('05:30')).toEqual(overlap('05:30'));
    expect(chained('06:17')).toEqual(overlap('06:17'));
    // Leaving just as the vehicle is ready is allowed.
    expect(chained('06:18')).toEqual([]);
  });

  it('AC-32 reports window_missed with the minutes after closing, and for a Fresh shop reached at 08:00 or later', () => {
    // On the chained day trip 2 leaves at 06:18 and reaches its fourth stop at 07:54.
    expect(check('Peliyagoda', [gampaha, trip('VEH012', 2, toOut010)])).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH012', tripNo: 2, stopSeq: 4, outletId: 'OUT010',
      message: 'OUT010 is reached at 07:54 by the second trip of the dry truck VEH012, 24 minutes after its window closes at 07:30.',
    }]);

    // Arriving exactly at closing time is on time, and a minute later is late.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT010'], '07:06')])).toEqual([]);
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT010'], '07:07')])).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT010',
      message: 'OUT010 is reached at 07:31 by the dry truck VEH012, 1 minute after its window closes at 07:30.',
      fix: 'Leave by 07:06 to reach every stop in time.', leaveAt: 426,
    }]);

    // The booklet's exception. Leaving Kandy at 03:00 the fourth Badulla shop, which closes at 08:00, is reached
    // at 08:00. That is inside its window, and late for a Fresh shop.
    expect(only(check('Kandy', [trip('VEH044', 1, badulla, '03:00')]), 'window_missed')).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH044', tripNo: 1, stopSeq: 4, outletId: 'OUT113',
      message: 'OUT113 is reached at 08:00 by the dry truck VEH044, and Fresh shops must be reached before 08:00.',
      fix: 'Leave by 02:59 to reach every stop in time.', leaveAt: 179,
    }]);
    // Leaving at 02:59 it is reached at 07:59, and nothing blocks the plan.
    expect(check('Kandy', [trip('VEH044', 1, badulla, '02:59')]).filter((p) => p.level === 'block')).toEqual([]);

    // A mall shop reached after its own window has closed and before its mall's slot has is a missed window too:
    // OUT017 with a window of 10:00 to 11:30, reached at 11:44.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT017'], '11:20')], { outlets: out017Open('10:00', '11:30') })).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT017',
      message: 'OUT017 is reached at 11:44 by the dry truck VEH012, 14 minutes after its window closes at 11:30.',
      fix: 'Leave by 11:06 to reach every stop in time.', leaveAt: 666,
    }]);
  });

  it('AC-33 reports mall_slot_missed, with the mall\'s hours, for a mall shop reached after its slot or with a slot its window never meets', () => {
    // The Style trip with OUT017 first leaves at 10:06 and reaches OUT015 at 11:37. Its slot closed at 11:00.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT017', 'OUT015', 'OUT019'])])).toEqual([{
      code: 'mall_slot_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 2, outletId: 'OUT015',
      message: 'OUT015 is reached at 11:37 by the dry truck VEH012, 37 minutes after its mall slot of 09:00 to 11:00 ends.',
    }]);
    // Reaching it just as the slot closes is on time: leaving at 10:36 the usual way round, OUT015 is reached at 11:00.
    expect(check('Peliyagoda', [trip('VEH012', 1, styleShops, '10:36')])).toEqual([]);

    // It is the mall's hours that are named and counted from, not the shop's own. OUT017 reached at 12:45, 15
    // minutes after its slot, first with a window that is still open and then with one that closed at 11:30.
    const afterSlot = (leaveBy: string) => [{
      code: 'mall_slot_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT017',
      message: 'OUT017 is reached at 12:45 by the dry truck VEH012, 15 minutes after its mall slot of 10:30 to 12:30 ends.',
      fix: `Leave by ${leaveBy} to reach every stop in time.`, leaveAt: toMinutes(leaveBy),
    }];
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT017'], '12:21')], { outlets: out017Open('09:00', '17:00') })).toEqual(afterSlot('12:06'));
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT017'], '12:21')], { outlets: out017Open('10:00', '11:30') })).toEqual(afterSlot('11:06'));

    // A window of 09:00 to 10:00 never meets the slot of 10:30 to 12:30, so whenever the shop is reached it is
    // late. Reached at 09:30 the vehicle would wait an hour for nothing, and that is not reported as a wait.
    const never = [{
      code: 'mall_slot_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT017',
      message: 'OUT017 takes deliveries from 09:00 to 10:00 and its mall slot is 10:30 to 12:30, so the dry truck VEH012 can never reach it in time.',
    }];
    const apart = { outlets: out017Open('09:00', '10:00') };
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT017'])], apart)).toEqual(never);
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT017'], '09:06')], apart)).toEqual(never);

    // No Fresh shop in the data is in a mall. One that were, reached after its slot and after 08:00, is told both:
    // OUT017 as a Fresh shop with a slot of 06:00 to 10:00, reached at 10:10.
    const freshInMall = { outlets: changed('OUT017', { brand: 'Fresh', mallOpen: toMinutes('06:00'), mallClose: toMinutes('10:00'), ...hours('06:00', '10:00') }) };
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT017'], '09:46')], freshInMall)).toEqual([{
      code: 'mall_slot_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT017',
      message: 'OUT017 is reached at 10:10 by the dry truck VEH012, 10 minutes after its mall slot of 06:00 to 10:00 ends, and Fresh shops must be reached before 08:00.',
      fix: 'Leave by 07:35 to reach every stop in time.', leaveAt: 455,
    }]);
  });

  it('AC-37 warns with over_time_budget when a vehicle\'s Fresh trips pass 270 trip minutes or its Style and Tech trips 480', () => {
    // Badulla's OUT110, OUT112 and OUT111 take 186 + 23 × 2 + 15 × 3 = 277 and are all reached in time.
    const three = [trip('VEH044', 1, ['OUT110', 'OUT112', 'OUT111'])];
    // Both vehicles here are dry trucks.
    const over = (vehicleId: string, trips: string, took: number, budget: number) => [{
      code: 'over_time_budget', level: 'warn', vehicleId,
      message: `The dry truck ${vehicleId}'s ${trips} trips take ${took} minutes of driving and unloading, ${took - budget} over the day's ${budget}.`,
    }];
    expect(check('Kandy', three)).toEqual(over('VEH044', 'Fresh', 277, 270));
    // The budgets are settings (D-09), and a day exactly on its budget is inside it.
    expect(check('Kandy', three, { settings: { budgetMin: { fresh: 276, styleTech: 480 } } })).toEqual(over('VEH044', 'Fresh', 277, 276));
    expect(check('Kandy', three, { settings: { budgetMin: { fresh: 277, styleTech: 480 } } })).toEqual([]);

    // A vehicle's two trips are added up: the chained day is the booklet's 101 + 112 = 213 minutes.
    expect(check('Peliyagoda', [gampaha, colombo], { settings: { budgetMin: { fresh: 212, styleTech: 480 } } })).toEqual(over('VEH012', 'Fresh', 213, 212));

    // The Style trip is 196 minutes against the other budget.
    const style = trip('VEH012', 1, styleShops);
    expect(check('Peliyagoda', [style], { settings: { budgetMin: { fresh: 270, styleTech: 195 } } })).toEqual(over('VEH012', 'Style and Tech', 196, 195));
    expect(check('Peliyagoda', [style], { settings: { budgetMin: { fresh: 270, styleTech: 196 } } })).toEqual([]);
    // A Fresh trip and a Style trip are counted apart: 101 and 196 are 297 together and each inside its own budget.
    expect(check('Peliyagoda', [gampaha, { ...style, tripNo: 2 }])).toEqual([]);
    expect(check('Peliyagoda', [gampaha, { ...style, tripNo: 2 }], { settings: { budgetMin: { fresh: 100, styleTech: 195 } } }))
      .toEqual([...over('VEH012', 'Fresh', 101, 100), ...over('VEH012', 'Style and Tech', 196, 195)]);
  });

  it('AC-38 warns with leaves_early for a trip set to leave before 03:30 with a Fresh stop, or before 07:30 without one', () => {
    // Both vehicles here are dry trucks.
    const early = (vehicleId: string, leaveAt: string, fresh: 'with' | 'without', earliest: string) => [{
      code: 'leaves_early', level: 'warn', vehicleId, tripNo: 1,
      message: `The dry truck ${vehicleId} leaves at ${leaveAt}, and a trip ${fresh} a Fresh shop normally leaves at ${earliest} or later.`,
    }];
    // The four-stop Badulla trip that leaves at 02:59. It also runs past the Fresh budget, and reaches every shop in time.
    const fourStops = check('Kandy', [trip('VEH044', 1, badulla, '02:59')]);
    expect(fourStops.map((p) => p.code)).toEqual(['leaves_early', 'over_time_budget']);
    expect(only(fourStops, 'leaves_early')).toEqual(early('VEH044', '02:59', 'with', '03:30'));

    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT006'], '03:29')])).toEqual(early('VEH012', '03:29', 'with', '03:30'));
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT006'], '03:30')])).toEqual([]);
    // OUT057 is a Style shop in Galle that opens at 09:00, 103 minutes from the depot.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT057'], '07:20')])).toEqual(early('VEH012', '07:20', 'without', '07:30'));
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT057'], '07:30')])).toEqual([]);
    // The two times are settings (D-19).
    const later = { settings: { earliestLeave: { Fresh: toMinutes('04:00'), Style: toMinutes('07:30'), Tech: toMinutes('07:30') } } };
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT006'], '03:45')], later)).toEqual(early('VEH012', '03:45', 'with', '04:00'));
  });

  it('AC-39 warns with long_wait for a wait of more than 30 minutes, and at the first stop gives the leaving time that removes it', () => {
    // Leaving at 03:30 with OUT008 (opens 05:00) first, a truck arrives at 03:54 and waits 66 minutes.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT008'], '03:30')])).toEqual([{
      code: 'long_wait', level: 'warn', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT008',
      message: 'OUT008 is reached at 03:54 by the dry truck VEH012 and waits 66 minutes for its window to open at 05:00.',
      fix: 'Leave at 04:36 to arrive as it opens.', leaveAt: 276,
    }]);
    // A wait of exactly 30 minutes is not long.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT008'], '04:06')])).toEqual([]);
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT008'], '04:05')])).toMatchObject([{ code: 'long_wait', stopSeq: 1, fix: 'Leave at 04:36 to arrive as it opens.' }]);

    // At a later stop no leaving time removes the wait. OUT004 opens at 05:30 and is reached at 04:18.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT006', 'OUT004'], '03:30')])).toEqual([{
      code: 'long_wait', level: 'warn', vehicleId: 'VEH012', tripNo: 1, stopSeq: 2, outletId: 'OUT004',
      message: 'OUT004 is reached at 04:18 by the dry truck VEH012 and waits 72 minutes for its window to open at 05:30.',
    }]);

    // The 30 minutes are a setting (D-19). The Style trip waits 23 minutes at OUT017.
    expect(check('Peliyagoda', [trip('VEH012', 1, styleShops)], { settings: { waitWarnMin: 20 } })).toEqual([{
      code: 'long_wait', level: 'warn', vehicleId: 'VEH012', tripNo: 1, stopSeq: 2, outletId: 'OUT017',
      message: 'OUT017 is reached at 10:07 by the dry truck VEH012 and waits 23 minutes for its window to open at 10:30.',
    }]);
  });

  it('AC-47 gives a late stop the latest earlier leaving time that reaches every stop in time, and no fix when none does', () => {
    const fix = (leaveBy: string) => `Leave by ${leaveBy} to reach every stop in time.`;
    // The four-stop Badulla trip at its default 03:30 reaches OUT113 at 08:30. Leaving at 03:00 reaches it at
    // 08:00, still late for a Fresh shop, so the fix says 02:59.
    expect(only(check('Kandy', [trip('VEH044', 1, badulla)]), 'window_missed')).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH044', tripNo: 1, stopSeq: 4, outletId: 'OUT113',
      message: 'OUT113 is reached at 08:30 by the dry truck VEH044, 30 minutes after its window closes at 08:00, and Fresh shops must be reached before 08:00.',
      fix: fix('02:59'), leaveAt: 179,
    }]);
    // Every late stop of a trip carries the same time. Leaving at 04:30 the last three shops are late.
    expect(only(check('Kandy', [trip('VEH044', 1, badulla, '04:30')]), 'window_missed').map((p) => [p.outletId, p.fix]))
      .toEqual([['OUT112', fix('02:59')], ['OUT111', fix('02:59')], ['OUT113', fix('02:59')]]);

    // This Colombo trip leaves at 04:36 and reaches OUT010 at 07:51. Leaving earlier only means waiting at
    // OUT008, which opens at 05:00, so there is no fix.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT008', 'OUT012', 'OUT004', 'OUT007', 'OUT014', 'OUT011', 'OUT013', 'OUT010'])])).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 8, outletId: 'OUT010',
      message: 'OUT010 is reached at 07:51 by the dry truck VEH012, 21 minutes after its window closes at 07:30.',
    }]);

    // Never before the vehicle is ready from its earlier trip. As the vehicle's only trip, this one can leave at
    // 05:54 and reach OUT010 at 07:30.
    expect(check('Peliyagoda', [trip('VEH012', 1, toOut010, '06:18')])).toMatchObject([{ code: 'window_missed', outletId: 'OUT010', fix: fix('05:54') }]);
    // As a second trip the vehicle is only ready at 06:18, which is too late, so there is no fix.
    const second = check('Peliyagoda', [gampaha, trip('VEH012', 2, toOut010, '06:30')]);
    expect(second).toMatchObject([{ code: 'window_missed', outletId: 'OUT010' }]);
    expect(second.map((p) => [p.fix, p.leaveAt])).toEqual([[undefined, undefined]]);
    // The minute the vehicle is ready is not too early: a second trip to OUT006, OUT004 and OUT010 set to 06:30
    // reaches the last at 07:42, and leaving at 06:18 reaches it at 07:30.
    expect(check('Peliyagoda', [gampaha, trip('VEH012', 2, ['OUT006', 'OUT004', 'OUT010'], '06:30')]))
      .toMatchObject([{ code: 'window_missed', outletId: 'OUT010', fix: fix('06:18') }]);
    // A time between the ready time and its own is offered: set to 06:30, trip 2 of the chained day reaches
    // OUT014 at 08:06, and leaving at 06:23 reaches it at 07:59.
    expect(check('Peliyagoda', [gampaha, { ...colombo, leaveAt: toMinutes('06:30') }])).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH012', tripNo: 2, stopSeq: 4, outletId: 'OUT014',
      message: 'OUT014 is reached at 08:06 by the second trip of the dry truck VEH012, 6 minutes after its window closes at 08:00, and Fresh shops must be reached before 08:00.',
      fix: fix('06:23'), leaveAt: 383,
    }]);

    // Never before midnight. No shop in the data needs it, so OUT110 in Badulla, 186 minutes from Kandy, is given
    // a window that closes at 03:00. Leaving at 00:00 reaches it at 03:06, so there is no fix.
    const beforeDawn = (close: string) => check('Kandy', [trip('VEH044', 1, ['OUT110'])], { outlets: changed('OUT110', hours('00:00', close)) });
    expect(beforeDawn('03:00')).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH044', tripNo: 1, stopSeq: 1, outletId: 'OUT110',
      message: 'OUT110 is reached at 06:36 by the dry truck VEH044, 216 minutes after its window closes at 03:00.',
    }]);
    // Midnight itself is not too early: with the window closing at 03:06 the fix says 00:00.
    expect(beforeDawn('03:06')).toMatchObject([{ code: 'window_missed', outletId: 'OUT110', fix: fix('00:00'), leaveAt: 0 }]);

    // A missed mall slot carries the fix too: set to 10:40 the Style trip reaches OUT015 at 11:04.
    expect(check('Peliyagoda', [trip('VEH012', 1, styleShops, '10:40')])).toEqual([{
      code: 'mall_slot_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT015',
      message: 'OUT015 is reached at 11:04 by the dry truck VEH012, 4 minutes after its mall slot of 09:00 to 11:00 ends.',
      fix: fix('10:36'), leaveAt: 636,
    }]);
  });


  it('spec 010 AC-17 gives the Kurunegala late stop its 03:07 suggestion as minutes', () => {
    const kurunegala = trip('VEH002', 1, ['OUT068', 'OUT065', 'OUT069', 'OUT066', 'OUT067']);
    const problems = check('Peliyagoda', [kurunegala]);
    expect(only(problems, 'window_missed')).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH002', tripNo: 1, stopSeq: 5, outletId: 'OUT067',
      message: 'OUT067 is reached at 07:53 by the reefer truck VEH002, 23 minutes after its window closes at 07:30.',
      fix: 'Leave by 03:07 to reach every stop in time.', leaveAt: 187,
    }]);
    expect(only(check('Peliyagoda', [{ ...kurunegala, leaveAt: 187 }]), 'window_missed')).toEqual([]);
  });

  it('spec 010 AC-17 never offers a next-day leaving time that the draft cannot save', () => {
    // Both departures are valid form inputs, but trip 1 only gets back after midnight. Its overlap fix is
    // useful prose, while a one-click departure must remain on the plan day (00:00 through 23:59).
    const problems = check('Peliyagoda', [
      trip('VEH012', 1, ['OUT019'], '23:59'), trip('VEH012', 2, ['OUT019'], '23:59'),
    ]);
    const [overlap] = only(problems, 'trips_overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.leaveAt).toBeUndefined();
    expect(Problem.safeParse(overlap).success).toBe(true);
  });

  it('leaves a trip with no stops to the rule for empty trips', () => {
    expect(check('Peliyagoda', [trip('VEH012', 1, [])])).toEqual([]);
  });

  it('says what is wrong with a shop whose own window opens after it closes', () => {
    // No shop in the data is like this. A stop there can never be in time, and the sentence gives the two times.
    expect(check('Peliyagoda', [trip('VEH012', 1, ['OUT019'])], { outlets: changed('OUT019', hours('10:00', '09:00')) })).toEqual([{
      code: 'window_missed', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT019',
      message: 'OUT019\'s window opens at 10:00 and closes at 09:00, so the dry truck VEH012 can never reach it in time.',
    }]);
  });

  it('leaves the input as it came and says the same thing twice', () => {
    // Trip 2 is listed first and both trips are late, so the trips are put in order and an earlier leaving time
    // is searched for.
    const input = inputFor('Kandy', { trips: [trip('VEH044', 2, ['OUT084']), trip('VEH044', 1, badulla)] });
    const before = structuredClone(input);
    const first = timeProblems(input, timesOf(input));
    expect(only(first, 'window_missed').map((p) => [p.tripNo, p.outletId])).toEqual([[1, 'OUT113'], [2, 'OUT084']]);
    expect(timeProblems(input, timesOf(input))).toEqual(first);
    expect(input).toEqual(before);
  });

  it('throws an error that names a vehicle or shop the input does not hold', () => {
    // The times are handed over as nothing, so it is the rules that meet whatever is missing.
    const missing: [string, () => unknown][] = [
      ['No vehicle VEH999', () => timeProblems(inputFor('Peliyagoda', { trips: [trip('VEH999', 1, ['OUT006'])] }), [])],
      ['No shop OUT999', () => timeProblems(inputFor('Peliyagoda', { trips: [trip('VEH012', 1, ['OUT006', 'OUT999'])] }), [])],
    ];
    for (const [named, plan] of missing) {
      expect(plan).toThrow(PlanInputError);
      expect(plan).toThrow(named);
    }
  });

  it('throws when a trip that can be timed comes without its times, so its windows never pass unchecked', () => {
    const input = inputFor('Peliyagoda', { trips: [gampaha, colombo] });
    const day = timeVehicleDay(input, 'VEH012');
    expect(timeProblems(input, [day])).toEqual([]);

    const handed: [string, VehicleTimes[]][] = [
      ['No times were given for VEH012 trip 1', []],
      ['No times were given for VEH012 trip 2', [{ ...day, trips: day.trips.slice(0, 1) }]],
      // Handed over as trips that could not be timed.
      ['No times were given for VEH012 trip 1', [{ ...day, trips: day.trips.map(({ tripNo }) => ({ tripNo, times: null })) }]],
      // Handed over out of trip-number order, where trip 1 would be checked against the times of trip 2.
      ['No times were given for VEH012 trip 1', [{ ...day, trips: [...day.trips].reverse() }]],
    ];
    for (const [named, times] of handed) {
      expect(() => timeProblems(input, times)).toThrow(PlanInputError);
      expect(() => timeProblems(input, times)).toThrow(named);
    }
  });
});
