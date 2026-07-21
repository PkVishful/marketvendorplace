import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchGovVendorPricing,
  fetchPriceHistory,
  fetchVendorPricing,
  pricingKeys,
  setPrice,
  stopOffering,
} from './api';

export function useVendorPricing() {
  return useQuery({
    queryKey: pricingKeys.all,
    queryFn: fetchVendorPricing,
  });
}

export function usePriceHistory(testId: string) {
  return useQuery({
    queryKey: pricingKeys.history(testId),
    queryFn: () => fetchPriceHistory(testId),
    enabled: Boolean(testId),
  });
}

export function useSetPrice(testId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { pricePaise: number; effectiveFrom?: string }) => setPrice(testId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pricingKeys.all });
      void qc.invalidateQueries({ queryKey: pricingKeys.history(testId) });
    },
  });
}

export function useStopOffering(testId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => stopOffering(testId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pricingKeys.all });
      void qc.invalidateQueries({ queryKey: pricingKeys.history(testId) });
    },
  });
}

export function useGovVendorPricing(vendorId: string) {
  return useQuery({
    queryKey: pricingKeys.gov(vendorId),
    queryFn: () => fetchGovVendorPricing(vendorId),
    enabled: Boolean(vendorId),
  });
}
