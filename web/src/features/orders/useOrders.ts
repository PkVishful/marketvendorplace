import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  commitBid,
  fetchVendorOrder,
  fetchVendorOrders,
  orderKeys,
  revealBid,
} from './api';

export function useVendorOrders() {
  return useQuery({
    queryKey: orderKeys.all,
    queryFn: fetchVendorOrders,
  });
}

export function useVendorOrder(id: string) {
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: () => fetchVendorOrder(id),
    enabled: Boolean(id),
  });
}

export function useCommitBid(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commitment: string) => commitBid(orderId, commitment),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    },
  });
}

export function useRevealBid(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pricePaise, nonce }: { pricePaise: number; nonce: string }) =>
      revealBid(orderId, pricePaise, nonce),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    },
  });
}
