import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LoginRequest, Me, Role } from '@wayfinder/contracts';
import { api, ApiRequestError } from '@/lib/api';

export const meKey = ['me'] as const;

// null means signed out; the query never throws for a plain 401.
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try { return await api<Me>('/auth/me'); }
      catch (e) { if (e instanceof ApiRequestError && e.status === 401) return null; throw e; }
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api<Me>('/auth/login', { method: 'POST', json: body }),
    onSuccess: (me) => qc.setQueryData(meKey, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST', json: {} }),
    onSuccess: () => { qc.setQueryData(meKey, null); qc.clear(); },
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
