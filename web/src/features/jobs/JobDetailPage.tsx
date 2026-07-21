import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { getDeviceId } from '@/lib/deviceId';
import { downscaleToJpegDataUrl } from '@/lib/photoCapture';
import { checkinPhotoUrl, certificateFileUrl } from './api';
import { generateQrCode, isValidQrCode } from '@/lib/qrCode';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
import type { CustodyEvent } from '@/types/domain';
import { formatDate, formatDeadline, formatInr } from '@/lib/time';
import { JobStatusPill } from './JobStatusPill';
import {
  useAdvanceDevJob,
  useBindSample,
  useCheckIn,
  useFieldJob,
  useRecordCustody,
  useRecordTestResult,
  useUploadCertificate,
} from './useJobs';

const CUSTODY_FLOW: CustodyEvent[] = [
  'MOLDED',
  'SEALED',
  'PICKED_UP',
  'IN_TRANSIT',
  'RECEIVED_AT_LAB',
  'TESTED',
];

const DEMO_GPS = { lat: 11.0176, lon: 76.9558, accuracyM: 10 };

function nextCustodyEvent(
  qrCode: string,
  custody: { event: CustodyEvent; qrCode: string }[],
): CustodyEvent | null {
  const done = new Set(custody.filter((c) => c.qrCode === qrCode).map((c) => c.event));
  return CUSTODY_FLOW.find((e) => !done.has(e)) ?? null;
}

export function JobDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const { data: job, isPending, isError, refetch } = useFieldJob(id);
  const checkIn = useCheckIn(id);
  const bindSample = useBindSample(id);
  const recordCustody = useRecordCustody(id);
  const recordResult = useRecordTestResult(id);
  const uploadCert = useUploadCertificate(id);
  const advanceDev = useAdvanceDevJob(id);

  const [qrDraft, setQrDraft] = useState('');
  const [testCode, setTestCode] = useState('');
  const [specimenNo, setSpecimenNo] = useState(1);
  const [testAgeDays, setTestAgeDays] = useState<number | ''>('');
  const [loadKn, setLoadKn] = useState('675');
  const [areaMm2, setAreaMm2] = useState('22500');
  const [resultQr, setResultQr] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const certRef = useRef<HTMLInputElement>(null);

  if (isPending) return <FeedSkeleton />;

  if (isError || !job) {
    return (
      <section>
        <Link to="/vendor/jobs" className="text-sm font-semibold text-navy hover:underline">
          ← {t('jobs.title')}
        </Link>
        <div className="gov-card mt-6 border-l-4 border-l-danger p-8 text-center">
          <p className="font-display text-lg font-bold text-danger">{t('jobs.notFoundTitle')}</p>
          <p className="mt-2 text-sm text-ink-2">{t('jobs.notFoundBody')}</p>
          <button type="button" onClick={() => void refetch()} className="gov-btn-secondary mt-4">
            {t('states.retry')}
          </button>
        </div>
      </section>
    );
  }

  const canCheckIn = job.status === 'ASSIGNED';
  const canBind = job.status === 'CHECKED_IN';
  const defaultTest = job.items[0]?.testCode ?? '';
  const selectedTest = testCode || defaultTest;
  const selectedItem = job.items.find((i) => i.testCode === selectedTest);

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setPhoto(await downscaleToJpegDataUrl(file));
    } catch {
      setActionError(t('jobs.checkInFailed'));
    }
  }

  async function handleCheckIn(useDemoGps: boolean) {
    setActionError(null);
    if (!photo) {
      setActionError(t('jobs.photoRequired'));
      return;
    }
    try {
      let lat = DEMO_GPS.lat;
      let lon = DEMO_GPS.lon;
      let accuracyM = DEMO_GPS.accuracyM;

      if (!useDemoGps && navigator.geolocation) {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000,
          });
        });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;
        accuracyM = pos.coords.accuracy;
      }

      await checkIn.mutateAsync({
        lat,
        lon,
        accuracyM,
        photo,
        deviceId: getDeviceId(),
        reportedAt: new Date().toISOString(),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('jobs.checkInFailed'));
    }
  }

  async function handleBind() {
    setActionError(null);
    const code = qrDraft.trim().toUpperCase();
    if (!isValidQrCode(code)) {
      setActionError(t('jobs.invalidQr'));
      return;
    }
    try {
      await bindSample.mutateAsync({
        testCode: selectedTest,
        qrCode: code,
        specimenNo,
        testAgeDays: testAgeDays === '' ? undefined : testAgeDays,
      });
      setQrDraft('');
      setSpecimenNo((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('jobs.bindFailed'));
    }
  }

  async function handleCustody(qrCode: string, event: CustodyEvent) {
    setActionError(null);
    try {
      await recordCustody.mutateAsync({
        qrCode,
        event,
        lat: DEMO_GPS.lat,
        lon: DEMO_GPS.lon,
        deviceId: getDeviceId(),
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('jobs.custodyFailed'));
    }
  }

  async function handleRecordResult(qrCode: string) {
    setActionError(null);
    const load = Number(loadKn);
    const area = Number(areaMm2);
    if (!load || !area) {
      setActionError(t('results.invalidInputs'));
      return;
    }
    const strength = Math.round((load * 1000) / area);
    try {
      await recordResult.mutateAsync({
        qrCode,
        measurements: {
          load_kn: load,
          area_mm2: area,
          strength_n_per_mm2: strength,
        },
      });
      setResultQr(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('results.failed'));
    }
  }

  async function onPickCertificate(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setActionError(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await uploadCert.mutateAsync({ file: dataUrl });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('results.certFailed'));
    }
  }

  const allResultsEntered =
    job.samples.length > 0 && job.samples.every((s) => s.result != null);

  const stats: [string, string][] = [
    [t('orders.requiredBy'), formatDate(job.requiredBy)],
    [t('jobs.vendor'), job.vendorName],
    [t('orders.site'), `${job.lat.toFixed(4)}°, ${job.lng.toFixed(4)}°`],
    [t('jobs.device'), job.deviceId ?? '—'],
  ];

  return (
    <section>
      <Link to="/vendor/jobs" className="text-sm font-semibold text-navy hover:underline">
        ← {t('jobs.title')}
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-ink-3">{job.id.slice(0, 8).toUpperCase()}</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight">{job.milestone}</h2>
        </div>
        <JobStatusPill status={job.status} />
      </header>

      <button
        type="button"
        className="gov-btn-secondary mt-4 text-xs"
        disabled={advanceDev.isPending}
        onClick={() => void advanceDev.mutateAsync()}
      >
        {t('jobs.devAdvanceLab')}
      </button>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="gov-stat">
            <dt className="gov-label">{label}</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </div>

      {actionError && (
        <p className="gov-card mt-4 border-l-4 border-l-danger px-4 py-3 text-sm text-danger" role="alert">
          {actionError}
        </p>
      )}

      {canCheckIn && (
        <div className="gov-card mt-8 border-l-4 border-l-green p-6">
          <h3 className="font-display text-lg font-bold">{t('jobs.checkInTitle')}</h3>
          <p className="mt-2 text-sm text-ink-2">{t('jobs.checkInBody')}</p>
          <div className="mt-4">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => void onPickPhoto(e)}
            />
            {photo ? (
              <div className="flex items-center gap-3">
                <img src={photo} alt={t('jobs.checkInPhoto')} className="h-20 w-20 rounded-md object-cover" />
                <button
                  type="button"
                  className="gov-btn-secondary text-xs"
                  onClick={() => fileRef.current?.click()}
                >
                  {t('jobs.retakePhoto')}
                </button>
              </div>
            ) : (
              <button type="button" className="gov-btn-secondary" onClick={() => fileRef.current?.click()}>
                {t('jobs.takePhoto')}
              </button>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={checkIn.isPending || !photo}
              onClick={() => void handleCheckIn(true)}
              className="gov-btn-primary"
            >
              {checkIn.isPending ? t('states.loading') : t('jobs.checkInDemo')}
            </button>
            <button
              type="button"
              disabled={checkIn.isPending || !photo}
              onClick={() => void handleCheckIn(false)}
              className="gov-btn-secondary"
            >
              {t('jobs.checkInGps')}
            </button>
          </div>
        </div>
      )}

      {job.checkIn && (
        <div className="gov-card mt-6 border-l-4 border-l-good p-5">
          <p className="gov-label">{t('jobs.checkInDone')}</p>
          <p className="mt-1 text-sm text-ink">
            {t('jobs.distance', { meters: Math.round(job.checkIn.distanceM) })} ·{' '}
            {formatDeadline(job.checkIn.serverAt)}
          </p>
          <img
            src={checkinPhotoUrl(id)}
            alt={t('jobs.checkInPhoto')}
            className="mt-3 h-32 w-32 rounded-md object-cover"
          />
        </div>
      )}

      {canBind && (
        <div className="gov-card mt-8 p-6">
          <h3 className="font-display text-lg font-bold">{t('jobs.bindTitle')}</h3>
          <p className="mt-2 text-sm text-ink-2">{t('jobs.bindBody')}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="gov-label">{t('jobs.test')}</span>
              <select
                className="mt-1 w-full rounded-md border border-hair bg-surface px-3 py-2 text-sm"
                value={selectedTest}
                onChange={(e) => setTestCode(e.target.value)}
              >
                {job.items.map((item) => (
                  <option key={item.testCode} value={item.testCode}>
                    {item.testName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="gov-label">{t('jobs.specimenNo')}</span>
              <input
                type="number"
                min={1}
                className="mt-1 w-full rounded-md border border-hair bg-surface px-3 py-2 text-sm"
                value={specimenNo}
                onChange={(e) => setSpecimenNo(Number(e.target.value))}
              />
            </label>
            <label className="block">
              <span className="gov-label">{t('jobs.testAge')}</span>
              <select
                className="mt-1 w-full rounded-md border border-hair bg-surface px-3 py-2 text-sm"
                value={testAgeDays}
                onChange={(e) => setTestAgeDays(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="">{t('jobs.testAgeAny')}</option>
                {(selectedItem?.testAgesDays ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d} {t('jobs.days')}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="gov-label">{t('jobs.qrCode')}</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  className="min-w-0 flex-1 rounded-md border border-hair bg-surface px-3 py-2 font-mono text-sm uppercase"
                  value={qrDraft}
                  onChange={(e) => setQrDraft(e.target.value.toUpperCase())}
                  placeholder="EW-XXXXXXXXXXXX"
                />
                <button
                  type="button"
                  className="gov-btn-secondary shrink-0"
                  onClick={() => setQrDraft(generateQrCode())}
                >
                  {t('jobs.generateQr')}
                </button>
              </div>
            </label>
          </div>
          <button
            type="button"
            disabled={bindSample.isPending || !qrDraft.trim()}
            onClick={() => void handleBind()}
            className="gov-btn-primary mt-4"
          >
            {bindSample.isPending ? t('states.loading') : t('jobs.bindSample')}
          </button>
        </div>
      )}

      {job.samples.length > 0 && (
        <>
          <h3 className="gov-label mt-8">{t('jobs.samplesTitle')}</h3>
          <ul className="mt-3 flex flex-col gap-3">
            {job.samples.map((sample) => {
              const next = nextCustodyEvent(sample.qrCode, job.custody);
              const events = job.custody.filter((c) => c.qrCode === sample.qrCode);
              return (
                <li key={sample.id} className="gov-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-bold text-navy">{sample.qrCode}</p>
                      <p className="mt-1 text-sm text-ink-2">
                        {sample.testName} · #{sample.specimenNo}
                        {sample.testAgeDays != null ? ` · ${sample.testAgeDays}d` : ''}
                      </p>
                    </div>
                    {next && (
                      <button
                        type="button"
                        disabled={recordCustody.isPending}
                        onClick={() => void handleCustody(sample.qrCode, next)}
                        className="gov-btn-secondary text-xs"
                      >
                        {t(`jobs.custody.${next}`)}
                      </button>
                    )}
                    {sample.result && (
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                          sample.result.passed ? 'bg-good-soft text-good' : 'bg-danger-soft text-danger'
                        }`}
                      >
                        {sample.result.passed ? t('results.pass') : t('results.fail')}
                        {sample.result.isProvisional ? ` · ${t('results.provisional')}` : ''}
                      </span>
                    )}
                    {sample.receivedAtLab && !sample.result && resultQr !== sample.qrCode && (
                      <button
                        type="button"
                        className="gov-btn-primary text-xs"
                        onClick={() => setResultQr(sample.qrCode)}
                      >
                        {t('results.enter')}
                      </button>
                    )}
                  </div>
                  {sample.result && (
                    <p className="mt-2 text-sm text-ink-2">
                      {sample.result.metric} = {sample.result.metricValue} (min{' '}
                      {sample.result.thresholdMin ?? '—'})
                    </p>
                  )}
                  {resultQr === sample.qrCode && (
                    <div className="mt-3 grid gap-3 border-t border-hair pt-3 sm:grid-cols-3">
                      <label className="block text-sm">
                        <span className="gov-label">{t('results.loadKn')}</span>
                        <input
                          type="number"
                          className="mt-1 w-full rounded-md border border-hair px-3 py-2 text-sm"
                          value={loadKn}
                          onChange={(e) => setLoadKn(e.target.value)}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="gov-label">{t('results.areaMm2')}</span>
                        <input
                          type="number"
                          className="mt-1 w-full rounded-md border border-hair px-3 py-2 text-sm"
                          value={areaMm2}
                          onChange={(e) => setAreaMm2(e.target.value)}
                        />
                      </label>
                      <div className="flex items-end gap-2">
                        <button
                          type="button"
                          className="gov-btn-primary text-xs"
                          disabled={recordResult.isPending}
                          onClick={() => void handleRecordResult(sample.qrCode)}
                        >
                          {t('results.submit')}
                        </button>
                        <button
                          type="button"
                          className="gov-btn-secondary text-xs"
                          onClick={() => setResultQr(null)}
                        >
                          {t('results.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                  {events.length > 0 && (
                    <ol className="mt-3 flex flex-wrap gap-2">
                      {events.map((e) => (
                        <li
                          key={`${e.event}-${e.occurredAt}`}
                          className="rounded-md bg-surface-2 px-2 py-1 text-[11px] font-semibold uppercase text-ink-3"
                        >
                          {t(`jobs.custody.${e.event}`)}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {allResultsEntered && !job.certificate && (
        <div className="gov-card mt-8 border-l-4 border-l-navy p-6">
          <h3 className="font-display text-lg font-bold">{t('results.uploadCert')}</h3>
          <p className="mt-2 text-sm text-ink-2">{t('results.uploadCertBody')}</p>
          <input
            ref={certRef}
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => void onPickCertificate(e)}
          />
          <button
            type="button"
            className="gov-btn-primary mt-4"
            disabled={uploadCert.isPending}
            onClick={() => certRef.current?.click()}
          >
            {uploadCert.isPending ? t('states.loading') : t('results.pickCert')}
          </button>
        </div>
      )}

      {job.certificate && (
        <div className="gov-card mt-6 border-l-4 border-l-good p-5">
          <p className="gov-label">{t('results.certificate')}</p>
          <a
            href={certificateFileUrl(id)}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-sm font-semibold text-navy hover:underline"
          >
            {t('results.viewCert')}
          </a>
          <p className="mt-1 text-xs text-ink-3">
            {job.certificate.signatureVerified
              ? t('results.certVerified')
              : t('results.certAwaitingVerify')}
          </p>
        </div>
      )}

      {job.payment && (
        <div className="gov-card mt-6 p-5">
          <p className="gov-label">{t('results.payment')}</p>
          <p className="mt-1 font-display text-xl font-bold">{formatInr(job.payment.amountPaise)}</p>
          <p className="mt-1 text-xs uppercase tracking-wide text-ink-3">{job.payment.status}</p>
          {job.payment.status === 'RELEASED' && job.payment.treasuryRef && (
            <p className="mt-2 text-xs text-ink-2">
              {job.payment.treasuryRef} · {job.payment.gstInvoiceNo}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
