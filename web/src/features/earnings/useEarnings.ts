import { useQuery } from '@tanstack/react-query';
import { earningsKeys, fetchVendorEarnings } from './api';

export function useVendorEarnings() {
  return useQuery({ queryKey: earningsKeys.all, queryFn: fetchVendorEarnings });
}
