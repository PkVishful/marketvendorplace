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
import { OfficersPage } from '@/features/gov/OfficersPage';
import { SettingsPage } from '@/features/account/SettingsPage';
import { GovSettingsPage } from '@/features/account/GovSettingsPage';
import { HelpSupportPage } from '@/features/account/HelpSupportPage';
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
import { RatesPage } from '@/features/pricing/RatesPage';
import { ProjectChecklistPage } from '@/features/gov/ProjectChecklistPage';
import { ChecklistScreen } from '@/features/catalog/ChecklistScreen';
import { ContractorLayout } from '@/app/ContractorLayout';
import { ContractsPage } from '@/features/contractor/ContractsPage';
import { ContractorRegistration } from '@/features/contractor/ContractorRegistration';
import { EligibilityPage } from '@/features/contractor/eligibility/EligibilityPage';
import { TenderBoardPage } from '@/features/public/tenders/TenderBoardPage';
import { TenderDetailPage } from '@/features/public/tenders/TenderDetailPage';
import { TenderWizardPage } from '@/features/gov/tenders/TenderWizardPage';
import { NotFoundPage } from '@/app/NotFoundPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<PortalHome />} />
        <Route path="/sign-in" element={null} />
        <Route path="/verify" element={<VerifyCertificatePage />} />
        <Route path="/verify/:certId" element={<VerifyCertificatePage />} />
        <Route path="/tenders" element={<TenderBoardPage />} />
        <Route path="/tenders/:noticeId" element={<TenderDetailPage />} />

        <Route element={<RequirePortal portal="vendor" />}>
          <Route path="/vendor" element={<VendorLayout />}>
            <Route index element={<VendorDashboard />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:id" element={<OrderDetailPage />} />
            <Route path="rates" element={<RatesPage />} />
            <Route path="tests" element={<ChecklistScreen variant="vendor" />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="jobs/:id" element={<JobDetailPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="earnings" element={<EarningsPage />} />
            <Route path="onboarding" element={<OnboardingWizard />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpSupportPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        <Route element={<RequirePortal portal="contractor" />}>
          <Route path="/contractor" element={<ContractorLayout />}>
            <Route index element={<ContractsPage />} />
            <Route path="registration" element={<ContractorRegistration />} />
            <Route path="eligibility" element={<EligibilityPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpSupportPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        <Route element={<RequirePortal portal="gov" />}>
          <Route path="/gov" element={<GovLayout />}>
            <Route index element={<GovHomePage />} />
            <Route path="planner" element={<PlannerPage />} />
            <Route path="checklist" element={<ChecklistScreen variant="gov" />} />
            <Route path="projects/:projectId/checklist" element={<ProjectChecklistPage />} />
            <Route path="orders" element={<GovOrdersPage />} />
            <Route path="orders/:id" element={<GovOrderDetailPage />} />
            <Route path="vendors" element={<VendorsPage />} />
            <Route path="officers" element={<OfficersPage />} />
            <Route path="quality" element={<QualityDashboardPage />} />
            <Route path="ratings" element={<VendorRatingsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="audit" element={<AuditLogPage />} />
            <Route path="tenders" element={<TenderWizardPage />} />
            <Route path="tenders/:contractId" element={<TenderWizardPage />} />
            <Route path="settings" element={<GovSettingsPage />} />
            <Route path="help" element={<HelpSupportPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
