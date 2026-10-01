import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyReceipt, deliveryFigures, lineReason, receiptView, ReceiptWrite, reportReasons, type StoreDeliveries, type StoreDelivery, type StoreDeliveryLine } from '@wayfinder/contracts';

// AC-5 on made-up deliveries: the receipt's rules on plain values, which the phone shows and the server is held to.

const at = (time: string) => new Date(`2026-06-25T${time}:00+05:30`).toISOString();

function line(temp: 'chilled' | 'dry', ordered: number, loaded: number, delivered: number): StoreDeliveryLine {
  return { lineId: randomUUID(), orderId: randomUUID(), temp, productId: `fresh-${temp}-carton`, name: temp === 'chilled' ? 'Chilled carton' : 'Dry carton', unit: 'carton', ordered, loaded, wontFit: 0, delivered, received: null };
}
function delivery(doneAt: string, lines: StoreDeliveryLine[], outcome: 'delivered' | 'refused' = 'delivered'): StoreDelivery {
  return { stopId: randomUUID(), revision: 2, day: '2026-06-25', vehicleId: 'VEH035', driver: 'Dilshan', arrivedAt: at('03:34'), doneAt: at(doneAt), outcome,
    late: false, refusalReason: outcome === 'refused' ? 'damaged' : null, lines, receipt: null };
}
// Nugegoda's delivery: 12 and 8 chilled cartons and 3 of 4 dry ones, handed over at 03:38.
const nugegoda = () => delivery('03:38', [line('chilled', 12, 12, 12), line('chilled', 8, 8, 8), line('dry', 4, 3, 3)]);
function deliveries(...list: StoreDelivery[]): StoreDeliveries {
  return { outlet: { id: 'OUT001', name: 'Fresh Nugegoda', brand: 'Fresh', windowOpen: '05:00', windowClose: '07:30', dockType: 'street' },
    userId: randomUUID(), today: '2026-06-25', appliedWriteIds: [], deliveries: list };
}
function receipt(of: StoreDelivery, counts: number[], more: Partial<Pick<ReceiptWrite, 'cold' | 'reason' | 'photo' | 'note' | 'at' | 'writeId'>> = {}): ReceiptWrite {
  return ReceiptWrite.parse({ kind: 'receipt', writeId: randomUUID(), stopId: of.stopId, at: at('08:31'), revision: of.revision,
    lines: of.lines.map((l, i) => ({ lineId: l.lineId, received: counts[i] })), cold: of.lines.some((l) => l.temp === 'chilled' && l.delivered > 0) ? true : null, reason: null, ...more });
}

describe('applyReceipt', () => {
  it('AC-5 sets each line\'s received count, raises the stop\'s revision by one, adds the receipt with the phone\'s time and lists its id, leaving its input alone', () => {
    const stop = nugegoda();
    const before = deliveries(stop);
    const kept = structuredClone(before);
    const write = receipt(stop, [12, 8, 3]);
    const after = applyReceipt(before, write);
    expect(before).toEqual(kept);
    expect(after.appliedWriteIds).toEqual([write.writeId]);
    expect(after.deliveries).toHaveLength(1);
    expect(after.deliveries[0]!.revision).toBe(3);
    expect(after.deliveries[0]!.lines.map((l) => l.received)).toEqual([12, 8, 3]);
    expect(after.deliveries[0]!.receipt).toEqual({ at: at('08:31'), sentAt: null, cold: true, report: null });
    expect(after).toEqual({ ...kept, appliedWriteIds: [write.writeId], deliveries: [{ ...stop, revision: 3, lines: stop.lines.map((l, i) => ({ ...l, received: [12, 8, 3][i]! })),
      receipt: { at: at('08:31'), sentAt: null, cold: true, report: null } }] });
  });

  it('AC-5 keeps the phone\'s time in the ISO form the server stores, to the millisecond', () => {
    const stop = nugegoda();
    const after = applyReceipt(deliveries(stop), receipt(stop, [12, 8, 3], { at: '2026-06-25T03:01:00.123456Z' }));
    expect(after.deliveries[0]!.receipt!.at).toBe('2026-06-25T03:01:00.123Z');
  });

  it('AC-5 adds a report with the write\'s id when a line is short, counting the short line at the units short', () => {
    const stop = nugegoda();
    const write = receipt(stop, [11, 8, 3], { reason: 'missing' });
    const after = applyReceipt(deliveries(stop), write).deliveries[0]!;
    expect(after.receipt).toEqual({ at: at('08:31'), sentAt: null, cold: true, report: {
      id: write.writeId, reason: 'missing', lines: [{ lineId: stop.lines[0]!.lineId, counted: 1, reason: 'missing' }], note: null, decision: null, decidedAt: null, replacement: null,
    } });
  });

  it('AC-5 makes No to the cold check a report of its own, counting each chilled line that came at 0', () => {
    const stop = nugegoda();
    const write = receipt(stop, [12, 8, 3], { cold: false });
    const report = applyReceipt(deliveries(stop), write).deliveries[0]!.receipt!.report;
    expect(report).toEqual({ id: write.writeId, reason: 'not_cold', lines: [{ lineId: stop.lines[0]!.lineId, counted: 0, reason: null }, { lineId: stop.lines[1]!.lineId, counted: 0, reason: null }],
      note: null, decision: null, decidedAt: null, replacement: null });
  });

  it('AC-5 keeps the shop\'s reason when lines are short and the chilled goods were not cold too, counting every line in the delivery\'s order', () => {
    const stop = nugegoda();
    const write = receipt(stop, [12, 6, 2], { cold: false, reason: 'damaged' });
    const report = applyReceipt(deliveries(stop), write).deliveries[0]!.receipt!.report!;
    expect(report.reason).toBe('damaged');
    expect(report.lines).toEqual([{ lineId: stop.lines[0]!.lineId, counted: 0, reason: null }, { lineId: stop.lines[1]!.lineId, counted: 2, reason: 'damaged' },
      { lineId: stop.lines[2]!.lineId, counted: 1, reason: 'damaged' }]);
  });

  it('Q-40 gives each short line its own reason, takes the first one\'s for the report and keeps the note', () => {
    const stop = nugegoda();
    const base = receipt(stop, [11, 8, 2], { note: 'One crushed, one never came' });
    const write = { ...base, lines: base.lines.map((each, i) => ({ ...each, reason: ['damaged', null, 'missing'][i] as 'damaged' | 'missing' | null })) };
    const report = applyReceipt(deliveries(stop), write).deliveries[0]!.receipt!.report!;
    expect(report).toMatchObject({ reason: 'damaged', note: 'One crushed, one never came',
      lines: [{ lineId: stop.lines[0]!.lineId, counted: 1, reason: 'damaged' }, { lineId: stop.lines[2]!.lineId, counted: 1, reason: 'missing' }] });
    expect(reportReasons(report)).toEqual(['damaged', 'missing']);
    // A line's own reason wins over a receipt's one reason; a short line with neither changes nothing.
    expect(applyReceipt(deliveries(stop), { ...write, reason: 'missing' }).deliveries[0]!.receipt!.report!.lines[0]!.reason).toBe('damaged');
    const list = deliveries(stop);
    expect(applyReceipt(list, { ...write, lines: write.lines.map((each) => ({ ...each, reason: null })) })).toBe(list);
  });

  it('Q-40 reads a report kept before lines had reasons as its one reason on each short line, and none on a line counted for the cold', () => {
    const report = { reason: 'missing' as const, lines: [{ lineId: 'a', counted: 1 }, { lineId: 'b', counted: 0 }] };
    expect(report.lines.map((each) => lineReason(report, each))).toEqual(['missing', null]);
    expect(lineReason({ reason: 'not_cold' }, { counted: 0 })).toBeNull();
    expect(reportReasons(report)).toEqual(['missing']);
  });

  it('AC-5 leaves out of a not-cold report a chilled line handed over at 0, since nothing came on it', () => {
    const stop = delivery('03:48', [line('chilled', 48, 48, 0), line('chilled', 10, 10, 10), line('dry', 46, 46, 46)], 'refused');
    const write = receipt(stop, [0, 10, 46], { cold: false });
    expect(applyReceipt(deliveries(stop), write).deliveries[0]!.receipt!.report!.lines).toEqual([{ lineId: stop.lines[1]!.lineId, counted: 0, reason: null }]);
  });

  it('AC-5 changes nothing for a receipt whose id the deliveries list, or whose delivery is not in the list', () => {
    const stop = nugegoda();
    const write = receipt(stop, [11, 8, 3], { reason: 'missing' });
    const listed = { ...deliveries(stop), appliedWriteIds: [write.writeId] };
    expect(applyReceipt(listed, write)).toBe(listed);
    const elsewhere = deliveries(nugegoda());
    expect(applyReceipt(elsewhere, write)).toBe(elsewhere);
  });

  it('AC-5 changes nothing for a short receipt that says nothing about what is wrong, which the server refuses', () => {
    const stop = nugegoda();
    const list = deliveries(stop);
    expect(applyReceipt(list, receipt(stop, [11, 8, 3]))).toBe(list);
  });

  it('AC-5 answers in the server\'s order: those to confirm, oldest handover first, then those confirmed, latest first', () => {
    const early = nugegoda();
    const late = delivery('04:10', [line('dry', 5, 5, 5)]);
    const middle = delivery('03:50', [line('dry', 6, 6, 6)]);
    let list = deliveries(early, middle, late);
    list = applyReceipt(list, receipt(middle, [6], { at: at('08:20') }));
    expect(list.deliveries.map((d) => d.stopId)).toEqual([early.stopId, late.stopId, middle.stopId]);
    list = applyReceipt(list, receipt(early, [12, 8, 3], { at: at('08:31') }));
    expect(list.deliveries.map((d) => d.stopId)).toEqual([late.stopId, early.stopId, middle.stopId]);
    const ids = list.appliedWriteIds;
    expect(ids).toEqual([...ids].sort());
  });
});

describe('receiptView', () => {
  it('AC-5 drops a waiting receipt the deliveries list as applied and applies only the others, in order', () => {
    const first = nugegoda();
    const second = delivery('04:10', [line('dry', 5, 5, 5)]);
    const applied = receipt(first, [11, 8, 3], { reason: 'missing' });
    const waiting = receipt(second, [4], { reason: 'damaged' });
    const fetched = applyReceipt(deliveries(first, second), applied);
    const view = receiptView(fetched, [applied, waiting]);
    expect(view.writes).toEqual([waiting]);
    expect(view.deliveries).toEqual(applyReceipt(fetched, waiting));
    expect(receiptView(fetched, [applied])).toEqual({ deliveries: fetched, writes: [] });
  });
});

describe('deliveryFigures', () => {
  it('AC-5 gives each line\'s expected, received, short, short from the depot and refused units, the totals, and that chilled goods came', () => {
    const stop = nugegoda();
    const before = deliveryFigures(stop);
    expect(before.byLine.map(({ expected, received, short, shortFromDepot, refused }) => [expected, received, short, shortFromDepot, refused])).toEqual([
      [12, null, 0, 0, 0], [8, null, 0, 0, 0], [3, null, 0, 1, 0],
    ]);
    expect(before).toMatchObject({ expected: 23, received: null, short: 0, shortFromDepot: 1, refused: 0, chilled: true });
    const after = deliveryFigures(applyReceipt(deliveries(stop), receipt(stop, [11, 8, 3], { reason: 'missing' })).deliveries[0]!);
    expect(after.byLine.map(({ lineId, temp, expected, received, short }) => [lineId, temp, expected, received, short])).toEqual([
      [stop.lines[0]!.lineId, 'chilled', 12, 11, 1], [stop.lines[1]!.lineId, 'chilled', 8, 8, 0], [stop.lines[2]!.lineId, 'dry', 3, 3, 0],
    ]);
    expect(after).toMatchObject({ expected: 23, received: 22, short: 1, shortFromDepot: 1, refused: 0, chilled: true });
  });

  it('AC-5 counts what the shop refused at the door, and no chilled goods came when the chilled line was handed over at 0', () => {
    const wellawatte = delivery('03:48', [line('chilled', 48, 48, 46), line('dry', 46, 46, 46)], 'refused');
    expect(deliveryFigures(wellawatte)).toMatchObject({ expected: 92, refused: 2, shortFromDepot: 0, chilled: true });
    expect(deliveryFigures(wellawatte).byLine.map((l) => l.refused)).toEqual([2, 0]);
    const allRefused = delivery('03:48', [line('chilled', 48, 48, 0), line('dry', 46, 46, 46)], 'refused');
    expect(deliveryFigures(allRefused)).toMatchObject({ expected: 46, refused: 48, chilled: false });
    expect(deliveryFigures(delivery('03:48', [line('dry', 6, 6, 6)])).chilled).toBe(false);
  });
});
