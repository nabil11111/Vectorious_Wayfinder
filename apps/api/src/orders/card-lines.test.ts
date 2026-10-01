import { describe, expect, it } from 'vitest';
import { problemLineOf, type ProblemLineFacts } from './card-lines';

// Q-36: each answer line on a shop's card names the cartons it is about, so a refusal answered with replacements and a
// report answered with none no longer read as one contradicting the other. The server words them; the card lays them
// out. Kotahena's chilled order as phase 5 met it, and the other kinds and answers.

const FRI = '2026-06-26';
const facts = (more: Partial<ProblemLineFacts>): ProblemLineFacts => ({
  kind: 'receipt', brand: 'Fresh', temp: 'chilled', lines: [], refusalReason: null, warm: false, decision: null, replacementDay: null, ...more,
});

describe('Q-36 a card\'s answer lines name their cartons', () => {
  it('words Kotahena\'s refusal and report apart: 3 expired cartons replaced on Friday, 2 missing ones not', () => {
    expect(problemLineOf(facts({ kind: 'refused', lines: [{ counted: 3, reason: null }], refusalReason: 'expired', decision: 'send_replacements', replacementDay: FRI })))
      .toBe('3 expired chilled cartons: replacements come on Fri 26 Jun');
    expect(problemLineOf(facts({ temp: 'dry', lines: [{ counted: 2, reason: 'missing' }], decision: 'no_replacement' })))
      .toBe('2 missing dry cartons: no replacement');
  });

  it('says a refusal waiting, sent back, or replaced, one carton and many', () => {
    const refused = (decision: ProblemLineFacts['decision'], counted = 2, reason: ProblemLineFacts['refusalReason'] = 'damaged') =>
      problemLineOf(facts({ kind: 'refused', lines: [{ counted, reason: null }], refusalReason: reason, decision, replacementDay: decision === 'send_replacements' ? FRI : null }));
    expect(refused(null)).toBe('2 damaged chilled cartons: the depot decides what happens to them');
    expect(refused('bring_back')).toBe('2 damaged chilled cartons: they go back to the depot');
    expect(refused('bring_back', 1)).toBe('1 damaged chilled carton: it goes back to the depot');
    expect(refused('send_replacements', 1)).toBe('1 damaged chilled carton: a replacement comes on Fri 26 Jun');
    expect(refused(null, 2, 'not_ordered')).toBe('2 chilled cartons you did not order: the depot decides what happens to them');
  });

  it('says a report waiting or answered, by each reason on the order, and warm chilled goods', () => {
    expect(problemLineOf(facts({ lines: [{ counted: 1, reason: 'missing' }] }))).toBe('1 missing chilled carton: the depot is reviewing your report');
    expect(problemLineOf(facts({ lines: [{ counted: 1, reason: 'missing' }], decision: 'send_replacements', replacementDay: FRI }))).toBe('1 missing chilled carton: a replacement comes on Fri 26 Jun');
    // Akuressa: every carton came, warm.
    expect(problemLineOf(facts({ lines: [{ counted: 0, reason: null }], warm: true, decision: 'no_replacement' }))).toBe('Chilled cartons that came warm: no replacement');
    // A replacement answers the units short, never warm cartons that all came.
    expect(problemLineOf(facts({ lines: [{ counted: 0, reason: null }], warm: true, decision: 'send_replacements', replacementDay: FRI }))).toBe('Chilled cartons that came warm: no replacement');
    // Tech Kandy City Centre: a damaged crate and a missing pallet on one order.
    expect(problemLineOf(facts({ brand: 'Tech', temp: 'dry', lines: [{ counted: 1, reason: 'damaged' }, { counted: 1, reason: 'missing' }], decision: 'send_replacements', replacementDay: FRI })))
      .toBe('1 damaged item and 1 missing item: replacements come on Fri 26 Jun');
    expect(problemLineOf(facts({ brand: 'Style', temp: 'dry', lines: [{ counted: 4, reason: 'damaged' }, { counted: 2, reason: 'damaged' }] })))
      .toBe('6 damaged boxes: the depot is reviewing your report');
  });

  it('says a closed shop\'s answer about its cartons', () => {
    const closed = (decision: ProblemLineFacts['decision']) => problemLineOf(facts({ kind: 'closed', lines: [{ counted: 39, reason: null }], decision }));
    expect(closed(null)).toBe('39 chilled cartons: the depot decides, today or another day');
    expect(closed('try_again')).toBe('39 chilled cartons: the driver comes back after the other stops');
    // Q-41: brought back, it waits for the next plan, which gives it its new day.
    expect(closed('bring_back')).toBe('39 chilled cartons: brought back to the depot, waiting for the next plan');
  });
});
