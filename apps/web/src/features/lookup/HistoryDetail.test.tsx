import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { HistoryTrip, type HistoryLine, type HistoryMeasure } from '@wayfinder/contracts';
import { expect, it } from 'vitest';
import { HistoryDetail } from './HistoryDetail';
import { CLOSED, type PhotoViewer } from './queries';

// History's selected trip as the read sends it (spec 017, rules 6 to 8, spec 015's receipt): the page draws each stage
// and each confirmation from the read, says a stage or a confirmation that was never recorded, and keeps a closed visit
// as its own attempt. A missing receipt is never drawn as an empty one.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (hhmm: string, day = '25') => new Date(`2026-06-${day}T${hhmm}:00+05:30`).toISOString();
const shop = (outletId: string, name: string) => ({ id: outletId, name, brand: 'Fresh' as const, district: 'Colombo', windowOpen: '05:00:00', windowClose: '07:30:00', mallWindow: null });
const measure = (values: (number | null)[]): HistoryMeasure => {
  const known = values.filter((value): value is number => value !== null);
  const soFar = known.reduce((sum, value) => sum + value, 0);
  return { units: known.length === values.length ? soFar : null, known: known.length, total: values.length, missing: values.length - known.length, soFar };
};
const stagesOf = (lines: HistoryLine[]) => ({
  ordered: lines.reduce((sum, line) => sum + line.quantity, 0), loaded: measure(lines.map((line) => line.loaded)), handedOver: measure(lines.map((line) => line.delivered)),
  received: measure(lines.map((line) => line.received)), depotShort: measure(lines.map((line) => line.depotShort)), refused: measure(lines.map((line) => line.refused)),
  receiptShort: measure(lines.map((line) => line.receiptShort)), notDelivered: measure(lines.map((line) => line.notDelivered)),
});
const line = (n: number, temp: 'chilled' | 'dry', counts: Partial<HistoryLine> & { quantity: number }): HistoryLine => ({
  lineId: id(100 + n), orderId: id(200 + n), temp, productId: `fresh-${temp}-carton`, name: temp === 'chilled' ? 'Chilled carton' : 'Dry carton', unit: 'carton',
  loaded: null, delivered: null, received: null, depotShort: null, refused: null, receiptShort: null, notDelivered: null, ...counts,
});
const issue = (n: number, kind: 'loading' | 'refused' | 'closed' | 'receipt', fields: Record<string, unknown>) => ({
  id: id(600 + n), revision: 1, kind, status: 'decided', raisedBy: 'Dilshan', note: null, hasPhoto: false, short: 0, cold: null, replacement: null,
  decision: null, decidedBy: null, decidedAt: null, stopId: id(700 + n), photo: null, lines: [], ...fields,
});

const nugegodaLines = [
  line(1, 'chilled', { quantity: 12, loaded: 12, delivered: 12, received: 11, depotShort: 0, refused: 0, receiptShort: 1, notDelivered: 0 }),
  line(2, 'chilled', { quantity: 8, loaded: 8, delivered: 8, received: 8, depotShort: 0, refused: 0, receiptShort: 0, notDelivered: 0 }),
  line(3, 'dry', { quantity: 4, loaded: 3, delivered: 3, received: 3, depotShort: 1, refused: 0, receiptShort: 0, notDelivered: 0 }),
];
const wellawatteLines = [line(4, 'chilled', { quantity: 48, loaded: 48, delivered: 46, depotShort: 0, refused: 2, notDelivered: 0 })];
const stop = (n: number, name: string, lines: HistoryLine[], fields: Record<string, unknown>) => ({
  id: id(700 + n), seq: n, outlet: shop(`OUT00${n}`, name), orderIds: lines.map((each) => each.orderId), plannedArrival: at(n === 1 ? '05:00' : '05:24'),
  plannedDeparture: at(n === 1 ? '05:12' : '05:40'), windowOpen: at('05:00'), windowClose: at('07:30'), loadedAt: at('02:31'), arrivedAt: null, doneAt: null, outcome: null,
  lines, stages: stagesOf(lines), flags: { late: null, short: false, returned: false }, receipt: null, proof: null, problems: [], attempts: [], ...fields,
});

const trip = HistoryTrip.parse({
  tripId: id(800), planId: id(900), date: '2026-06-25', vehicleId: 'VEH035', vehicleType: 'van', vehicleTemp: 'reefer', archived: false, tripNo: 1,
  driver: { id: id(1), name: 'Dilshan' }, brand: 'Fresh', brands: ['Fresh'], district: 'Colombo', status: 'done',
  schedule: { leavesAt: at('04:36'), backAt: at('06:10'), load: { kg: 1000, m3: 5, units: 118, needsReefer: true, needsTailLift: false, keepUpright: false }, km: 7.2 },
  readyAt: at('02:35'), leftAt: at('04:40'), backAt: at('06:30'), flags: { late: false, short: true, returned: true }, stages: stagesOf([...nugegodaLines, ...wellawatteLines]),
  stops: [
    stop(1, 'Fresh Nugegoda', nugegodaLines, {
      arrivedAt: at('05:02'), doneAt: at('05:10'), outcome: 'delivered', flags: { late: false, short: true, returned: false },
      proof: { kind: 'proof', stopId: id(701), takenAt: at('05:10') },
      receipt: {
        stopId: id(701), confirmedAt: at('08:31'), sentAt: at('08:33'), cold: true, orderCount: 3,
        lines: nugegodaLines.map((each) => ({ lineId: each.lineId, orderId: each.orderId, received: each.received! })), received: 22, short: 1,
        report: { id: id(650), reason: 'missing', lines: [{ lineId: id(101), counted: 1 }], decision: 'send_replacements', decidedAt: at('08:40'),
          replacement: { day: '2026-06-26', units: 1 }, photo: { kind: 'issue', issueId: id(650), takenAt: at('08:31') } },
      },
      problems: [
        issue(1, 'loading', { reason: 'short', raisedBy: 'Kasun', raisedAt: at('02:33'), short: 1, decision: 'go_short', decidedBy: 'Ruwan', decidedAt: at('02:35'),
          lines: [{ lineId: id(103), orderId: id(203), temp: 'dry', productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', quantity: 4, counted: 3, loaded: 3, delivered: 3, received: 3 }] }),
        // The shop's report is also the stop's problem, with who answered it.
        issue(1, 'receipt', { id: id(650), reason: 'missing', raisedBy: 'Nadeesha', raisedAt: at('08:31'), short: 1, decision: 'send_replacements', decidedBy: 'Ruwan', decidedAt: at('08:40'),
          replacement: { day: '2026-06-26', units: 1 }, photo: { kind: 'issue', issueId: id(650), takenAt: at('08:31') },
          lines: [{ lineId: id(101), orderId: id(201), temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 12, counted: 1, loaded: 12, delivered: 12, received: 11 }] }),
      ],
    }),
    stop(2, 'Fresh Wellawatte', wellawatteLines, {
      arrivedAt: at('05:30'), doneAt: at('05:41'), outcome: 'refused', flags: { late: false, short: true, returned: true },
      problems: [issue(2, 'refused', { reason: 'damaged', raisedAt: at('05:40'), short: 2, decision: 'bring_back', decidedBy: 'Ruwan', decidedAt: at('05:45'),
        lines: [{ lineId: id(104), orderId: id(204), temp: 'chilled', productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', quantity: 48, counted: 2, loaded: 48, delivered: 46, received: null }] })],
    }),
  ],
});

const viewer: PhotoViewer = { view: CLOSED, open: () => {}, close: () => {}, retry: () => {}, broken: () => {} };
const textOf = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

it('History shows each stop\'s own shop confirmation and says one that is not there, never a signature or an empty receipt', () => {
  const text = textOf(<HistoryDetail trip={trip} brand="all" viewer={viewer} anchor="history-detail" onClose={() => {}} />);
  // The confirmed stop: the shop and its time, its orders and received cartons, the shortage on the receipt apart from
  // the one at the depot, the cold check, the report and the depot's answer with the replacement it placed.
  expect(text).toContain('Shop confirmation · Fresh Nugegoda');
  expect(text).toContain('confirmed 08:31 · reached the depot 08:33');
  expect(text).toContain('3 orders · 22 cartons received · 1 short on the receipt');
  expect(text).toContain('chilled goods arrived cold');
  expect(text).toContain('Report · 1 chilled carton missing');
  expect(text).toContain('answered Send replacements · Ruwan 08:40 · 1 carton on Fri 26 Jun');
  // The report is listed once, inside the confirmation, not again as a separate problem.
  expect(text).not.toContain('Shop report');
  expect(text).toContain('1 carton short from the depot · 1 carton short on the receipt');
  // Its proof opens in the viewer; the refusing stop has none, and no receipt yet, and says both.
  expect(text).toContain('Proof photo · 05:10');
  expect(text).toContain('Proof · No photo recorded');
  expect(text.match(/Not confirmed by the shop yet/g)).toHaveLength(1);
  expect(text).toContain('2 cartons refused');
  expect(text).toContain('Return instructed');
  // Answered problems stay listed, with who answered and when.
  expect(text).toContain('Flagged at the dock · short');
  expect(text).toContain('3 of 4 Dry carton at the dock');
  expect(text).toContain('answered Go short · Ruwan 02:35');
  expect(text).toContain('answered Bring them back · Ruwan 05:45');
  // The trip's stage totals: received is not recorded for the refusing stop's line, so it says the one line it is
  // missing, never the three it has (Q-44).
  expect(text).toContain('Received not recorded on 1 of 4 lines');
  expect(text).toContain('Handed over 69');
  expect(text).not.toMatch(/Signed|signature/i);
});

it('History keeps a closed visit as its own attempt, listed once, with its own time, counted lines and answer', () => {
  const closedLines = [
    line(5, 'chilled', { quantity: 48, loaded: 48, depotShort: 0, refused: 0, notDelivered: 48 }),
    line(6, 'dry', { quantity: 46, loaded: 46, depotShort: 0, refused: 0, notDelivered: 46 }),
  ];
  const counted = [
    { lineId: id(105), orderId: id(205), temp: 'chilled' as const, productId: 'fresh-chilled-carton', name: 'Chilled carton', unit: 'carton', counted: 48 },
    { lineId: id(106), orderId: id(206), temp: 'dry' as const, productId: 'fresh-dry-carton', name: 'Dry carton', unit: 'carton', counted: 46 },
  ];
  const closedIssue = issue(5, 'closed', { reason: 'nobody_there', raisedAt: at('05:45'), short: 94, decision: 'bring_back', decidedBy: 'Ruwan', decidedAt: at('05:50'),
    lines: counted.map((each) => ({ ...each, quantity: each.counted, loaded: each.counted, delivered: null, received: null })) });
  const closed = HistoryTrip.parse({
    ...trip, flags: { late: false, short: false, returned: true }, stages: stagesOf(closedLines),
    stops: [stop(5, 'Fresh Wellawatte', closedLines, {
      arrivedAt: at('05:40'), doneAt: at('05:45'), outcome: 'closed', flags: { late: false, short: false, returned: true }, problems: [closedIssue],
      attempts: [{ issueId: closedIssue.id, raisedAt: at('05:45'), raisedBy: 'Dilshan', reason: 'nobody_there', note: null, lines: counted,
        notDelivered: 94, photo: null, decision: 'bring_back', decidedBy: 'Ruwan', decidedAt: at('05:50') }],
    })],
  });
  const text = textOf(<HistoryDetail trip={closed} brand="all" viewer={viewer} anchor="history-detail" onClose={() => {}} />);
  expect(text.match(/Closed attempt · nobody there/g)).toHaveLength(1);
  expect(text).not.toContain('Nobody at the shop');
  expect(text).toContain('closed by Dilshan 05:45 · 94 cartons not delivered');
  // Each line the attempt counted is its own figure (rule 5), not only the total.
  expect(text).toContain('48 cartons · Chilled carton');
  expect(text).toContain('46 cartons · Dry carton');
  expect(text).toContain('answered Bring them back · Ruwan 05:50');
  // A closed stop handed nothing over, so it has no proof or receipt line to miss.
  expect(text).not.toContain('Not confirmed by the shop yet');
  expect(text).not.toContain('No photo recorded');
});

it('Q-40 History gives each line of the shop\'s report its own reason, and the report\'s note', () => {
  const [nugegoda, wellawatte] = trip.stops;
  const report = { ...nugegoda!.receipt!.report!, reason: 'damaged' as const, note: 'One crushed, the dry carton never came',
    lines: [{ lineId: id(101), counted: 1, reason: 'damaged' as const }, { lineId: id(103), counted: 1, reason: 'missing' as const }] };
  const reported = HistoryTrip.parse({ ...trip, stops: [{ ...nugegoda!, receipt: { ...nugegoda!.receipt!, report } }, wellawatte] });
  const text = textOf(<HistoryDetail trip={reported} brand="all" viewer={viewer} anchor="history-detail" onClose={() => {}} />);
  expect(text).toContain('Report · 1 chilled carton damaged, 1 dry carton missing');
  expect(text).toContain('Note · One crushed, the dry carton never came');
  // A report kept before lines had reasons reads its one reason on its short line.
  const kept = { ...report, reason: 'missing' as const, note: null, lines: [{ lineId: id(101), counted: 1 }] };
  const before = HistoryTrip.parse({ ...trip, stops: [{ ...nugegoda!, receipt: { ...nugegoda!.receipt!, report: kept } }, wellawatte] });
  const old = textOf(<HistoryDetail trip={before} brand="all" viewer={viewer} anchor="history-detail" onClose={() => {}} />);
  expect(old).toContain('Report · 1 chilled carton missing');
  expect(old).not.toContain('Note ·');
});
