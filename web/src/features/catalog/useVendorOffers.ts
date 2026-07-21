import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchVendorPricing, formatPaise } from '@/features/pricing/api';

export interface VendorOffer {
  offered: boolean;
  priceLabel: string | null;
}

/**
 * Map of testCode -> offer for the signed-in vendor, plus whether the pricing
 * feature is available at all. When the pricing API errors (or the caller is
 * not a vendor), `available` is false and the screen hides the offer chips
 * entirely — graceful degradation, not a broken row.
 */
export function useVendorOffers(enabled: boolean): {
  offers: Map<string, VendorOffer>;
  available: boolean;
} {
  const { data, isError } = useQuery({
    queryKey: ['vendor', 'pricing', 'offers'],
    queryFn: fetchVendorPricing,
    enabled,
    retry: false,
  });

  const offers = useMemo(() => {
    const map = new Map<string, VendorOffer>();
    for (const row of data ?? []) {
      map.set(row.testCode, {
        offered: true,
        priceLabel:
          row.isPricedToday && row.currentPricePaise != null
            ? formatPaise(row.currentPricePaise)
            : null,
      });
    }
    return map;
  }, [data]);

  return { offers, available: enabled && !isError };
}
