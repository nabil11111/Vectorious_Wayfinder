import { useEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DecideIssueRequest, DecideIssueResponse, Issue, IssueDecision, IssueList, Me } from '@wayfinder/contracts';
import { meKey, workingFor } from '@/features/auth/api';
import { ANSWER_WITHIN_MS, fetchAgain, worthRetrying } from '@/features/loader/loading';
import { reasonOf } from '@/features/store/words';
import { readPhoto } from '@/features/lookup/api';
import { CLOSED, photoLoader, type PhotoView } from '@/features/lookup/queries';
import { clockKey, type HeldClock } from '@/lib/clock';
import { api, forDepot } from '@/lib/api';

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

// An issue's photo uses History's byte loader and viewer. The account, selected session depot and demo generation
// own it; the issue depot still names the record on Both. Observe ownership directly so an old response cannot emit
// a 401/depot event in the gap before React unmounts the card after a switch or reset.
const photoOwner = (qc: QueryClient) => JSON.stringify([workingFor(qc), qc.getQueryData<HeldClock>(clockKey)?.day ?? null]);
export function issuePhotoViewer(qc: QueryClient, issue: Pick<Issue, 'id' | 'raisedAt' | 'kind'> & { stop: Pick<Issue['stop'], 'shopName'> }, depot: string, onChange: (view: PhotoView) => void, owner = photoOwner(qc)) {
  let invalid = workingFor(qc) === null;
  const current = () => !invalid && owner === photoOwner(qc);
  const loader = photoLoader({
    read: (photo, signal) => readPhoto(photo, depot, signal),
    toUrl: (jpeg) => URL.createObjectURL(jpeg),
    revoke: (url) => URL.revokeObjectURL(url),
  }, onChange);
  const checkOwner = () => {
    if (!current()) { invalid = true; loader.close(); }
  };
  return {
    get view() { return current() ? loader.view : CLOSED; },
    // The issue and its photo are recorded together at the same write time.
    open: () => { if (current()) loader.open({ kind: 'issue', issueId: issue.id, takenAt: issue.raisedAt }, `${issue.kind === 'receipt' ? 'Shop' : 'Driver'} photo · ${issue.stop.shopName}`); },
    close: loader.close,
    retry: () => { if (current()) loader.retry(); },
    broken: loader.broken,
    watch: () => {
      const stop = qc.getQueryCache().subscribe(checkOwner);
      checkOwner();
      return () => { stop(); loader.close(); };
    },
  };
}

// Only the photo state is replaced. Opening/closing a photo never remounts the card's chosen answer.
export function useIssuePhoto(issue: Issue, depot: string) {
  const qc = useQueryClient();
  const { data: me } = useQuery<Me | null>({ queryKey: meKey, enabled: false });
  const { data: clock } = useQuery<HeldClock>({ queryKey: clockKey, enabled: false });
  const owner = JSON.stringify([me ? `${me.id} ${me.depotId}` : null, clock?.day ?? null]);
  const { id, raisedAt, kind, stop: { shopName } } = issue;
  type Controller = ReturnType<typeof issuePhotoViewer>;
  const [held, setHeld] = useState<{ controller: Controller; view: PhotoView } | null>(null);
  const controller = useMemo(() => {
    const next = issuePhotoViewer(qc, { id, raisedAt, kind, stop: { shopName } }, depot, (view) => setHeld({ controller: next, view }), owner);
    return next;
  }, [qc, id, raisedAt, kind, shopName, depot, owner]);
  useEffect(() => controller.watch(), [controller]);
  return { ...controller, view: held?.controller === controller ? controller.view : CLOSED };
}

// On both depots together (spec 021) each depot's part of Live day shows only its own answers: the green line of the
// answer sent last under the depot it was sent from, and the server's refusal of the latest answer under that answer's
// depot. So an answer from one part never shows in the other's, while another answer is on its way or after it failed.
// from names the depot each answer was sent from; decide is the part's own, which records it.
export interface SentFrom { byIssue: Readonly<Record<string, string>>; latest: string | null }
export function answeringIn(answering: Answering, depot: string, from: SentFrom, decide: Answering['decide']): Answering {
  return {
    ...answering,
    sent: answering.sent && from.byIssue[answering.sent.id] === depot ? answering.sent : null,
    refused: from.latest === depot ? answering.refused : null,
    decide,
  };
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
