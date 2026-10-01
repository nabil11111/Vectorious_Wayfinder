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

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    onMutate: () => qc.cancelQueries({ queryKey: meKey }),
    mutationFn: () => api<void>('/auth/logout', { method: 'POST', json: {} }),
    // The screens on show must see the empty account before the rest of the cache goes, or they keep the old one.
    onSuccess: async () => {
      await qc.cancelQueries({ queryKey: meKey });
      keepAccount(null);
      qc.setQueryData(meKey, null);
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== meKey[0] });
      qc.getMutationCache().clear();
    },
  });
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
