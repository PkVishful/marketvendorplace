import type { MilestoneHealth, VendorRatingTier } from '@/types/domain';
import type { ReactNode } from 'react';

const HEALTH_CLASS: Record<MilestoneHealth, string> = {
  green: 'bg-good-soft text-good',
  amber: 'bg-warn-soft text-warn',
  red: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-2 text-ink-3',
};

const TIER_CLASS: Record<VendorRatingTier, string> = {
  excellent: 'bg-good-soft text-good',
  good: 'bg-accent-soft text-accent',
  watch: 'bg-danger-soft text-danger',
  new: 'bg-surface-2 text-ink-3',
  neutral: 'bg-surface-2 text-ink-3',
};

export function HealthPill({ health, children }: { health: MilestoneHealth; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${HEALTH_CLASS[health]}`}
    >
      {children}
    </span>
  );
}

export function VendorTierPill({ tier, children }: { tier: VendorRatingTier; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TIER_CLASS[tier]}`}
    >
      {children}
    </span>
  );
}
