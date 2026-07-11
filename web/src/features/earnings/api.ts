import { apiClient } from '@/lib/apiClient';
import type { VendorEarningsDTO } from '@/types/domain';

export const earningsKeys = {
  all: ['vendor', 'earnings'] as const,
};

export function fetchVendorEarnings() {
  return apiClient.get<VendorEarningsDTO>('/api/vendor/earnings');
}
