import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { Me, type LoginRequest, type Role } from '@wayfinder/contracts';
import { api, ApiRequestError } from '@/lib/api';

export const meKey = ['me'] as const;
const ACCOUNT_KEY = 'wayfinder-account';

function keepAccount(me: Me | null) {
  try {
    // Discard a previous account first: a quota failure must never restore another driver's identity.
    localStorage.removeItem(ACCOUNT_KEY);
    if (me) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(me));
  } catch (error) { console.warn('Could not keep the signed-in account on this phone.', error); }
  return me;
}
function keptAccount(): Me | undefined {
  try {
    const text = localStorage.getItem(ACCOUNT_KEY);
    if (text === null) return undefined;
    const parsed = Me.safeParse(JSON.parse(text));
    if (!parsed.success) { localStorage.removeItem(ACCOUNT_KEY); return undefined; }
    return parsed.data;
  } catch (error) { console.warn('Could not read the kept account on this phone.', error); return undefined; }
}

// An account the server just answered with, such as a dispatcher's after a depot switch (spec 020): on screen at once,
// and kept for the next load.
export function takeAccount(qc: QueryClient, me: Me) {
  qc.setQueryData(meKey, keepAccount(me));
}

// Whom the screen works for: the account signed in and the depot it works on, which a dispatcher can switch (spec 020).
// A write's answer is taken only while this is still what it was when the write went out.
export function workingFor(qc: QueryClient) {
  const me = qc.getQueryData<Me | null>(meKey);
  return me ? `${me.id} ${me.depotId}` : null;
}


// The driver's area keeps its account and screens through a 401, so the trip and the records kept on the phone stay
// in reach, and its own line asks the driver to sign in again (spec 013, AC-45). It holds this while it is open, and
// a 401 anywhere else still signs out at once.
let keptThroughSignOut = 0;
export function keepAccountThroughSignOut() {
  keptThroughSignOut += 1;
  return () => { keptThroughSignOut -= 1; };
}

// null means signed out; the query never throws for a plain 401.
export function useMe() {
  const qc = useQueryClient();
  useEffect(() => {
    // Clear both forms of identity so the login page can open immediately. Account-owned waiting writes stay.
    const signedOut = () => {
      if (keptThroughSignOut > 0) return;
      keepAccount(null);
      void qc.cancelQueries({ queryKey: meKey });
      qc.setQueryData(meKey, null);
    };
    window.addEventListener('wayfinder-signed-out', signedOut);
    return () => window.removeEventListener('wayfinder-signed-out', signedOut);
  }, [qc]);
  return useQuery({
    queryKey: meKey,
    initialData: keptAccount,
    initialDataUpdatedAt: 0,
    networkMode: 'always',
    queryFn: async ({ signal }) => {
      try {
        const me = await api<Me>('/auth/me', { signal });
        signal.throwIfAborted();
        return keepAccount(me);
      }
      catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) {
          const shown = qc.getQueryData<Me | null>(meKey);
          return keptThroughSignOut > 0 && shown ? shown : keepAccount(null);
        }
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

// The sign-in request (spec 018). It goes out whatever the browser says of the network, so with no signal it fails at
// once into the No signal line, and never waits to send the staff ID and PIN later on its own. Once an attempt has
// settled nothing keeps it: an attempt nobody watches leaves the cache at once, and attemptSignIn lets go of it.
export const loginMutation = (qc: QueryClient): UseMutationOptions<Me, Error, LoginRequest> => ({
  networkMode: 'always',
  gcTime: 0,
  onMutate: () => qc.cancelQueries({ queryKey: meKey }),
  mutationFn: (body) => api<Me>('/auth/login', { method: 'POST', json: body }),
  // A sign-in starts the screens afresh: nothing another account read stays in the cache to be shown again.
  onSuccess: async (me) => {
    await qc.cancelQueries({ queryKey: meKey });
    qc.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] });
    qc.setQueryData(meKey, keepAccount(me));
  },
});

export function useLogin() {
  const qc = useQueryClient();
  return useMutation(loginMutation(qc));
}

// One sign-in attempt from the page. However it ends, the mutation lets go of it, so its staff ID and PIN stay in no
// cache. The page keeps its own line and form, so it loses nothing by the reset.
export async function attemptSignIn(login: { mutateAsync: (body: LoginRequest) => Promise<Me>; reset: () => void }, body: LoginRequest) {
  try {
    return await login.mutateAsync(body);
  } finally {
    login.reset();
  }
}

// Sign-out waits this long at most for the work handed to it, so a request that never answers cannot hold it.
const SIGN_OUT_WAITS_MS = 5000;

// Work that must end before its person signs out, such as the shop's draft that is still saving (Q-04). Sign-out
// waits for all of it, 5 seconds at most. The work gets that deadline as a signal and ends by then, telling the person
// itself what it could not finish, so it never throws. A screen hands its work over here and takes it back with the
// function this returns.
const beforeSignOut = new Set<(deadline: AbortSignal) => Promise<void>>();
export function finishBeforeSignOut(work: (deadline: AbortSignal) => Promise<void>) {
  const entry = (deadline: AbortSignal) => work(deadline);
  beforeSignOut.add(entry);
  return () => { beforeSignOut.delete(entry); };
}

// The work handed to sign-out, until it has all ended or its deadline passes, whichever is first.
async function finishWork() {
  const deadline = new AbortController();
  const timer = window.setTimeout(() => deadline.abort(), SIGN_OUT_WAITS_MS);
  const passed = new Promise<void>((resolve) => { deadline.signal.addEventListener('abort', () => resolve(), { once: true }); });
  await Promise.race([Promise.all([...beforeSignOut].map((work) => work(deadline.signal))), passed]);
  window.clearTimeout(timer);
}

export const logoutMutation = (qc: QueryClient): UseMutationOptions<void, Error, void> => ({
  onMutate: () => qc.cancelQueries({ queryKey: meKey }),
  mutationFn: async () => {
    if (beforeSignOut.size) await finishWork();
    return api<void>('/auth/logout', { method: 'POST', json: {} });
  },
  // The screens on show must see the empty account before the rest of the cache goes, or they keep the old one.
  onSuccess: async () => {
    await qc.cancelQueries({ queryKey: meKey });
    keepAccount(null);
    qc.setQueryData(meKey, null);
    qc.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] });
    qc.getMutationCache().clear();
  },
});

export function useLogout() {
  const qc = useQueryClient();
  return useMutation(logoutMutation(qc));
}

export const HOME: Record<Role, string> = {
  store_manager: '/store',
  dispatcher: '/dispatcher',
  loader: '/loader',
  driver: '/driver',
  admin: '/admin',
};

export const ROLE_LABEL: Record<Role, string> = {
  store_manager: 'Store manager',
  dispatcher: 'Dispatcher',
  loader: 'Loader',
  driver: 'Driver',
  admin: 'Admin',
};
