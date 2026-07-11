import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useOtpSend, useOtpVerify } from '@/auth/useSession';
import { devUserById } from '@/app/devUsers';
import { portalHomePathForSession, resolvePortal } from '@/types/domain';

type Step = 'phone' | 'otp';

export function PhoneSignIn({ disabled }: { disabled?: boolean }) {
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
  const [error, setError] = useState<string | null>(null);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await send.mutateAsync(phone);
      setRequiresMfa(res.requiresMfa);
      setMaskedPhone(res.maskedPhone);
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
      <form onSubmit={onSend} className="gov-card p-6">
        <h2 className="font-display text-lg font-bold text-ink">{t('auth.phoneTitle')}</h2>
        <p className="mt-1 text-sm text-ink-2">{t('auth.phoneHelp')}</p>
        <label className="mt-6 block">
          <span className="gov-label">{t('auth.phoneLabel')}</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            className="gov-input mt-1"
            placeholder="9000000002"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
          />
        </label>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className="gov-btn-primary mt-6 w-full">
          {send.isPending ? t('auth.sending') : t('auth.sendOtp')}
        </button>
        <p className="mt-4 text-xs text-ink-3">{t('auth.devOtpHint')}</p>
      </form>
    );
  }

  return (
    <form onSubmit={onVerify} className="gov-card p-6">
      <h2 className="font-display text-lg font-bold text-ink">{t('auth.otpTitle')}</h2>
      <p className="mt-1 text-sm text-ink-2">
        {t('auth.otpSent', { phone: maskedPhone || phone })}
      </p>
      <label className="mt-6 block">
        <span className="gov-label">{t('auth.otpLabel')}</span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="gov-input mt-1 tracking-widest"
          placeholder="123456"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          disabled={busy}
        />
      </label>
      {requiresMfa && (
        <label className="mt-4 block">
          <span className="gov-label">{t('auth.mfaLabel')}</span>
          <input
            type="text"
            inputMode="numeric"
            className="gov-input mt-1 tracking-widest"
            placeholder="654321"
            maxLength={6}
            value={mfa}
            onChange={(e) => setMfa(e.target.value)}
            disabled={busy}
          />
          <p className="mt-1 text-xs text-ink-3">{t('auth.mfaHelp')}</p>
        </label>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setStep('phone');
            setOtp('');
            setMfa('');
            setError(null);
          }}
          className="gov-btn-secondary flex-1"
        >
          {t('auth.changePhone')}
        </button>
        <button type="submit" disabled={busy} className="gov-btn-primary flex-1">
          {verify.isPending ? t('auth.verifying') : t('auth.signIn')}
        </button>
      </div>
    </form>
  );
}
