import type { BoardSuggestion, PlanBoard, PlanRef } from '@wayfinder/contracts';
import { suggestPlan, type Undo } from '../board';
import { suggestedAt, toMake } from '../words';

// The board's queue running a write (board.ts act): it says why the write was refused, or null, and hands on the board
// it answered once the board has taken it.
export type BuildAct = (run: (date: string, ref: PlanRef) => Promise<PlanBoard>, done?: (board: PlanBoard) => void, said?: Undo) => Promise<string | null>;

export const BUILT: Undo = { line: 'Suggested plan built', tripKey: null };

// "Build the suggested plan" (spec 014), then View plan for the day the build answered, where its trips, decisions and
// checks are laid out (Nabil, 1 Oct, with spec 023). A refused build says why and stays on the board, and so does one
// that loaded the board again, with spec 010's line.
export async function buildPlan(act: BuildAct, open: (date: string) => void): Promise<string | null> {
  const taken: { board?: PlanBoard } = {};
  // The build is one step of the board's history, which Undo puts back as the draft before it (spec 027).
  const refused = await act((date, ref) => suggestPlan(date, ref), (board) => { taken.board = board; }, BUILT);
  const day = taken.board?.day;
  if (refused === null && day) open(day.date);
  return refused;
}

// The line under "No trip open" after a build: "Suggested plan · 16:01 · 6 decisions to make", the rows View plan lists
// as open counted and nothing else. None while the draft holds nothing of the suggestion, as after Start over or an
// Undo back past the build, so it never says there is nothing to decide about a plan that is not there (L-18).
export function suggestionLine(suggestion: BoardSuggestion | null): { at: string; open: number; toMake: string } | null {
  if (!suggestion?.inDraft) return null;
  const open = suggestion.decisions.filter((decision) => decision.open).length;
  return { at: suggestedAt(suggestion.builtAt), open, toMake: toMake(open) };
}
