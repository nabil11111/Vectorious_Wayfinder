import type { Me } from '@wayfinder/contracts';
import type { BoardScreen } from '../board';
import { sameDraft } from '../draft';

export function scenarioIdentity(screen: BoardScreen, me: Me | null | undefined, scope: string | null, generation: number | null | undefined, vehicle: string, blocked: boolean): string | null {
  const { board, draft } = screen;
  if (!me || me.depotId !== board.depot || scope !== board.depot || generation !== board.demoDay || blocked
    || !board.day?.open || board.plan.status !== 'draft' || board.plan.lockedReason || screen.saving !== 'saved' || screen.acting
    || !board.vehicles.some((v) => v.id === vehicle && v.working) || !sameDraft(draft, board.plan)) return null;
  // Content matters even when an order or vehicle change does not increment a plan revision.
  return JSON.stringify([me.id, me.depotId, generation, board, draft, vehicle]);
}
