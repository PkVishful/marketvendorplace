import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { adminKeys, fetchAdminSettings, setAdminSetting } from './api';
import {
  ORG_PROFILE_KEY, emptyOrgProfile, parseOrgProfile, validateOrgProfile,
  type OrgProfile, type OrgProfileErrors,
} from './orgProfile';

const INDUSTRIES = ['Public Works', 'Highways', 'Water Resources', 'Rural Development', 'Housing'];
const LOCATIONS = ['India'];
const STATES = [
  'Tamil Nadu', 'Andhra Pradesh', 'Karnataka', 'Kerala', 'Puducherry', 'Telangana',
];

/** Keep the logo small: it rides inside a jsonb settings row, not object storage. */
const MAX_LOGO_BYTES = 1024 * 1024;

export function OrgProfilePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: fetchAdminSettings });

  const [form, setForm] = useState<OrgProfile>(emptyOrgProfile());
  const [errors, setErrors] = useState<OrgProfileErrors>({});
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const stored = settings.data?.find((row) => row.key === ORG_PROFILE_KEY)?.value;

  // Re-seed the form whenever the server copy changes (first load, or after a
  // save round-trips) — but not on every render, or typing would be discarded.
  useEffect(() => { setForm(parseOrgProfile(stored)); }, [stored]);

  const save = useMutation({
    mutationFn: (profile: OrgProfile) => setAdminSetting(ORG_PROFILE_KEY, profile),
    onSuccess: () => {
      setSaved(true);
      void qc.invalidateQueries({ queryKey: adminKeys.settings });
    },
  });

  function field(name: keyof OrgProfile) {
    return {
      value: form[name],
      onChange: (e: { target: { value: string } }) => {
        setForm((f) => ({ ...f, [name]: e.target.value }));
        setSaved(false);
      },
    };
  }

  function onLogoChange(e: FormEvent<HTMLInputElement>) {
    const file = (e.currentTarget.files ?? [])[0];
    if (!file) return;
    setLogoError(null);
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError(t('orgProfile.logoTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setForm((f) => ({ ...f, logoDataUrl: String(reader.result ?? '') }));
      setSaved(false);
    };
    reader.readAsDataURL(file);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateOrgProfile(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(form);
  }

  if (settings.isPending) {
    return <p className="text-sm text-slate" role="status">{t('orgProfile.loading')}</p>;
  }
  if (settings.isError) {
    return <p className="text-sm text-danger">{t('orgProfile.loadFailed')}</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-3xl">
      <h2 className="font-display text-lg font-bold text-ink">{t('orgProfile.title')}</h2>

      <section className="mt-5">
        <p className="text-sm font-medium text-ink">{t('orgProfile.logo')}</p>
        <div className="mt-2 flex flex-wrap items-start gap-5">
          <label className="flex h-24 w-48 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface text-sm text-ink-2 hover:border-brand/40">
            {form.logoDataUrl ? (
              <img src={form.logoDataUrl} alt={t('orgProfile.logoAlt')} className="max-h-20 max-w-full object-contain" />
            ) : (
              <><Upload className="h-4 w-4" aria-hidden /> {t('orgProfile.logoUpload')}</>
            )}
            <input type="file" accept="image/*" className="sr-only" onChange={onLogoChange} />
          </label>
          <div className="text-xs text-ink-3">
            <p className="text-ink-2">{t('orgProfile.logoHint')}</p>
            <p className="mt-1">{t('orgProfile.logoSpec')}</p>
            {form.logoDataUrl && (
              <button
                type="button"
                className="mt-2 text-brand hover:underline"
                onClick={() => { setForm((f) => ({ ...f, logoDataUrl: '' })); setSaved(false); }}
              >
                {t('orgProfile.logoRemove')}
              </button>
            )}
            {logoError && <p className="mt-1 text-danger">{logoError}</p>}
          </div>
        </div>
      </section>

      <div className="mt-6 space-y-4 border-t border-line pt-6">
        <Row label={t('orgProfile.name')} required error={errors.name && t('orgProfile.nameRequired')}>
          <input {...field('name')} className="gov-input" required aria-invalid={Boolean(errors.name)} />
        </Row>

        <Row label={t('orgProfile.industry')}>
          <select {...field('industry')} className="gov-input">
            <option value="">{t('orgProfile.choose')}</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </Row>

        <Row label={t('orgProfile.location')} required error={errors.location && t('orgProfile.locationRequired')}>
          <select {...field('location')} className="gov-input" aria-invalid={Boolean(errors.location)}>
            <option value="">{t('orgProfile.choose')}</option>
            {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Row>

        <Row label={t('orgProfile.address')}>
          <div className="space-y-2">
            <input {...field('attention')} placeholder={t('orgProfile.attention')} className="gov-input" />
            <input {...field('street1')} placeholder={t('orgProfile.street1')} className="gov-input" />
            <input {...field('street2')} placeholder={t('orgProfile.street2')} className="gov-input" />
            <div className="flex flex-wrap gap-2">
              <input {...field('city')} placeholder={t('orgProfile.city')} className="gov-input flex-1" />
              <div className="flex-1">
                <input
                  {...field('pinCode')}
                  placeholder={t('orgProfile.pinCode')}
                  inputMode="numeric"
                  className="gov-input w-full"
                  aria-invalid={Boolean(errors.pinCode)}
                />
                {errors.pinCode && <p className="mt-1 text-xs text-danger">{t('orgProfile.pinCodeInvalid')}</p>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <select {...field('state')} className="gov-input flex-1">
                <option value="">{t('orgProfile.choose')}</option>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <input {...field('phone')} placeholder={t('orgProfile.phone')} className="gov-input flex-1" />
            </div>
            <input {...field('fax')} placeholder={t('orgProfile.fax')} className="gov-input" />
          </div>
        </Row>
      </div>

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-line bg-surface py-3">
        <button type="submit" className="gov-btn-primary" disabled={save.isPending}>
          {save.isPending ? t('orgProfile.saving') : t('orgProfile.save')}
        </button>
        <button
          type="button"
          className="gov-btn-secondary"
          onClick={() => { setForm(parseOrgProfile(stored)); setErrors({}); setSaved(false); }}
        >
          {t('orgProfile.cancel')}
        </button>
        {saved && <span className="text-sm text-success" role="status">{t('orgProfile.saved')}</span>}
        {save.isError && <span className="text-sm text-danger" role="alert">{t('orgProfile.saveFailed')}</span>}
      </div>
    </form>
  );
}

function Row({
  label, required, error, children,
}: {
  label: string; required?: boolean; error?: string | false; children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4">
      <label className={`pt-2 text-sm ${required ? 'font-medium text-ink' : 'text-ink-2'}`}>
        {label} {required && <span className="text-danger">*</span>}
      </label>
      <div>
        {children}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
