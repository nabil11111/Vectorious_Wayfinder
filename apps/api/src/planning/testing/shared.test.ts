import { describe, expect, it } from 'vitest';
import { allowances, inputFor, outlet, outlets, products, travel, vehicle, vehicles } from './shared';

describe('the shared data as checker input', () => {
  it('holds every row the booklet supplies', () => {
    expect(outlets).toHaveLength(120);
    expect(vehicles).toHaveLength(60);
    expect(travel).toHaveLength(12);
    expect(allowances).toHaveLength(9);
    expect(products).toHaveLength(10);
  });

  it('turns times into minutes and keeps a mall slot beside the window', () => {
    expect(outlet('OUT001')).toMatchObject({ brand: 'Fresh', district: 'Colombo', depotId: 'Peliyagoda', parking: 'van_only', windowOpen: 300, windowClose: 450 });
    expect(outlet('OUT001').mallOpen).toBeUndefined();
    expect(outlet('OUT017')).toMatchObject({ parking: 'mall_dock', dockType: 'mall_bay', mallOpen: 630, mallClose: 750 });
  });

  it('reads a vehicle with its limits, available and with no fuel used', () => {
    expect(vehicle('VEH006')).toMatchObject({ type: 'truck', temp: 'reefer', volumeCapM3: 33.4, kmPerL: 4.4, weeklyFuelQuotaL: 380, available: true, litresUsedThisWeek: 0 });
  });

  it('builds an input for a depot with the default settings', () => {
    const input = inputFor('Peliyagoda', { settings: { mixBrands: true } });
    expect(input.operatingDay).toBe(true);
    expect(input.settings).toMatchObject({ reloadMin: 30, mixBrands: true });
    expect(input.plan).toEqual({ trips: [], deferrals: [] });
  });
});
