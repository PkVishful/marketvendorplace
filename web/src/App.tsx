import { Routes, Route } from 'react-router-dom';
import { AppShell, RequirePortal } from '@/app/AppShell';
import { VendorLayout } from '@/app/VendorLayout';
import { GovLayout, GovHomePage } from '@/app/GovLayout';
import { PortalHome } from '@/app/PortalHome';
import { GovOrdersPage } from '@/features/gov/GovOrdersPage';
import { GovOrderDetailPage } from '@/features/gov/GovOrderDetailPage';
import { PlannerPage } from '@/features/gov/PlannerPage';
import { VendorsPage } from '@/features/gov/VendorsPage';
import { QualityDashboardPage } from '@/features/gov/QualityDashboardPage';
import { VendorRatingsPage } from '@/features/gov/VendorRatingsPage';
import { AuditLogPage } from '@/features/gov/AuditLogPage';
import { EarningsPage } from '@/features/earnings/EarningsPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { OrdersPage } from '@/features/orders/OrdersPage';
import { OrderDetailPage } from '@/features/orders/OrderDetailPage';
import { JobsPage } from '@/features/jobs/JobsPage';
import { JobDetailPage } from '@/features/jobs/JobDetailPage';
import { VerifyCertificatePage } from '@/features/public/VerifyCertificatePage';
import { AnalyticsPage } from '@/features/gov/AnalyticsPage';
import { VendorDashboard } from '@/features/vendor/VendorDashboard';
import { OnboardingWizard } from '@/features/kyc/OnboardingWizard';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<PortalHome />} />
        <Route path="/sign-in" element={null} />
        <Route path="/verify" element={<VerifyCertificatePage />} />
        <Route path="/verify/:certId" element={<VerifyCertificatePage />} />

        <Route element={<RequirePortal portal="vendor" />}>
          <Route path="/vendor" element={<VendorLayout />}>
            <Route index element={<VendorDashboard />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:id" element={<OrderDetailPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="jobs/:id" element={<JobDetailPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="earnings" element={<EarningsPage />} />
            <Route path="onboarding" element={<OnboardingWizard />} />
          </Route>
        </Route>

        <Route element={<RequirePortal portal="gov" />}>
          <Route path="/gov" element={<GovLayout />}>
            <Route index element={<GovHomePage />} />
            <Route path="planner" element={<PlannerPage />} />
            <Route path="orders" element={<GovOrdersPage />} />
            <Route path="orders/:id" element={<GovOrderDetailPage />} />
            <Route path="vendors" element={<VendorsPage />} />
            <Route path="quality" element={<QualityDashboardPage />} />
            <Route path="ratings" element={<VendorRatingsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="audit" element={<AuditLogPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
