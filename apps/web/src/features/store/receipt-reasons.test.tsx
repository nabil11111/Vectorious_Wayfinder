import { deliveryFigures, type StoreDelivery, type StoreReceipt } from '@wayfinder/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CountCard, ReceivedCard } from './parts/ReceiptLineCard';
import { ReceiptNote } from './parts/ReceiptNote';
import { receiptRequest } from './receipt-counts';
import { sentStatus } from './words';

// Q-40: each short line of a receipt says what is wrong with it, and the receipt takes a note of up to 200 characters.
// Tech Kandy City Centre's delivery as phase 5 met it: a refrigerator crate came damaged and a pallet never came.

const id = (n: number) => `9c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tech: StoreDelivery = {
  stopId: id(900), revision: 2, day: '2026-06-25', vehicleId: 'VEH045', driver: 'Saman', arrivedAt: '2026-06-24T23:10:00.000Z', doneAt: '2026-06-24T23:20:00.000Z',
  outcome: 'delivered', late: false, refusalReason: null, receipt: null,
  lines: [
    { lineId: id(1), orderId: id(11), temp: 'dry', productId: 'tech-fridge', name: 'Refrigerators', unit: 'crate of 2', ordered: 2, loaded: 2, wontFit: 0, delivered: 2, received: null },
    { lineId: id(2), orderId: id(11), temp: 'dry', productId: 'tech-small', name: 'Small appliances', unit: 'pallet', ordered: 2, loaded: 2, wontFit: 0, delivered: 2, received: null },
    { lineId: id(3), orderId: id(11), temp: 'dry', productId: 'tech-tv', name: 'Televisions', unit: 'box', ordered: 3, loaded: 3, wontFit: 0, delivered: 3, received: null },
  ],
};
const figures = deliveryFigures(tech).byLine;
const card = (i: number, count: number, reason: 'missing' | 'damaged') => renderToStaticMarkup(
  <CountCard brand="Tech" line={tech.lines[i]!} figures={figures[i]!} count={count} text={undefined} reason={reason} disabled={false}
    onStep={() => {}} onType={() => {}} onLeave={() => {}} onReason={() => {}} />,
);

describe('Q-40 a reason for each short line', () => {
  it('asks "What\'s wrong?" on each short line, with that line\'s own answer chosen, and not on a full one', () => {
    const crate = card(0, 1, 'damaged');
    expect(crate).toContain('What’s wrong?');
    expect(crate).toMatch(/aria-checked="true"[^>]*>Damaged</);
    expect(crate).toMatch(/aria-checked="false"[^>]*>Missing</);
    expect(crate).toContain('1 crate of 2 damaged');
    const pallet = card(1, 1, 'missing');
    expect(pallet).toMatch(/aria-checked="true"[^>]*>Missing</);
    expect(pallet).toContain('1 pallet missing');
    expect(card(2, 3, 'missing')).not.toContain('What’s wrong?');
  });

  it('sends each short line with its own reason and a full line with none, and the note only with a report', () => {
    const write = receiptRequest(tech, {
      writeId: id(500), at: '2026-06-25T03:26:00.000Z', counts: [1, 1, 3], reasons: { [id(1)]: 'damaged' }, cold: true,
      note: '  The crate\'s door is dented.  ', photo: null,
    });
    expect(write.lines).toEqual([
      { lineId: id(1), received: 1, reason: 'damaged' }, { lineId: id(2), received: 1, reason: 'missing' }, { lineId: id(3), received: 3, reason: null },
    ]);
    expect(write).toMatchObject({ reason: null, cold: null, note: 'The crate\'s door is dented.' });
    expect(write).not.toHaveProperty('photo');
    // Nothing wrong: no note goes, whatever the box held.
    const fine = receiptRequest(tech, { writeId: id(501), at: '2026-06-25T03:26:00.000Z', counts: [2, 2, 3], reasons: {}, cold: true, note: 'All good', photo: null });
    expect(fine).not.toHaveProperty('note');
    expect(fine.lines.every((line) => line.reason === null)).toBe(true);
  });

  it('shows each line\'s own reason on the saved and sent receipt, a receipt kept with one reason as that reason, and the note', () => {
    const received = (n: number) => ({ ...figures[n]!, received: 1, short: 1 });
    expect(renderToStaticMarkup(<ReceivedCard brand="Tech" line={tech.lines[0]!} figures={received(0)} reason="damaged" />)).toMatch(/Damaged<\/dt><dd[^>]*>1 crate of 2</);
    expect(renderToStaticMarkup(<ReceivedCard brand="Tech" line={tech.lines[1]!} figures={received(1)} reason="missing" />)).toMatch(/Missing<\/dt><dd[^>]*>1 pallet</);
    const note = renderToStaticMarkup(<ReceiptNote note="The crate's door is dented." />);
    expect(note).toContain('Your note');
    expect(note).toContain('The crate&#x27;s door is dented.');
    expect(renderToStaticMarkup(<ReceiptNote note={null} />)).toBe('');
  });

  it('says a report of damaged and missing goods is both, before and after the depot answers', () => {
    const receipt = (decision: 'no_replacement' | null): StoreReceipt => ({
      at: '2026-06-25T03:26:00.000Z', sentAt: '2026-06-25T03:27:00.000Z', cold: null,
      report: { id: id(500), reason: 'damaged', lines: [{ lineId: id(1), counted: 1, reason: 'damaged' }, { lineId: id(2), counted: 1, reason: 'missing' }], note: null,
        decision, decidedAt: decision ? '2026-06-25T03:28:00.000Z' : null, replacement: null },
    });
    expect(sentStatus(receipt(null), 'Tech', 2, ['dry', 'dry'])).toMatchObject({
      sentences: ['The depot has your receipt and report.', 'The 2 damaged and missing items still need a resolution.', 'Reporting them does not mark them as replaced.'],
      foot: 'Sent at 08:57 · report unresolved',
    });
    expect(sentStatus(receipt('no_replacement'), 'Tech', 2, ['dry', 'dry']).sentences[0]).toBe('The depot will not replace the 2 damaged and missing items.');
  });
});
