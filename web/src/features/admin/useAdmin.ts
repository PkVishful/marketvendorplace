import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminKeys,
  createAdminRole,
  createAdminUser,
  fetchAdminOrgUnits,
  fetchAdminRoles,
  fetchAdminSettings,
  fetchAdminUsers,
  fetchGrantableRoles,
  grantAdminRole,
  revokeAdminRole,
  setAdminSetting,
  setRolePermissions,
  updateAdminUser,
} from './api';

export function useUpdateAdminUser() {
  const invalidate = useInvalidate([['admin', 'users']]);
  return useMutation({
    mutationFn: ({ userId, ...body }: {
      userId: string; fullName?: string; phone?: string; email?: string; isActive?: boolean;
    }) => updateAdminUser(userId, body),
    onSuccess: invalidate,
  });
}

export function useAdminUsers(q: string, role = '', page = 1) {
  return useQuery({
    queryKey: adminKeys.users(q, role, page),
    queryFn: () => fetchAdminUsers(q, role, page),
    // Keeps the previous page on screen while the next one loads, instead of
    // collapsing the table to a skeleton on every page click.
    placeholderData: (prev) => prev,
  });
}

export function useAdminOrgUnits() {
  return useQuery({
    queryKey: adminKeys.orgUnits,
    queryFn: fetchAdminOrgUnits,
    staleTime: 5 * 60_000,
  });
}

export function useAdminRoles() {
  return useQuery({ queryKey: adminKeys.roles, queryFn: fetchAdminRoles });
}

export function useAdminSettings() {
  return useQuery({ queryKey: adminKeys.settings, queryFn: fetchAdminSettings });
}

export function useGrantableRoles(orgUnitId: string) {
  return useQuery({
    queryKey: adminKeys.grantableRoles(orgUnitId),
    queryFn: () => fetchGrantableRoles(orgUnitId),
    enabled: Boolean(orgUnitId),
  });
}

function useInvalidate(keys: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => void qc.invalidateQueries({ queryKey: k as unknown[] }));
}

export function useCreateAdminUser() {
  const invalidate = useInvalidate([['admin', 'users']]);
  return useMutation({
    mutationFn: createAdminUser,
    onSuccess: invalidate,
  });
}

export function useGrantAdminRole() {
  const invalidate = useInvalidate([['admin', 'users']]);
  return useMutation({
    mutationFn: ({ userId, ...body }: { userId: string; roleCode: string; orgUnitId: string }) =>
      grantAdminRole(userId, body),
    onSuccess: invalidate,
  });
}

export function useRevokeAdminRole() {
  const invalidate = useInvalidate([['admin', 'users']]);
  return useMutation({
    mutationFn: ({
      userId,
      roleCode,
      orgUnitId,
    }: {
      userId: string;
      roleCode: string;
      orgUnitId: string;
    }) => revokeAdminRole(userId, roleCode, orgUnitId),
    onSuccess: invalidate,
  });
}

export function useCreateAdminRole() {
  const invalidate = useInvalidate([adminKeys.roles]);
  return useMutation({
    mutationFn: createAdminRole,
    onSuccess: invalidate,
  });
}

export function useSetRolePermissions() {
  const invalidate = useInvalidate([adminKeys.roles]);
  return useMutation({
    mutationFn: ({ code, permissions }: { code: string; permissions: string[] }) =>
      setRolePermissions(code, permissions),
    onSuccess: invalidate,
  });
}

export function useSetAdminSetting() {
  const invalidate = useInvalidate([adminKeys.settings, ['me']]);
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => setAdminSetting(key, value),
    onSuccess: invalidate,
  });
}
