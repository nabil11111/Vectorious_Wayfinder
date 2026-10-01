import { useRef, useState } from 'react';
import { queryOptions, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DecideIssueRequest, DecideIssueResponse, Issue, IssueDecision, IssueList } from '@wayfinder/contracts';
import { workingFor } from '@/features/auth/api';
import { ANSWER_WITHIN_MS, fetchAgain, worthRetrying } from '@/features/loader/loading';
import { reasonOf } from '@/features/store/words';
import { api, apiBytes, forDepot } from '@/lib/api';

// What needs the dispatcher (spec 012, plan.md "The screen"): Live day's column and the bell read GET /issues under
// ['issues'], so the live stream's issues message fetches it again on every dispatcher page (spec 008). Each read names
// the depot it reads, in its request and its key, so on both depots together each depot's problems are a read of their
// own (spec 021).
export const issuesKey = ['issues'] as const;
export const issuesKeyOf = (depot: string | null) => ['issues', depot] as const;

export const issuesOptions = (depot: string | null) => queryOptions({
  queryKey: issuesKeyOf(depot),
  queryFn: ({ signal }) => {
    if (depot === null) throw new Error('No depot to read the problems of.');
    return api<IssueList>(forDepot('/issues', depot), { signal });
  },
  enabled: depot !== null,
});

export function useIssues(depot: string | null) {
  return useQuery(issuesOptions(depot));
}

// Every depot's open problems the pages show: the session's depot, or Peliyagoda's and Kandy's in that order.
export function useIssueLists(depots: readonly string[]) {
  return useQueries({ queries: depots.map((depot) => issuesOptions(depot)) });
}

// The day a replacement placed now would be for (spec 015, rule 12), or null with no day open, from the list of the
// problem's depot the column already holds. It never fetches by itself: the column's own read keeps it current.
export function useReplaceOn(depot: string | null): string | null {
  const { data } = useQuery({ ...issuesOptions(depot), enabled: false, select: (list) => list.replaceOn });
  return data ?? null;
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
  // A loader's flag takes "Go short" or "Load it all", a driver's problem "Bring them back" or "Try again" (D-48), a
  // refusal "Send N replacements" too, and a shop's report "Send N replacements" or "No replacement" (D-58, D-59).
  decide: (issue: Issue, decision: IssueDecision) => void;
}

// A problem's photo in a tab of its own (spec 013). Its bytes come the shared way, which names the depot the tab shows
// (D-95), so a tab that fell behind hears the session moved, and the read names the problem's own depot (spec 021). The
// tab is opened at the press, before the bytes arrive, since a browser lets only a press open one, and the photo's
// address is given back once it has had time to open. It answers the line to show when the photo could not be opened,
// or null. Once signal aborts, because the card that asked went away with a sign-out or a depot switch, its answer is
// dropped, so an old session's 401 signs nobody out.
export const PHOTO_TAB_BLOCKED = 'The browser kept the photo from opening in a new tab.';
const PHOTO_KEPT_MS = 60_000;
export async function openIssuePhoto(issue: Pick<Issue, 'id'>, depot: string, signal?: AbortSignal): Promise<string | null> {
  const tab = window.open('', '_blank');
  if (!tab) return PHOTO_TAB_BLOCKED;
  try {
    const jpeg = await apiBytes(forDepot(`/issues/${encodeURIComponent(issue.id)}/photo`, depot), { signal });
    const address = URL.createObjectURL(jpeg);
    tab.location.href = address;
    window.setTimeout(() => URL.revokeObjectURL(address), PHOTO_KEPT_MS);
    return null;
  } catch (error) {
    tab.close();
    return signal?.aborted ? null : reasonOf(error);
  }
}

// Answers sent and not answered yet. A dispatcher's depot switch waits for none of them (spec 020).
let answering = 0;
export const answerOnItsWay = () => answering > 0;

// What became of an answer: the problem decided, no answer back, the server's refusal, or null when the screen works for
// another account or depot by the time it lands (spec 020), so nothing of it is shown.
type Outcome = { decided: Issue } | { failed: true } | { refused: string } | null;

// The answer to a problem (D-37). It names the revision of the problem on screen. The answer comes back with the open
// list, but the list is fetched again instead (AC-33): an answer can arrive after a newer read and would bring back a
// problem as it was. Only the decided problem is kept from it, for the green line.
export async function sendAnswer(qc: QueryClient, issue: Issue, decision: IssueDecision): Promise<Outcome> {
  const sentFor = workingFor(qc);
  let answer: DecideIssueResponse;
  answering += 1;
  try {
    answer = await api<DecideIssueResponse>(`/issues/${encodeURIComponent(issue.id)}/decide`, {
      method: 'POST', json: { revision: issue.revision, decision } satisfies DecideIssueRequest, signal: AbortSignal.timeout(ANSWER_WITHIN_MS),
    });
  } catch (error) {
    if (workingFor(qc) !== sentFor) return null;
    if (worthRetrying(error)) return { failed: true };
    await fetchAgain(qc, issuesKey);
    return { refused: reasonOf(error) };
  } finally {
    answering -= 1;
  }
  if (workingFor(qc) !== sentFor) return null;
  await fetchAgain(qc, issuesKey);
  return { decided: answer.decided };
}

export function useAnswer(): Answering {
  const qc = useQueryClient();
  const [state, setState] = useState<Omit<Answering, 'decide'>>({ sending: null, failed: null, refused: null, sent: null });
  // One answer at a time: a second tap before the screen redraws must not send it again.
  const running = useRef(false);

  const decide = async (issue: Issue, decision: IssueDecision) => {
    if (running.current) return;
    running.current = true;
    setState((held) => ({ ...held, sending: issue.id, failed: null, refused: null }));
    let outcome: Outcome;
    try {
      outcome = await sendAnswer(qc, issue, decision);
    } finally {
      running.current = false;
    }
    if (outcome === null) setState({ sending: null, failed: null, refused: null, sent: null });
    else if ('decided' in outcome) setState({ sending: null, failed: null, refused: null, sent: outcome.decided });
    else if ('failed' in outcome) setState((held) => ({ ...held, sending: null, failed: issue.id }));
    else setState((held) => ({ ...held, sending: null, refused: outcome.refused }));
  };

  return { ...state, decide: (issue, decision) => { void decide(issue, decision); } };
}
