import { DEFERRAL_CODES } from '@wayfinder/contracts';
import { describe, expect, it } from 'vitest';
import { PlanInputError } from '../errors';
import { inputFor, order } from '../testing/shared';
import type { EngineOrder, PlanDeferral, PlanTrip } from '../types';
import { coverageProblems } from './coverage';

// A trip from its stops, each written as the shop followed by the orders dropped there.
const trip = (vehicleId: string, tripNo: number, ...stops: [outletId: string, ...orderIds: string[]][]): PlanTrip =>
  ({ vehicleId, tripNo, stops: stops.map(([outletId, ...orderIds]) => ({ outletId, orderIds })) });
const deferred = (orderId: string): PlanDeferral => ({ orderId, code: 'over_capacity', reason: 'No room left on a dry truck today.' });
const check = (parts: { orders: EngineOrder[]; trips?: PlanTrip[]; deferrals?: PlanDeferral[] }) => coverageProblems(inputFor('Peliyagoda', parts));

// 48 dry cartons for each of two Fresh shops in Colombo.
const a = order('a', 'OUT004', 'fresh-dry-carton', 48);
const b = order('b', 'OUT006', 'fresh-dry-carton', 48);

describe('rules for every order being accounted for', () => {
  it('AC-24 reports order_not_planned for an order on no stop and with no deferral', () => {
    const trips = [trip('VEH012', 1, ['OUT004', 'a'])];
    expect(check({ orders: [a, b], trips })).toEqual([{
      code: 'order_not_planned', level: 'block', orderId: 'b', outletId: 'OUT006',
      message: 'The 331.2 kg dry order for OUT006 is on no trip and is not deferred.', fix: 'Put it on a trip or defer it with a reason.',
    }]);
    // A Fresh shop has a chilled and a dry order most days, so the sentence says which one it is about.
    const cold = order('cold', 'OUT004', 'fresh-chilled-carton', 40);
    expect(check({ orders: [a, cold], trips })).toEqual([{
      code: 'order_not_planned', level: 'block', orderId: 'cold', outletId: 'OUT004',
      message: 'The 276 kg chilled order for OUT004 is on no trip and is not deferred.', fix: 'Put it on a trip or defer it with a reason.',
    }]);

    // On one stop or deferred once, an order is accounted for.
    expect(check({ orders: [a, b], trips, deferrals: [deferred('b')] })).toEqual([]);
    expect(check({ orders: [a, b], trips: [trip('VEH012', 1, ['OUT004', 'a'], ['OUT006', 'b'])] })).toEqual([]);
  });

  it('AC-25 reports order_twice for an order on two stops, on a stop and deferred, or deferred twice', () => {
    const twice = (places: string) => [{
      code: 'order_twice', level: 'block', orderId: 'a', outletId: 'OUT004',
      message: `The 331.2 kg dry order for OUT004 is ${places}, and an order can be in the plan only once.`, fix: 'Keep it in one place only.',
    }];
    const onTwoStops = [trip('VEH012', 1, ['OUT004', 'a']), trip('VEH008', 1, ['OUT004', 'a'])];
    expect(check({ orders: [a], trips: onTwoStops })).toEqual(twice('on the dry truck VEH012 at stop 1 and on the dry truck VEH008 at stop 1'));
    expect(check({ orders: [a], trips: [trip('VEH012', 1, ['OUT004', 'a'])], deferrals: [deferred('a')] })).toEqual(twice('on the dry truck VEH012 at stop 1 and deferred'));
    expect(check({ orders: [a], deferrals: [deferred('a'), deferred('a')] })).toEqual(twice('deferred 2 times'));
  });

  it('AC-26 reports deferral_incomplete for a code that is not in the list or an empty reason', () => {
    const incomplete = (missing: string, fix: string) => [{
      code: 'deferral_incomplete', level: 'block', orderId: 'a', outletId: 'OUT004',
      message: `The 331.2 kg dry order for OUT004 is deferred without ${missing}.`, fix,
    }];
    const deferredWith = (code: string, reason: string) => check({ orders: [a], deferrals: [{ orderId: 'a', code, reason }] });
    expect(deferredWith('too_heavy', 'Too heavy for the van.')).toEqual(incomplete('a reason from the list', 'Give it a reason from the list.'));
    expect(deferredWith('over_capacity', '')).toEqual(incomplete('a written reason', 'Give it a written reason.'));
    expect(deferredWith('over_capacity', '   ')).toEqual(incomplete('a written reason', 'Give it a written reason.'));
    // A deferral with neither is still one problem.
    expect(deferredWith('', '')).toEqual(incomplete('a reason from the list or a written reason', 'Give it a reason from the list and a written reason.'));

    for (const code of DEFERRAL_CODES) expect(deferredWith(code, 'No room left on a dry truck today.')).toEqual([]);
  });

  it('AC-27 reports order_wrong_outlet for an order on a stop at another shop than its own', () => {
    // An order for OUT004 on the stop at OUT006.
    expect(check({ orders: [a, b], trips: [trip('VEH012', 1, ['OUT006', 'b', 'a'])] })).toEqual([{
      code: 'order_wrong_outlet', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 1, outletId: 'OUT006', orderId: 'a',
      message: 'The 331.2 kg dry order for OUT004 goes to OUT006 on the dry truck VEH012.', fix: 'Move it to a stop at OUT004.',
    }]);
  });

  it('AC-28 reports empty_trip for a trip with no stops and for a stop with no orders', () => {
    expect(check({ orders: [], trips: [trip('VEH012', 1)] })).toEqual([{
      code: 'empty_trip', level: 'block', vehicleId: 'VEH012', tripNo: 1,
      message: 'The dry truck VEH012 has a trip with no stops.', fix: 'Add a stop or remove the trip.',
    }]);
    expect(check({ orders: [a], trips: [trip('VEH012', 1, ['OUT004', 'a'], ['OUT006'])] })).toEqual([{
      code: 'empty_trip', level: 'block', vehicleId: 'VEH012', tripNo: 1, stopSeq: 2, outletId: 'OUT006',
      message: 'OUT006 is a stop with no orders on the dry truck VEH012.', fix: 'Add its orders or take the stop off.',
    }]);
  });

  it('AC-48 reports stop_repeated for two stops at the same shop on one trip', () => {
    // OUT004 has a dry and a chilled order, both on fridge truck VEH003.
    const chilled = order('chilled', 'OUT004', 'fresh-chilled-carton', 40);
    const orders = [a, b, chilled];
    expect(check({ orders, trips: [trip('VEH003', 1, ['OUT004', 'a'], ['OUT006', 'b'], ['OUT004', 'chilled'])] })).toEqual([{
      code: 'stop_repeated', level: 'block', vehicleId: 'VEH003', tripNo: 1, stopSeq: 3, outletId: 'OUT004',
      message: 'OUT004 is both stop 1 and stop 3 on the reefer truck VEH003.', fix: 'Put its orders on one stop.',
    }]);

    // A shop's orders for a trip go on one stop, and the same shop on the vehicle's other trip is another drive.
    expect(check({ orders, trips: [trip('VEH003', 1, ['OUT004', 'a', 'chilled'], ['OUT006', 'b'])] })).toEqual([]);
    expect(check({ orders, trips: [trip('VEH003', 1, ['OUT004', 'a'], ['OUT006', 'b']), trip('VEH003', 2, ['OUT004', 'chilled'])] })).toEqual([]);
  });

  it('throws an error that names a vehicle, shop or order the input does not hold', () => {
    const missing: [string, () => unknown][] = [
      ['No vehicle VEH999', () => check({ orders: [a], trips: [trip('VEH999', 1, ['OUT004', 'a'])] })],
      ['No shop OUT999', () => check({ orders: [a], trips: [trip('VEH012', 1, ['OUT999', 'a'])] })],
      ['No order c', () => check({ orders: [a], trips: [trip('VEH012', 1, ['OUT004', 'a', 'c'])] })],
      ['No order c', () => check({ orders: [a], trips: [trip('VEH012', 1, ['OUT004', 'a'])], deferrals: [deferred('c')] })],
    ];
    for (const [named, plan] of missing) {
      expect(plan).toThrow(PlanInputError);
      expect(plan).toThrow(named);
    }
  });
});
