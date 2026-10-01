import type { HistoryLine, HistoryMeasure, HistoryStages } from '@wayfinder/contracts';

// Coverage counts lines, not shops or orders. A missing stage must not become a recorded zero.
function measure(values: (number | null)[]): HistoryMeasure {
  const known = values.filter((value): value is number => value !== null);
  return { units: known.length === values.length ? known.reduce((sum, value) => sum + value, 0) : null, known: known.length, total: values.length };
}
export function stagesOf(lines: HistoryLine[]): HistoryStages {
  return { ordered: lines.reduce((sum, line) => sum + line.quantity, 0), loaded: measure(lines.map(line => line.loaded)),
    handedOver: measure(lines.map(line => line.delivered)), received: measure(lines.map(line => line.received)),
    depotShort: measure(lines.map(line => line.depotShort)), refused: measure(lines.map(line => line.refused)),
    receiptShort: measure(lines.map(line => line.receiptShort)), notDelivered: measure(lines.map(line => line.notDelivered)) };
}
