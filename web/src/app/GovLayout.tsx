import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';
import { PageHero, PortalBody, PortalNav } from '@/components/GovChrome';
import { RoleDashboard } from '@/features/gov/RoleDashboard';
import { govNavForSession } from '@/lib/navConfig';

export function GovLayout() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const navItems = govNavForSession(session).map((item) => ({
    to: item.to,
    label: t(item.labelKey),
    end: item.end,
  }));

  return (
    <>
      <PageHero
        eyebrow={t('nav.govBadge')}
        title={t('gov.title')}
        description={t('gov.portalDesc')}
      />
      <PortalNav ariaLabel={t('nav.gov')} items={navItems} />
      <PortalBody>
        <Outlet />
      </PortalBody>
    </>
  );
}

export function GovHomePage() {
  return <RoleDashboard />;
}
