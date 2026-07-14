import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FeedSkeleton } from '@/components/Skeleton';
import { CONTRACTOR_DOC_TYPES, CONTRACTOR_REQUIRED_DOCS, contractorFileUrl } from './api';
import {
  fileToDataUrl,
  useContractorOnboarding,
  useSaveContractorProfile,
  useSubmitContractor,
  useUploadContractorDocument,
} from './useContractor';

type Step = 0 | 1 | 2;
const STEP_KEYS = ['profile', 'documents', 'review'] as const;

interface ProfileForm {
  legalName: string;
  gstin: string;
  pan: string;
  address: string;
  licenceClass: string;
  licenceNo: string;
}

const EMPTY: ProfileForm = { legalName: '', gstin: '', pan: '', address: '', licenceClass: '', licenceNo: '' };

export function ContractorRegistration() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isPending } = useContractorOnboarding();
  const saveProfile = useSaveContractorProfile();
  const uploadDoc = useUploadContractorDocument();
  const submit = useSubmitContractor();

  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<ProfileForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [justUploaded, setJustUploaded] = useState<string | null>(null);
  // Optimistic: mark a doc uploaded the instant the POST succeeds, without
  // waiting for the background re-fetch. `uploadVer` cache-busts the thumbnail.
  const [localUploaded, setLocalUploaded] = useState<Set<string>>(new Set());
  const [uploadVer, setUploadVer] = useState(0);

  // Hydrate the form from an existing DRAFT/REJECTED registration.
  useEffect(() => {
    const c = data?.contractor;
    if (c) {
      setForm({
        legalName: c.legalName ?? '',
        gstin: c.gstin ?? '',
        pan: c.pan ?? '',
        address: c.address ?? '',
        licenceClass: c.licenceClass ?? '',
        licenceNo: c.licenceNo ?? '',
      });
    }
  }, [data?.contractor]);

  if (isPending) return <FeedSkeleton />;

  const contractor = data?.contractor ?? null;
  const editable = !contractor || ['DRAFT', 'REJECTED'].includes(contractor.status);

  // Locked view once submitted/approved.
  if (contractor && !editable) {
    return (
      <div className="py-2">
        <h1 className="font-display text-2xl font-bold text-ink">{t('contractor.reg.title')}</h1>
        <div className="gov-card mt-5 max-w-xl">
          <p className="text-sm text-slate">{t('contractor.reg.statusIntro')}</p>
          <p className="mt-2 text-lg font-bold text-ink">{contractor.legalName}</p>
          <p className="mt-1 text-sm">
            {t('contractor.reg.statusLabel')}:{' '}
            <span className="font-bold text-brand">{t(`contractor.status.${contractor.status}`)}</span>
          </p>
          <p className="mt-4 text-xs text-slate">{t('contractor.reg.locked')}</p>
        </div>
      </div>
    );
  }

  const uploaded = new Set([...(data?.documents ?? []).map((d) => d.docType), ...localUploaded]);

  function set<K extends keyof ProfileForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function saveProfileStep() {
    setError(null);
    if (!form.legalName || !form.gstin || !form.pan || !form.address || !form.licenceClass || !form.licenceNo) {
      setError(t('contractor.reg.fillAll'));
      return false;
    }
    try {
      await saveProfile.mutateAsync(form);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function onNext() {
    if (step === 0) {
      const ok = await saveProfileStep();
      if (!ok) return;
    }
    setStep((s) => (Math.min(2, s + 1) as Step));
  }

  async function onUpload(docType: string, file: File) {
    setError(null);
    setUploading(docType);
    try {
      const { dataUrl, mimeType } = await fileToDataUrl(file);
      await uploadDoc.mutateAsync({ docType, dataUrl, mimeType });
      setLocalUploaded((prev) => new Set(prev).add(docType));
      setUploadVer((v) => v + 1);
      setJustUploaded(docType);
      window.setTimeout(() => setJustUploaded((d) => (d === docType ? null : d)), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  async function onSubmit() {
    setError(null);
    try {
      await submit.mutateAsync();
      navigate('/contractor');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const missingDocs = CONTRACTOR_REQUIRED_DOCS.filter((d) => !uploaded.has(d));

  return (
    <div className="py-2">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold text-ink">{t('contractor.reg.title')}</h1>
        <p className="mt-1 text-sm text-slate">{t('contractor.reg.subtitle')}</p>
      </header>

      {/* Stepper */}
      <ol className="mb-6 flex flex-wrap gap-2">
        {STEP_KEYS.map((k, i) => (
          <li
            key={k}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              i === step ? 'bg-brand text-white' : i < step ? 'bg-success/15 text-success' : 'bg-surface-2 text-slate'
            }`}
          >
            {i + 1}. {t(`contractor.reg.step.${k}`)}
          </li>
        ))}
      </ol>

      {error && <div className="gov-card mb-4 border-danger/40 text-sm font-semibold text-danger">{error}</div>}

      {step === 0 && (
        <div className="gov-card max-w-xl space-y-4">
          <Field label={t('contractor.reg.legalName')}>
            <input className="gov-input" value={form.legalName} onChange={(e) => set('legalName', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('contractor.reg.gstin')}>
              <input className="gov-input" value={form.gstin} onChange={(e) => set('gstin', e.target.value)} placeholder="33ABCDE1234F1Z5" />
            </Field>
            <Field label={t('contractor.reg.pan')}>
              <input className="gov-input" value={form.pan} onChange={(e) => set('pan', e.target.value)} placeholder="ABCDE1234F" />
            </Field>
          </div>
          <Field label={t('contractor.reg.address')}>
            <textarea className="gov-input" rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('contractor.reg.licenceClass')}>
              <input className="gov-input" value={form.licenceClass} onChange={(e) => set('licenceClass', e.target.value)} placeholder="I / II / III" />
            </Field>
            <Field label={t('contractor.reg.licenceNo')}>
              <input className="gov-input" value={form.licenceNo} onChange={(e) => set('licenceNo', e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="gov-card max-w-xl">
          <p className="mb-3 text-sm text-slate">{t('contractor.reg.docsHelp')}</p>
          <ul className="space-y-2">
            {CONTRACTOR_DOC_TYPES.map((docType) => {
              const done = uploaded.has(docType);
              const required = CONTRACTOR_REQUIRED_DOCS.includes(docType);
              const busy = uploading === docType;
              const flash = justUploaded === docType;
              return (
                <li
                  key={docType}
                  className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 transition ${
                    flash ? 'border-success bg-success/10' : done ? 'border-success/40 bg-success/5' : 'border-line bg-surface-2/40'
                  }`}
                >
                  {/* Thumbnail of the actual uploaded image — the clearest possible confirmation. */}
                  {done && contractor?.id ? (
                    <img
                      src={`${contractorFileUrl(contractor.id, docType)}?v=${uploadVer}`}
                      alt=""
                      className="h-11 w-11 flex-none rounded-lg border border-line object-cover"
                    />
                  ) : (
                    <span className="grid h-11 w-11 flex-none place-items-center rounded-lg bg-surface-2 text-slate">📄</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">
                      {t(`contractor.doc.${docType}`)}
                      {required && <span className="ml-1 text-danger">*</span>}
                    </span>
                    <span className="text-xs">
                      {busy ? (
                        <span className="text-slate">{t('contractor.reg.uploadingDoc')}</span>
                      ) : done ? (
                        <span className="font-bold text-success">✓ {t('contractor.reg.uploaded')}</span>
                      ) : (
                        <span className="text-slate">{t('contractor.reg.notUploaded')}</span>
                      )}
                    </span>
                  </span>
                  <label className={`cursor-pointer text-xs ${busy ? 'pointer-events-none opacity-50' : ''} gov-btn-secondary`}>
                    {done ? t('contractor.reg.replace') : t('contractor.reg.upload')}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onUpload(docType, f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-slate">
            {uploaded.size}/{CONTRACTOR_REQUIRED_DOCS.length} {t('contractor.reg.requiredUploaded')}
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="gov-card max-w-xl">
          <h2 className="font-semibold text-ink">{t('contractor.reg.reviewTitle')}</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row k={t('contractor.reg.legalName')} v={form.legalName} />
            <Row k={t('contractor.reg.gstin')} v={form.gstin} />
            <Row k={t('contractor.reg.pan')} v={form.pan} />
            <Row k={t('contractor.reg.licenceClass')} v={form.licenceClass} />
            <Row k={t('contractor.reg.licenceNo')} v={form.licenceNo} />
          </dl>
          {missingDocs.length > 0 && (
            <p className="mt-4 text-xs font-semibold text-danger">
              {t('contractor.reg.missingDocs')}: {missingDocs.map((d) => t(`contractor.doc.${d}`)).join(', ')}
            </p>
          )}
        </div>
      )}

      <div className="mt-5 flex max-w-xl items-center justify-between">
        <button
          type="button"
          className="gov-btn-secondary"
          disabled={step === 0}
          onClick={() => setStep((s) => (Math.max(0, s - 1) as Step))}
        >
          {t('contractor.reg.back')}
        </button>
        {step < 2 ? (
          <button type="button" className="gov-btn-primary" onClick={onNext} disabled={saveProfile.isPending}>
            {saveProfile.isPending ? t('states.saving') : t('contractor.reg.next')}
          </button>
        ) : (
          <button
            type="button"
            className="gov-btn-primary"
            onClick={onSubmit}
            disabled={submit.isPending || missingDocs.length > 0}
          >
            {submit.isPending ? t('states.saving') : t('contractor.reg.submit')}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="gov-label">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-slate">{k}</dt>
      <dd className="font-medium text-ink">{v || '—'}</dd>
    </>
  );
}
