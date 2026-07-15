import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, ApiError } from '@/lib/apiClient';
import type { Session } from '@/types/domain';

export type { Session };

export function useSession() {
  return useQuery<Session>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await apiClient.get<Session>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return { authenticated: false };
        }
        throw err;
      }
    },
    retry: false,
    staleTime: Infinity,
  });
}

export function useDevLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.post<Session>('/api/dev/login', { userId }),
    onSuccess: () => {
      qc.clear();
      void qc.invalidateQueries();
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/api/auth/logout'),
    onSuccess: () => {
      qc.clear();
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useOtpSend() {
  return useMutation({
    mutationFn: (phone: string) =>
      apiClient.post<{
        sent: boolean;
        maskedPhone: string;
        requiresMfa: boolean;
        /** Present only on demo builds (DEMO_MODE=true, never in production). */
        demoOtp?: string;
        demoMfa?: string;
      }>(
        '/api/auth/otp/send',
        { phone },
      ),
  });
}

export function useOtpVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone: string; otp: string; mfaCode?: string }) =>
      apiClient.post<Session>('/api/auth/otp/verify', body),
    onSuccess: () => {
      qc.clear();
      void qc.invalidateQueries();
    },
  });
}
