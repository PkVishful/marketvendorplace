import { apiClient } from '@/lib/apiClient';
import type {
  AdminGrantableRole,
  AdminOrgUnit,
  AdminRolesResponse,
  AdminSettingRow,
  AdminUserRow,
} from '@/types/domain';

export const adminKeys = {
  users: (q: string, role: string, page: number) => ['admin', 'users', q, role, page] as const,
  orgUnits: ['admin', 'org-units'] as const,
  roles: ['admin', 'roles'] as const,
  settings: ['admin', 'settings'] as const,
  userActivities: (userId: string) => ['admin', 'users', userId, 'activities'] as const,
  grantableRoles: (orgUnitId: string) => ['admin', 'grantable-roles', orgUnitId] as const,
};

export interface UserActivity {
  seq: number;
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
  payload: unknown;
}

export const fetchUserActivities = (userId: string) =>
  apiClient.get<UserActivity[]>(`/api/admin/users/${userId}/activities`);

export const updateAdminUser = (
  userId: string,
  body: { fullName?: string; phone?: string; email?: string; isActive?: boolean },
) => apiClient.patch<AdminUserRow>(`/api/admin/users/${userId}`, body);

export interface AdminUsersPage {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const fetchAdminUsers = (q: string, role: string, page: number) =>
  apiClient.get<AdminUsersPage>(
    `/api/admin/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(role)}&page=${page}`,
  );

export const fetchAdminOrgUnits = () => apiClient.get<AdminOrgUnit[]>('/api/admin/org-units');

export const createAdminUser = (body: {
  fullName: string;
  phone: string;
  orgUnitId: string;
  roleCode: string;
  expiresAt?: string | null;
}) => apiClient.post<{ userId: string }>('/api/admin/users', body);

export const grantAdminRole = (userId: string, body: { roleCode: string; orgUnitId: string }) =>
  apiClient.post<{ id: string }>(`/api/admin/users/${userId}/roles`, body);

export const revokeAdminRole = (userId: string, roleCode: string, orgUnitId: string) =>
  apiClient.delete<{ revoked: boolean }>(
    `/api/admin/users/${userId}/roles/${roleCode}?orgUnitId=${orgUnitId}`,
  );

export const fetchAdminRoles = () => apiClient.get<AdminRolesResponse>('/api/admin/roles');

export const createAdminRole = (body: {
  code: string;
  name: string;
  description?: string;
  permissions: string[];
}) => apiClient.post('/api/admin/roles', body);

export const setRolePermissions = (code: string, permissions: string[]) =>
  apiClient.put<{ code: string; permissions: string[] }>(
    `/api/admin/roles/${code}/permissions`,
    { permissions },
  );

export const fetchAdminSettings = () => apiClient.get<AdminSettingRow[]>('/api/admin/settings');

export const setAdminSetting = (key: string, value: unknown) =>
  apiClient.put<AdminSettingRow>(`/api/admin/settings/${key}`, { value });

export const fetchGrantableRoles = (orgUnitId: string) =>
  apiClient.get<AdminGrantableRole[]>(
    `/api/admin/grantable-roles?orgUnitId=${encodeURIComponent(orgUnitId)}`,
  );
