import { ClosedReason, type HistoryClosedAttempt, type HistoryLine, type HistoryProblem, type Issue, type LookupPhoto } from '@wayfinder/contracts';
import type { photos } from '../db/schema';

export type PhotoFact = Pick<typeof photos.$inferSelect, 'stopId' | 'issueId' | 'takenAt'>;
export function photoOf(row: PhotoFact | undefined): LookupPhoto | null {
  if (!row) return null;
  return row.issueId === null ? { kind: 'proof', stopId: row.stopId, takenAt: row.takenAt.toISOString() }
    : { kind: 'issue', issueId: row.issueId, takenAt: row.takenAt.toISOString() };
}
export function problemOf(problem: Issue, stopLines: HistoryLine[], pictures: PhotoFact[]): HistoryProblem {
  const { trip: _trip, stop, ...facts } = problem;
  const lines = problem.lines.map(line => {
    // A closed issue keeps its own attempt, even after a successful retry of this stop.
    if (problem.kind === 'closed') return line;
    const own = stopLines.find(row => row.lineId === line.lineId);
    if (!own) throw new Error(`Problem ${problem.id} has no history line ${line.lineId}.`);
    return { ...line, loaded: own.loaded, delivered: own.delivered, received: own.received };
  });
  return { ...facts, lines, stopId: stop.id, photo: photoOf(pictures.find(row => row.issueId === problem.id)) };
}
export function attemptsOf(problems: Issue[], pictures: PhotoFact[]): HistoryClosedAttempt[] {
  return problems.filter(problem => problem.kind === 'closed').map(problem => ({
    issueId: problem.id, raisedAt: problem.raisedAt, raisedBy: problem.raisedBy, reason: ClosedReason.parse(problem.reason), note: problem.note,
    // Only immutable counted values: Issue.stop and the orders' later receipt never enter an earlier attempt.
    lines: problem.lines.map(({ lineId, orderId, temp, productId, name, unit, counted }) => ({ lineId, orderId, temp, productId, name, unit, counted })),
    notDelivered: problem.lines.reduce((sum, line) => sum + line.counted, 0), photo: photoOf(pictures.find(row => row.issueId === problem.id)),
    decision: problem.decision, decidedBy: problem.decidedBy, decidedAt: problem.decidedAt,
  }));
}
