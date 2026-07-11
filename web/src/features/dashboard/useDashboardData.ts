import { useQueries } from '@tanstack/react-query';
import { hasPermission } from '@/auth/permissions';
import { fetchGovOrders, fetchGovVendors, fetchProcurementAnalytics, fetchQualityDashboard, govKeys } from '@/features/gov/api';
import { fetchVendorEarnings, earningsKeys } from '@/features/earnings/api';
import { fetchFieldJobs, jobKeys } from '@/features/jobs/api';
import { fetchVendorOrders, orderKeys } from '@/features/orders/api';
import { fetchNotifications } from '@/features/notifications/api';
import { NOTIFICATIONS_KEY } from '@/features/notifications/useNotifications';
import type { Session } from '@/types/domain';

export function useGovDashboardData(session: Session | undefined) {
  const canOrders = hasPermission(session, 'order.read');
  const canAnalytics = hasPermission(session, 'order.read');
  const canQuality = hasPermission(session, ['result.verify', 'order.read']);
  const canVendors = hasPermission(session, ['vendor.read', 'vendor.approve']);

  const results = useQueries({
    queries: [
      {
        queryKey: govKeys.analytics,
        queryFn: fetchProcurementAnalytics,
        enabled: canAnalytics,
      },
      {
        queryKey: govKeys.quality(),
        queryFn: () => fetchQualityDashboard(),
        enabled: canQuality,
      },
      {
        queryKey: govKeys.vendors('SUBMITTED'),
        queryFn: () => fetchGovVendors('SUBMITTED'),
        enabled: canVendors,
      },
      {
        queryKey: govKeys.orders(),
        queryFn: () => fetchGovOrders(),
        enabled: canOrders,
      },
    ],
  });

  const [analyticsQ, qualityQ, vendorsQ, ordersQ] = results;
  const analytics = analyticsQ.data;
  const quality = qualityQ.data;
  const pendingKyc = vendorsQ.data?.length ?? 0;
  const orders = ordersQ.data ?? [];

  const floated = analytics?.totals.floated ?? orders.filter((o) => o.status === 'FLOATED').length;
  const awarded = analytics?.totals.awarded ?? orders.filter((o) => o.status === 'AWARDED').length;
  const escalations = analytics?.totals.openEscalations ?? 0;
  const qualityAlerts = quality
    ? (quality.counts.red ?? 0) + (quality.counts.amber ?? 0)
    : 0;
  const healthPct =
    quality && quality.milestones.length > 0
      ? Math.round((quality.counts.green / quality.milestones.length) * 100)
      : null;

  return {
    isLoading: results.some((r) => r.isLoading),
    floated,
    awarded,
    escalations,
    pendingKyc,
    qualityAlerts,
    healthPct,
    analytics,
    quality,
    recentOrders: orders.slice(0, 5),
  };
}

export function useVendorDashboardData(enabled: boolean) {
  const results = useQueries({
    queries: [
      { queryKey: orderKeys.all, queryFn: fetchVendorOrders, enabled },
      { queryKey: jobKeys.all, queryFn: fetchFieldJobs, enabled },
      { queryKey: NOTIFICATIONS_KEY, queryFn: fetchNotifications, enabled },
      { queryKey: earningsKeys.all, queryFn: fetchVendorEarnings, enabled },
    ],
  });

  const [ordersQ, jobsQ, notifQ, earningsQ] = results;
  const orders = ordersQ.data ?? [];
  const jobs = jobsQ.data ?? [];
  const notifications = notifQ.data ?? [];
  const earnings = earningsQ.data;

  const unread = notifications.filter((n) => n.readAt === null).length;
  const openTenders = orders.filter((o) => o.status === 'FLOATED').length;
  const activeJobs = jobs.filter((j) => !['TESTED', 'CANCELLED'].includes(j.status)).length;

  return {
    isLoading: results.some((r) => r.isLoading),
    openTenders,
    activeJobs,
    unread,
    heldPaise: earnings?.summary.heldPaise ?? 0,
    releasedPaise: earnings?.summary.releasedPaise ?? 0,
    recentNotifications: notifications.slice(0, 5),
  };
}
