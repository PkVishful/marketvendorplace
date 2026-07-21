import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { fetchPublicCertificate } from './api';

function VerifyResult({ certId }: { certId: string }) {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['public', 'certificate', certId],
    queryFn: () => fetchPublicCertificate(certId),
    retry: false,
  });

  if (isPending) {
    return <p className="text-center text-sm text-ink-3">{t('states.loading')}</p>;
  }

  if (isError || !data?.found) {
    return (
      <div className="gov-card border-l-4 border-l-danger p-8 text-center">
        <p className="font-display text-lg font-bold text-ink">{t('verify.notFoundTitle')}</p>
        <p className="mt-2 text-sm text-ink-2">{t('verify.notFoundBody')}</p>
        <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-6">
          {t('states.retry')}
        </button>
      </div>
    );
  }

  const verified = data.signatureVerified;

  return (
    <div className="space-y-6">
      <div
        className={`gov-card border-l-4 p-6 ${
          verified ? 'border-l-green bg-green-soft/30' : 'border-l-warn bg-warn-soft/20'
        }`}
      >
        <p className="text-xs font-bold uppercase tracking-wider text-ink-3">
          {t('verify.resultLabel')}
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold text-ink">
          {verified ? t('verify.statusValid') : t('verify.statusUnverified')}
        </h2>
        {verified && data.signerName && (
          <p className="mt-2 text-sm text-ink-2">
            {t('verify.signedBy', { name: data.signerName })}
          </p>
        )}
      </div>

      <dl className="gov-card divide-y divide-hair text-sm">
        <div className="grid gap-1 px-6 py-4 sm:grid-cols-3">
          <dt className="font-semibold text-ink-3">{t('verify.project')}</dt>
          <dd className="sm:col-span-2 text-ink">{data.projectName}</dd>
        </div>
        <div className="grid gap-1 px-6 py-4 sm:grid-cols-3">
          <dt className="font-semibold text-ink-3">{t('verify.milestone')}</dt>
          <dd className="sm:col-span-2 text-ink">{data.milestone}</dd>
        </div>
        <div className="grid gap-1 px-6 py-4 sm:grid-cols-3">
          <dt className="font-semibold text-ink-3">{t('verify.lab')}</dt>
          <dd className="sm:col-span-2 text-ink">{data.labName}</dd>
        </div>
        <div className="grid gap-1 px-6 py-4 sm:grid-cols-3">
          <dt className="font-semibold text-ink-3">{t('verify.issued')}</dt>
          <dd className="sm:col-span-2 text-ink">
            {data.issuedAt ? new Date(data.issuedAt).toLocaleDateString() : '—'}
          </dd>
        </div>
        {data.verifiedAt && (
          <div className="grid gap-1 px-6 py-4 sm:grid-cols-3">
            <dt className="font-semibold text-ink-3">{t('verify.verifiedAt')}</dt>
            <dd className="sm:col-span-2 text-ink">
              {new Date(data.verifiedAt).toLocaleString()}
            </dd>
          </div>
        )}
        <div className="grid gap-1 px-6 py-4 sm:grid-cols-3">
          <dt className="font-semibold text-ink-3">{t('verify.sha256')}</dt>
          <dd className="sm:col-span-2 break-all font-mono text-xs text-ink-2">{data.sha256Hex}</dd>
        </div>
      </dl>

      <a
        href={`/api/public/certificates/${certId}/file`}
        target="_blank"
        rel="noreferrer"
        className="mx-auto block text-center text-sm font-semibold text-navy hover:underline"
      >
        {t('verify.downloadCert')}
      </a>

      <p className="text-center text-xs text-ink-3">{t('verify.footnote')}</p>
    </div>
  );
}

export function VerifyCertificatePage() {
  const { t } = useTranslation();
  const { certId: routeId } = useParams();
  const navigate = useNavigate();
  const [lookupId, setLookupId] = useState(routeId ?? '');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const id = lookupId.trim();
    if (id) navigate(`/verify/${id}`);
  }

  return (
    <section className="mx-auto max-w-xl px-4 py-10 sm:px-6">
      <header className="text-center">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-saffron">
          {t('verify.eyebrow')}
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">{t('verify.title')}</h1>
        <p className="mt-3 text-sm text-ink-2">{t('verify.subtitle')}</p>
      </header>

      <form onSubmit={onSubmit} className="gov-card mt-8 p-6">
        <label className="block">
          <span className="gov-label">{t('verify.certIdLabel')}</span>
          <input
            className="gov-input mt-1 font-mono text-sm"
            value={lookupId}
            onChange={(e) => setLookupId(e.target.value)}
            placeholder={t('verify.certIdPlaceholder')}
            spellCheck={false}
          />
        </label>
        <button type="submit" className="gov-btn-primary mt-4 w-full">
          {t('verify.lookup')}
        </button>
        <p className="mt-4 text-center text-xs text-ink-3">
          {t('verify.demoHint')}{' '}
          <Link to="/verify/cccc3333-0000-0000-0000-000000000001" className="text-navy hover:underline">
            cccc3333-…000001
          </Link>
        </p>
      </form>

      {routeId && (
        <div className="mt-8">
          <VerifyResult certId={routeId} />
        </div>
      )}
    </section>
  );
}
