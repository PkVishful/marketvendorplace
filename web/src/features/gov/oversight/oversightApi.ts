import { apiClient } from '@/lib/apiClient';
import type {
  FinanceSummary, FinanceDistrictRow, FinanceOrdersPage, FinanceOrderDetail,
  VendorEarningRow, OversightFlag,
} from '@/types/domain';

export const oversightKeys = {
  summary: ['gov', 'oversight', 'summary'] as const,
  districts: ['gov', 'oversight', 'districts'] as const,
  orders: (limit: number, offset: number, district?: string) => ['gov', 'oversight', 'orders', limit, offset, district ?? null] as const,
  order: (id: string) => ['gov', 'oversight', 'order', id] as const,
  vendors: ['gov', 'oversight', 'vendors'] as const,
  flags: ['gov', 'oversight', 'flags'] as const,
};

export const financeExportUrl = (table: 'districts' | 'orders' | 'vendors') =>
  `/api/gov/oversight/finance/export.csv?table=${table}`;

export const fetchFinanceSummary = () => apiClient.get<FinanceSummary>('/api/gov/oversight/finance/summary');
export const fetchFinanceDistricts = () => apiClient.get<FinanceDistrictRow[]>('/api/gov/oversight/finance/districts');
export const fetchFinanceOrders = (limit: number, offset: number, district?: string) =>
  apiClient.get<FinanceOrdersPage>(
    `/api/gov/oversight/finance/orders?limit=${limit}&offset=${offset}${district ? `&district=${encodeURIComponent(district)}` : ''}`,
  );
export const fetchFinanceOrder = (id: string) => apiClient.get<FinanceOrderDetail>(`/api/gov/oversight/finance/orders/${id}`);
export const fetchFinanceVendors = () => apiClient.get<VendorEarningRow[]>('/api/gov/oversight/finance/vendors');
export const fetchOversightFlags = () => apiClient.get<OversightFlag[]>('/api/gov/oversight/flags');
