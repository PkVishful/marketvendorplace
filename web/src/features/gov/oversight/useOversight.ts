import { useQuery } from '@tanstack/react-query';
import {
  oversightKeys, fetchFinanceSummary, fetchFinanceDistricts, fetchFinanceOrders,
  fetchFinanceOrder, fetchFinanceVendors, fetchOversightFlags,
} from './oversightApi';

export const useFinanceSummary = () =>
  useQuery({ queryKey: oversightKeys.summary, queryFn: fetchFinanceSummary });
export const useFinanceDistricts = () =>
  useQuery({ queryKey: oversightKeys.districts, queryFn: fetchFinanceDistricts });
export const useFinanceOrders = (limit: number, offset: number) =>
  useQuery({ queryKey: oversightKeys.orders(limit, offset), queryFn: () => fetchFinanceOrders(limit, offset) });
export const useFinanceOrder = (id: string | null) =>
  useQuery({ queryKey: oversightKeys.order(id ?? ''), queryFn: () => fetchFinanceOrder(id as string), enabled: Boolean(id) });
export const useFinanceVendors = () =>
  useQuery({ queryKey: oversightKeys.vendors, queryFn: fetchFinanceVendors });
export const useOversightFlags = () =>
  useQuery({ queryKey: oversightKeys.flags, queryFn: fetchOversightFlags });
