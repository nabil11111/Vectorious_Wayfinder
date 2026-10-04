import { PlanBoard, type BoardOrder } from '@wayfinder/contracts';

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const order = (n: number, extra: Partial<BoardOrder> = {}): BoardOrder => ({
  id: id(n), outletId: 'OUT001', temp: 'chilled', deliveryDate: '2026-06-25',
  lines: [{ productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 12 }],
  load: { kg: 82.8, m3: 0.444, units: 12, needsReefer: true, needsTailLift: false, keepUpright: false },
  carriedOver: false, timesDeferred: 0, lastDeferral: null, splitFrom: null, originalUnits: null, ...extra,
});
export const BOARD = PlanBoard.parse({
  depot: 'Peliyagoda', demoDay: 1, day: { date: '2026-06-25', cutoffAt: '2026-06-24T10:30:00Z', open: true },
  plan: { id: id(100), revision: 3, mixBrands: false, status: 'draft', savedAt: null, sentAt: null, canUnsend: false, lockedReason: null,
    trips: [{ vehicleId: 'VEH004', tripNo: 1, leaveAt: null, driverId: null, stops: [{ outletId: 'OUT001', orderIds: [id(1)] }] }],
    deferrals: [{ orderId: id(3), code: 'over_capacity', reason: 'The reefer is full.' }] },
  orders: [order(1), order(2), order(3), order(4, { carriedOver: true, deliveryDate: '2026-06-24', timesDeferred: 1,
    lastDeferral: { code: 'over_capacity', reason: 'The reefer was full.' } }), order(5, { outletId: 'OUT002' })],
  shops: [{ id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', district: 'Colombo', dockType: 'street', parking: 'normal', windowOpen: 300, windowClose: 450, mallOpen: null, mallClose: null, unloadMin: 15 },
    { id: 'OUT002', name: 'Fresh Wellawatte', brand: 'Fresh', district: 'Colombo', dockType: 'street', parking: 'normal', windowOpen: 330, windowClose: 480, mallOpen: null, mallClose: null, unloadMin: 15 }],
  dropped: [], check: null, vehicles: [], drivers: [], figures: null, counts: null, suggestion: null,
});
