import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

const WORK_CATEGORIES = [
  'Material Testing',
  'Concrete Testing',
  'Soil & Geotechnical',
  'Steel Testing',
  'Road Works QA',
  'Structural Works',
  'Building Works',
  'NABL Laboratory',
];

export interface RegisterVendorFormData {
  legalName: string;
  contactName: string;
  phone: string;
  email: string;
  gstin: string;
  pan: string;
  address: string;
  categories: string[];
}

const EMPTY_FORM: RegisterVendorFormData = {
  legalName: '',
  contactName: '',
  phone: '',
  email: '',
  gstin: '',
  pan: '',
  address: '',
  categories: [],
};

export function RegisterVendorPanel({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (data: RegisterVendorFormData) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<RegisterVendorFormData>(EMPTY_FORM);

  function toggleCategory(cat: string) {
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(cat)
        ? f.categories.filter((c) => c !== cat)
        : [...f.categories, cat],
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <article className="gov-card flex h-full max-h-[calc(100vh-8rem)] flex-col overflow-hidden lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('govVendors.registerPanelEyebrow')}
          </p>
          <h3 className="font-display text-lg font-bold text-ink">{t('govVendors.registerVendor')}</h3>
          <p className="mt-0.5 text-xs text-slate">{t('govVendors.registerPanelHint')}</p>
        </div>
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line hover:bg-surface-2"
          aria-label={t('govVendors.cancel')}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="gov-label">{t('govVendors.formLegalName')}</span>
            <input
              className="gov-input mt-1 w-full"
              value={form.legalName}
              onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
              required
            />
          </label>

          <label className="block">
            <span className="gov-label">{t('govVendors.formContactName')}</span>
            <input
              className="gov-input mt-1 w-full"
              value={form.contactName}
              onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
              required
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="gov-label">{t('govVendors.phone')}</span>
              <input
                className="gov-input mt-1 w-full"
                inputMode="numeric"
                maxLength={10}
                placeholder="9842155678"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, '') }))}
                required
              />
            </label>
            <label className="block">
              <span className="gov-label">{t('govVendors.email')}</span>
              <input
                type="email"
                className="gov-input mt-1 w-full"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="gov-label">{t('kyc.gstin')}</span>
              <input
                className="gov-input mt-1 w-full font-mono text-sm uppercase"
                value={form.gstin}
                onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                required
              />
            </label>
            <label className="block">
              <span className="gov-label">{t('kyc.pan')}</span>
              <input
                className="gov-input mt-1 w-full font-mono text-sm uppercase"
                value={form.pan}
                onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))}
                maxLength={10}
                required
              />
            </label>
          </div>

          <label className="block">
            <span className="gov-label">{t('kyc.address')}</span>
            <textarea
              className="gov-input mt-1 min-h-[4rem] w-full"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              required
            />
          </label>

          <fieldset>
            <legend className="gov-label">{t('govVendors.workCategories')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {WORK_CATEGORIES.map((cat) => {
                const on = form.categories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      on ? 'bg-brand text-white' : 'bg-surface-2 text-slate hover:bg-surface-3'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          <button type="submit" className="gov-btn-primary text-sm" disabled={pending}>
            {pending ? t('govVendors.registering') : t('govVendors.submitRegister')}
          </button>
          <button type="button" className="gov-btn-secondary text-sm" onClick={onClose}>
            {t('govVendors.cancel')}
          </button>
        </div>
      </form>
    </article>
  );
}
