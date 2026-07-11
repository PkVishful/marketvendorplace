import { apiClient } from '@/lib/apiClient';
import type { VendorBidDTO, VendorOrderDetail, VendorOrderSummary } from '@/types/domain';

export const orderKeys = {
  all: ['vendor-orders'] as const,
  detail: (id: string) => ['vendor-orders', id] as const,
};

export function fetchVendorOrders() {
  return apiClient.get<VendorOrderSummary[]>('/api/vendor/orders');
}

export function fetchVendorOrder(id: string) {
  return apiClient.get<VendorOrderDetail>(`/api/vendor/orders/${id}`);
}

export function commitBid(orderId: string, commitment: string) {
  return apiClient.post<VendorBidDTO>(`/api/vendor/orders/${orderId}/bid/commit`, { commitment });
}

export function revealBid(orderId: string, pricePaise: number, nonce: string) {
  return apiClient.post<VendorBidDTO>(`/api/vendor/orders/${orderId}/bid/reveal`, { pricePaise, nonce });
}
