import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import { KYC_DOC_TYPES } from './constants';
import {
  useKycOnboarding,
  useSaveKycCapabilities,
  useSaveKycProfile,
  useSubmitKyc,
  useUploadKycDocument,
  fileToDataUrl,
} from './useKyc';

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const STEP_LABELS = ['company', 'location', 'tax', 'accreditation', 'documents', 'capabilities', 'review'] as const;

export function OnboardingWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isPending } = useKycOnboarding();
  const saveProfile = useSaveKycProfile();
  const uploadDoc = useUploadKycDocument();
  const saveCaps = useSaveKycCapabilities();
  const submit = useSubmitKyc();
  const [step, setStep] = useState<Step>(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);

  const [form, setForm] = useState({
    legalName: '',
    address: '',
    lat: '11.0168',
    lng: '76.9558',
    serviceRadiusKm: '50',
    gstin: '',
    pan: '',
    nablNo: '',
    nablValidUntil: '',
    isGovtApproved: false,
  });

  useEffect(() => {
    if (!data?.vendor) return;
    setForm((f) => ({
      ...f,
      legalName: data.vendor!.legalName ?? f.legalName,
      address: data.vendor!.address ?? f.address,
      lat: String(data.vendor!.lat ?? f.lat),
      lng: String(data.vendor!.lng ?? f.lng),
      serviceRadiusKm: String(data.vendor!.serviceRadiusKm ?? f.serviceRadiusKm),
      gstin: data.vendor!.gstin ?? f.gstin,
      pan: data.vendor!.pan ?? f.pan,
      nablNo: data.vendor!.nablNo ?? f.nablNo,
      nablValidUntil: data.vendor!.nablValidUntil?.slice(0, 10) ?? f.nablValidUntil,
      isGovtApproved: data.vendor!.isGovtApproved ?? f.isGovtApproved,
    }));
    if (data.capabilities.length) {
      setSelectedTests(data.capabilities.map((c) => c.testId));
    }
  }, [data?.vendor?.id, data?.capabilities?.length]);

  if (isPending) return <FeedSkeleton />;

  const vendor = data?.vendor;
  if (vendor && !['DRAFT', 'REJECTED'].includes(vendor.status)) {
    return (
      <div className="gov-card border-l-4 border-l-info p-6">
        <h2 className="font-display text-lg font-bold">{t('kyc.statusTitle')}</h2>
        <p className="mt-2 text-sm text-slate">
          {t('kyc.statusBody', { status: vendor.status.replace(/_/g, ' ') })}
        </p>
        <button type="button" className="gov-btn-primary mt-4" onClick={() => navigate('/vendor')}>
          {t('kyc.backDashboard')}
        </button>
      </div>
    );
  }

  async function persistProfile() {
    await saveProfile.mutateAsync({
      legalName: form.legalName,
      gstin: form.gstin,
      pan: form.pan,
      address: form.address,
      lat: Number(form.lat),
      lng: Number(form.lng),
      serviceRadiusKm: Number(form.serviceRadiusKm),
      nablNo: form.nablNo || undefined,
      nablValidUntil: form.nablValidUntil || undefined,
      isGovtApproved: form.isGovtApproved,
    });
  }

  async function onNext() {
    setError(null);
    try {
      if (step <= 3) await persistProfile();
      if (step === 5) await saveCaps.mutateAsync(selectedTests);
      setStep((s) => Math.min(6, s + 1) as Step);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kyc.saveFailed'));
    }
  }

  async function onUpload(docType: string, file: File) {
    setError(null);
    try {
      const { dataUrl, mimeType } = await fileToDataUrl(file);
      await uploadDoc.mutateAsync({ docType, dataUrl, mimeType });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kyc.uploadFailed'));
    }
  }

  async function onSubmit() {
    setError(null);
    try {
      await submit.mutateAsync();
      navigate('/vendor');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('kyc.submitFailed'));
    }
  }

  const uploaded = new Set((data?.documents ?? []).map((d) => d.docType));

  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold">{t('kyc.title')}</h2>
        <p className="mt-1 text-sm text-slate">{t('kyc.subtitle')}</p>
      </header>

      <ol className="flex gap-1 overflow-x-auto pb-1" aria-label={t('kyc.stepsLabel')}>
        {STEP_LABELS.map((key, i) => (
          <li
            key={key}
            className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${
              i === step ? 'bg-brand text-white' : i < step ? 'bg-brand-tint text-brand' : 'bg-surface-2 text-slate'
            }`}
          >
            {i + 1}. {t(`kyc.step.${key}`)}
          </li>
        ))}
      </ol>

      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>
      )}

      <div className="gov-card p-6">
        {step === 0 && (
          <label className="block">
            <span className="gov-label">{t('kyc.legalName')}</span>
            <input
              className="gov-input mt-1"
              value={form.legalName}
              onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              placeholder={t('kyc.legalNamePlaceholder')}
            />
          </label>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <label className="block">
              <span className="gov-label">{t('kyc.address')}</span>
              <textarea
                className="gov-input mt-1 min-h-[80px]"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="gov-label">{t('kyc.lat')}</span>
                <input className="gov-input mt-1" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} />
              </label>
              <label className="block">
                <span className="gov-label">{t('kyc.lng')}</span>
                <input className="gov-input mt-1" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} />
              </label>
              <label className="block">
                <span className="gov-label">{t('kyc.radius')}</span>
                <input
                  className="gov-input mt-1"
                  type="number"
                  value={form.serviceRadiusKm}
                  onChange={(e) => setForm({ ...form, serviceRadiusKm: e.target.value })}
                />
              </label>
            </div>
            <p className="text-xs text-slate">{t('kyc.gpsHint')}</p>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="gov-label">{t('kyc.gstin')}</span>
              <input className="gov-input mt-1 font-mono text-sm" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
            </label>
            <label className="block">
              <span className="gov-label">{t('kyc.pan')}</span>
              <input className="gov-input mt-1 font-mono text-sm" value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} />
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <label className="block">
              <span className="gov-label">{t('kyc.nablNo')}</span>
              <input className="gov-input mt-1" value={form.nablNo} onChange={(e) => setForm({ ...form, nablNo: e.target.value })} />
            </label>
            <label className="block">
              <span className="gov-label">{t('kyc.nablUntil')}</span>
              <input
                type="date"
                className="gov-input mt-1"
                value={form.nablValidUntil}
                onChange={(e) => setForm({ ...form, nablValidUntil: e.target.value })}
              />
            </label>
            <label className="flex min-h-[44px] items-center gap-3">
              <input
                type="checkbox"
                checked={form.isGovtApproved}
                onChange={(e) => setForm({ ...form, isGovtApproved: e.target.checked })}
              />
              <span className="text-sm text-ink">{t('kyc.pwdApproved')}</span>
            </label>
          </div>
        )}

        {step === 4 && (
          <ul className="space-y-4">
            {KYC_DOC_TYPES.map((docType) => (
              <li key={docType} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
                <div>
                  <p className="font-semibold text-ink">{t(`kyc.doc.${docType}`)}</p>
                  <p className="text-xs text-slate">
                    {uploaded.has(docType) ? t('kyc.uploaded') : t('kyc.required')}
                  </p>
                </div>
                <label className="gov-btn-secondary cursor-pointer">
                  {t('kyc.upload')}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void onUpload(docType, file);
                    }}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}

        {step === 5 && (
          <div className="space-y-2">
            {(data?.tests ?? []).map((test) => (
              <label
                key={test.id}
                className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-line px-4 py-3 hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selectedTests.includes(test.id)}
                  onChange={(e) => {
                    setSelectedTests((prev) =>
                      e.target.checked ? [...prev, test.id] : prev.filter((id) => id !== test.id),
                    );
                  }}
                />
                <span className="text-sm">
                  <span className="font-semibold">{test.name}</span>
                  <span className="ml-2 text-xs text-slate">{test.code}</span>
                  {test.requiresNabl && (
                    <span className="ml-2 text-xs font-bold uppercase text-warning">{t('kyc.nablRequired')}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}

        {step === 6 && (
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="gov-label">{t('kyc.legalName')}</dt>
              <dd>{form.legalName}</dd>
            </div>
            <div>
              <dt className="gov-label">{t('kyc.gstin')}</dt>
              <dd className="font-mono">{form.gstin}</dd>
            </div>
            <div>
              <dt className="gov-label">{t('kyc.documents')}</dt>
              <dd>{data?.documents.length ?? 0} / {KYC_DOC_TYPES.length}</dd>
            </div>
            <div>
              <dt className="gov-label">{t('kyc.capabilities')}</dt>
              <dd>{selectedTests.length} {t('kyc.testsSelected')}</dd>
            </div>
            <p className="text-xs text-slate">{t('kyc.reviewNote')}</p>
          </dl>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {step > 0 && (
          <button type="button" className="gov-btn-secondary" onClick={() => setStep((s) => (s - 1) as Step)}>
            {t('kyc.back')}
          </button>
        )}
        {step < 6 ? (
          <button
            type="button"
            className="gov-btn-primary"
            disabled={saveProfile.isPending || saveCaps.isPending}
            onClick={() => void onNext()}
          >
            {t('kyc.next')}
          </button>
        ) : (
          <button type="button" className="gov-btn-accent" disabled={submit.isPending} onClick={() => void onSubmit()}>
            {submit.isPending ? t('kyc.submitting') : t('kyc.submit')}
          </button>
        )}
      </div>
    </section>
  );
}
