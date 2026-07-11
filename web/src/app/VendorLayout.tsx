import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/auth/useSession';
import { PageHero, PortalBody, PortalNav } from '@/components/GovChrome';
import { MobileBottomNav } from '@/components/MobileBottomNav';
import { vendorMobileNavForSession, vendorNavForSession } from '@/lib/navConfig';

export function VendorLayout() {
  const { t } = useTranslation();
  const { data: session } = useSession();
  const navItems = vendorNavForSession(session).map((item) => ({
    to: item.to,
    label: t(item.labelKey),
    end: item.end,
  }));
  const mobileItems = vendorMobileNavForSession(session);

  return (
    <>
      <PageHero
        eyebrow={t('nav.vendorBadge')}
        title={t('vendor.portalTitle')}
        description={t('vendor.portalDesc')}
      />
      <PortalNav ariaLabel={t('nav.vendor')} items={navItems} />
      <PortalBody paddedBottom>
        <Outlet />
      </PortalBody>
      <MobileBottomNav items={mobileItems} />
    </>
  );
}
