import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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


// Any API 401 invalidates the account kept for offline startup. Waiting writes stay under their owner.
window.addEventListener('wayfinder-signed-out', () => keepAccount(null));

// null means signed out; the query never throws for a plain 401.
export function useMe() {
  return useQuery({
    queryKey: meKey,
    initialData: keptAccount,
    initialDataUpdatedAt: 0,
    networkMode: 'always',
    queryFn: async () => {
      try { return keepAccount(await api<Me>('/auth/me')); }
      catch (e) { if (e instanceof ApiRequestError && e.status === 401) return keepAccount(null); throw e; }
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api<Me>('/auth/login', { method: 'POST', json: body }),
    onSuccess: (me) => qc.setQueryData(meKey, keepAccount(me)),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST', json: {} }),
    onSuccess: () => { keepAccount(null); qc.setQueryData(meKey, null); qc.clear(); },
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
