import { describe, expect, it } from 'vitest';
import { capital, driverOf, itsTrip, kg, litres, m3, orderCalled, toClock, toMinutes, tripCalled, vehicleCalled } from './words';

describe('how the checker writes times and amounts', () => {
  it('reads a time of day as minutes after midnight and back', () => {
    expect(toMinutes('03:30')).toBe(210);
    expect(toClock(210)).toBe('03:30');
    expect(toClock(474)).toBe('07:54');
  });

  it('never wraps a time past midnight', () => {
    expect(toClock(1450)).toBe('24:10');
  });

  it('refuses something that is not a time of day', () => {
    expect(() => toMinutes('half past three')).toThrow();
  });

  it('writes amounts with a thousands comma and no trailing zeros', () => {
    expect(kg(1242)).toBe('1,242 kg');
    expect(kg(331.2)).toBe('331.2 kg');
    expect(m3(22.8)).toBe('22.8 m³');
    expect(m3(1.776)).toBe('1.776 m³');
    expect(litres(63.6)).toBe('63.6 litres');
  });

  it('calls an order by its weight, whether it is chilled and its shop', () => {
    // A Fresh shop has a chilled and a dry order most days, so "an order for the shop" would not say which.
    expect(orderCalled(276, true, 'Fresh Nugegoda')).toBe('276 kg chilled order for Fresh Nugegoda');
    expect(orderCalled(331.2, false, 'Fresh Nugegoda')).toBe('331.2 kg dry order for Fresh Nugegoda');
    // It has no "a" or "an" in front, because 800 kg would need the other one. A sentence says "the".
    expect(orderCalled(800, false, 'Tech Galle')).toBe('800 kg dry order for Tech Galle');
  });

  it('spec 024 calls a vehicle by its kind, in the board\'s own words, and its id', () => {
    expect(vehicleCalled({ id: 'VEH001', type: 'truck', temp: 'reefer' })).toBe('the reefer truck VEH001');
    expect(vehicleCalled({ id: 'VEH044', type: 'truck', temp: 'ambient' })).toBe('the dry truck VEH044');
    expect(vehicleCalled({ id: 'VEH035', type: 'van', temp: 'reefer' })).toBe('the reefer van VEH035');
    expect(vehicleCalled({ id: 'VEH037', type: 'van', temp: 'ambient' })).toBe('the van VEH037');
  });

  it('spec 024 numbers a trip only to tell a vehicle\'s second trip from its first', () => {
    const truck = { id: 'VEH001', type: 'truck', temp: 'reefer' } as const;
    expect(tripCalled(truck, 2)).toBe('the second trip of the reefer truck VEH001');
    // A first or only trip gets no number: it is the vehicle.
    expect(tripCalled(truck, 1)).toBe('the reefer truck VEH001');
    // After a sentence has named the vehicle.
    expect(itsTrip(2)).toBe('its second trip');
    expect(itsTrip(1)).toBeNull();
  });

  it('spec 026 calls a truck by its driver when the trip has one, and by kind and id when it has none', () => {
    const truck = { id: 'VEH044', type: 'truck', temp: 'ambient' } as const;
    expect(vehicleCalled(truck, 'Chaminda')).toBe('Chaminda\'s dry truck');
    expect(vehicleCalled({ id: 'VEH035', type: 'van', temp: 'reefer' }, 'Dilshan')).toBe('Dilshan\'s reefer van');
    expect(tripCalled({ id: 'VEH001', type: 'truck', temp: 'reefer' }, 2, 'Chaminda')).toBe('the second trip of Chaminda\'s reefer truck');
    expect(tripCalled(truck, 1, 'Chaminda')).toBe('Chaminda\'s dry truck');
    expect(vehicleCalled(truck)).toBe('the dry truck VEH044');
    expect(vehicleCalled(truck, '')).toBe('the dry truck VEH044');
    // A sentence about a whole vehicle takes the driver its trips carry.
    const trips = [{ vehicleId: 'VEH044', tripNo: 1, stops: [] }, { vehicleId: 'VEH044', tripNo: 2, stops: [], driverName: 'Chaminda' }, { vehicleId: 'VEH012', tripNo: 1, stops: [] }];
    expect(driverOf(trips, 'VEH044')).toBe('Chaminda');
    expect(driverOf(trips, 'VEH012')).toBeUndefined();
  });

  it('starts a sentence that leads with a vehicle with a capital', () => {
    expect(capital('the dry truck VEH044 carries 7,450 kg.')).toBe('The dry truck VEH044 carries 7,450 kg.');
    expect(capital('Tech Kadugannawa only takes vans.')).toBe('Tech Kadugannawa only takes vans.');
  });
});
