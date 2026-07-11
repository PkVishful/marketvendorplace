import { useTranslation } from 'react-i18next';
import { kycFileUrl } from './api';

export function KycDocumentPreview({
  vendorId,
  docType,
  mimeType,
  label,
}: {
  vendorId: string;
  docType: string;
  mimeType: string;
  label: string;
}) {
  const { t } = useTranslation();
  const src = kycFileUrl(vendorId, docType);

  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-surface-2">
      <figcaption className="border-b border-line px-3 py-2 text-xs font-semibold text-ink">{label}</figcaption>
      {mimeType.startsWith('image/') ? (
        <img src={src} alt={label} className="max-h-48 w-full object-contain bg-white" />
      ) : (
        <p className="p-4 text-xs text-slate">{t('kyc.previewUnavailable')}</p>
      )}
    </figure>
  );
}
