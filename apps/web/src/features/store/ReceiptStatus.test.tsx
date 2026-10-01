import type { ReceiptWrite, StoreDelivery } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReceiptRecord } from './deliveries';
import { RefusedReceipt } from './ReceiptStatus';

// Q-37: Kotahena's 57 dry cartons on two devices. The phone, with no signal, saved 55 received and 2 damaged; the desktop
// confirmed all 57 first. The phone's receipt is refused as already confirmed: its report stays on screen, the screen
// says the delivery was confirmed on another device and what that confirmation said, and tells the manager how to
// raise anything more. Nothing goes without a word.

const id = (n: number) => `9c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const handed: StoreDelivery = {
  stopId: id(1), revision: 2, day: '2026-06-25', vehicleId: 'VEH038', driver: 'Lahiru', arrivedAt: '2026-06-24T22:33:00.000Z', doneAt: '2026-06-24T22:37:00.000Z',
  outcome: 'delivered', late: false, refusalReason: null, receipt: null,
  lines: [{ lineId: id(2), orderId: id(3), temp: 'dry', productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', ordered: 57, loaded: 57, wontFit: 0, delivered: 57, received: null }],
};
const depot: StoreDelivery = { ...handed, revision: 3, lines: [{ ...handed.lines[0]!, received: 57 }],
  receipt: { at: '2026-06-25T03:12:00.000Z', sentAt: '2026-06-25T03:12:13.000Z', cold: null, report: null } };
const write: ReceiptWrite = { kind: 'receipt', writeId: id(4), stopId: id(1), at: '2026-06-25T03:12:00.000Z', revision: 2,
  lines: [{ lineId: id(2), received: 55, reason: 'damaged' }], cold: null, reason: null, note: 'Two crushed under the pallet' };
const record: ReceiptRecord = { seq: 1, queue: 'shop', userId: id(9), write, about: 'Fresh Kotahena · VEH038 · Thu 25 Jun', savedAt: write.at, state: 'refused',
  refusal: { code: 'stale', message: 'This delivery was already confirmed.' }, shown: handed };
const drawn: StoreDelivery = { ...handed, revision: 3, lines: [{ ...handed.lines[0]!, received: 55 }],
  receipt: { at: write.at, sentAt: null, cold: null, report: { id: id(4), reason: 'damaged', lines: [{ lineId: id(2), counted: 2, reason: 'damaged' }], note: write.note!, decision: null, decidedAt: null, replacement: null } } };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '\'').replace(/&#x2019;/g, '’').replace(/\s+/g, ' ');

describe('Q-37 a report refused because another device confirmed first', () => {
  it('keeps the phone\'s report on screen, says the delivery was confirmed on another device and what it said, and how to raise more', () => {
    const shown = text(renderToStaticMarkup(<RefusedReceipt record={record} drawn={drawn} depot={depot} brand="Fresh" today="2026-06-25" onCleared={() => {}} />));
    expect(shown).toContain('The depot did not accept this receipt. This delivery was already confirmed.');
    expect(shown).toContain('Confirmed on another device at 08:42');
    // What that confirmation said, as the depot has it.
    expect(shown).toMatch(/Confirmed on another device at 08:42 .*Received 57 cartons .*All received/);
    // The phone's own report stays, with its note.
    expect(shown).toMatch(/What this phone recorded .*Received 55 cartons Damaged 2 cartons .*Two crushed under the pallet/);
    expect(shown).toContain('This phone’s report did not reach the depot. To report anything more, contact your depot using your store’s usual contact number.');
    expect(shown).toContain('Clear');
  });

  it('still says the report did not reach the depot when the depot\'s copy is not known', () => {
    const shown = text(renderToStaticMarkup(<RefusedReceipt record={record} drawn={drawn} depot={null} brand="Fresh" today="2026-06-25" onCleared={() => {}} />));
    expect(shown).not.toContain('Confirmed on another device');
    expect(shown).toContain('This phone’s report did not reach the depot.');
    expect(shown).toContain('Received 55 cartons');
  });
});
