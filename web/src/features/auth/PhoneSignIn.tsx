import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useOtpSend, useOtpVerify } from '@/auth/useSession';
import { devUserById } from '@/app/devUsers';
import { portalHomePathForSession, resolvePortal } from '@/types/domain';

type Step = 'phone' | 'otp';

export function PhoneSignIn({
  disabled,
  variant = 'card',
}: {
  disabled?: boolean;
  variant?: 'card' | 'panel';
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const send = useOtpSend();
  const verify = useOtpVerify();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [mfa, setMfa] = useState('');
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [demoOtp, setDemoOtp] = useState<string | null>(null);
  const [demoMfa, setDemoMfa] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPanel = variant === 'panel';
  const wrapClass = isPanel ? 'space-y-5' : 'gov-card p-6';
  const inputClass = isPanel ? 'sign-in-input mt-2' : 'gov-input mt-1';
  const titleClass = isPanel ? 'sr-only' : 'font-display text-lg font-bold text-ink';
  const helpClass = isPanel ? 'sr-only' : 'mt-1 text-sm text-ink-2';

  async function onSend(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await send.mutateAsync(phone);
      setRequiresMfa(res.requiresMfa);
      setMaskedPhone(res.maskedPhone);
      setDemoOtp(res.demoOtp ?? null);
      setDemoMfa(res.demoMfa ?? null);
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.sendFailed'));
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const session = await verify.mutateAsync({
        phone,
        otp,
        mfaCode: requiresMfa ? mfa : undefined,
      });
      const portal = resolvePortal(session) ?? devUserById(session.userId)?.portal;
      if (portal) navigate(portalHomePathForSession(session));
      else setError(t('auth.noPortal'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.verifyFailed'));
    }
  }

  const busy = send.isPending || verify.isPending || disabled;

  if (step === 'phone') {
    return (
      <form onSubmit={onSend} className={wrapClass}>
        <h3 className={titleClass}>{t('auth.phoneTitle')}</h3>
        <p className={helpClass}>{t('auth.phoneHelp')}</p>
        <label className="block">
          <span className="gov-label">{t('auth.phoneLabel')}</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            className={inputClass}
            placeholder="9000000002"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
          />
        </label>
        {error && (
          <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <button type="submit" disabled={busy} className="gov-btn-primary w-full !min-h-[48px]">
          {send.isPending ? t('auth.sending') : t('auth.sendOtp')}
        </button>
        {import.meta.env.DEV && <p className="text-xs text-ink-3">{t('auth.devOtpHint')}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={onVerify} className={`${wrapClass} animate-[sign-in-fade-up_0.4s_ease-out_both]`}>
      <h3 className={isPanel ? 'font-display text-lg font-bold text-ink' : titleClass}>{t('auth.otpTitle')}</h3>
      <p className={isPanel ? 'text-sm text-slate' : helpClass}>
        {t('auth.otpSent', { phone: maskedPhone || phone })}
      </p>
      {demoOtp && (
        <p className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2 text-sm text-ink">
          <strong>{t('auth.demoModeBanner')}</strong> {t('auth.demoOtpIs')}{' '}
          <span className="font-mono text-base font-bold tracking-[0.2em]">{demoOtp}</span>
          {demoMfa && (
            <>
              {' · '}
              {t('auth.demoMfaIs')}{' '}
              <span className="font-mono text-base font-bold tracking-[0.2em]">{demoMfa}</span>
            </>
          )}
        </p>
      )}
      <label className="block">
        <span className="gov-label">{t('auth.otpLabel')}</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          className={`${inputClass} tracking-[0.3em]`}
          placeholder="123456"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          disabled={busy}
        />
      </label>
      {requiresMfa && (
        <label className="block">
          <span className="gov-label">{t('auth.mfaLabel')}</span>
          <input
            type="text"
            inputMode="numeric"
            className={`${inputClass} tracking-[0.3em]`}
            placeholder="654321"
            maxLength={6}
            value={mfa}
            onChange={(e) => setMfa(e.target.value)}
            disabled={busy}
          />
          <p className="mt-1 text-xs text-ink-3">{t('auth.mfaHelp')}</p>
        </label>
      )}
      {error && (
        <p className="rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setStep('phone');
            setOtp('');
            setMfa('');
            setError(null);
          }}
          className="gov-btn-secondary flex-1 !min-h-[48px]"
        >
          {t('auth.changePhone')}
        </button>
        <button type="submit" disabled={busy} className="gov-btn-primary flex-1 !min-h-[48px]">
          {verify.isPending ? t('auth.verifying') : t('auth.signIn')}
        </button>
      </div>
    </form>
  );
}
