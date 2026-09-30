import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DecideIssueRequest, DecideIssueResponse, Issue, IssueList, LoadingDecision } from '@wayfinder/contracts';
import { ANSWER_WITHIN_MS, worthRetrying } from '@/features/loader/loading';
import { reasonOf } from '@/features/store/words';
import { api } from '@/lib/api';

// What needs the dispatcher (spec 012, plan.md "The screen"): Live day's column and the bell read GET /issues under
// ['issues'], so the live stream's issues message fetches it again on every dispatcher page (spec 008).
export const issuesKey = ['issues'] as const;

export function useIssues() {
  return useQuery({ queryKey: issuesKey, queryFn: () => api<IssueList>('/issues') });
}

export interface Answering {
  // The problem whose answer is on its way.
  sending: string | null;
  // The problem whose answer got no answer back, for "Could not send. Try again."
  failed: string | null;
  // The server's sentence when it refused the answer.
  refused: string | null;
  // The problem answered last, for the green line. It stays until the next answer or a reload.
  sent: Issue | null;
  decide: (issue: Issue, decision: LoadingDecision) => void;
}

// The answer to a problem (D-37). It names the revision of the problem on screen. The answer comes back with the open
// list, but the list is fetched again instead (AC-33): an answer can arrive after a newer read and would bring back a
// problem as it was. Only the decided problem is kept from it, for the green line.
export function useAnswer(): Answering {
  const qc = useQueryClient();
  const [state, setState] = useState<Omit<Answering, 'decide'>>({ sending: null, failed: null, refused: null, sent: null });
  // One answer at a time: a second tap before the screen redraws must not send it again.
  const running = useRef(false);

  const decide = async (issue: Issue, decision: LoadingDecision) => {
    if (running.current) return;
    running.current = true;
    setState((held) => ({ ...held, sending: issue.id, failed: null, refused: null }));
    try {
      const answer = await api<DecideIssueResponse>(`/issues/${encodeURIComponent(issue.id)}/decide`, {
        method: 'POST', json: { revision: issue.revision, decision } satisfies DecideIssueRequest, signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
      });
      await qc.invalidateQueries({ queryKey: issuesKey });
      setState({ sending: null, failed: null, refused: null, sent: answer.decided });
    } catch (error) {
      if (!worthRetrying(error)) await qc.invalidateQueries({ queryKey: issuesKey });
      setState((held) => (worthRetrying(error) ? { ...held, sending: null, failed: issue.id } : { ...held, sending: null, refused: reasonOf(error) }));
    } finally {
      running.current = false;
    }
  };

  return { ...state, decide: (issue, decision) => { void decide(issue, decision); } };
}
