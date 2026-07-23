import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { usePasswordLogin, usePasswordLoginMfa } from '@/auth/useSession';
import { portalHomePathForSession } from '@/types/domain';
import type { Session } from '@/types/domain';

type Step = 'credentials' | 'mfa';

export function EmailSignIn({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = usePasswordLogin();
  const loginMfa = usePasswordLoginMfa();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [demoMfa, setDemoMfa] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function land(session: Session) {
    navigate(portalHomePathForSession(session), { replace: true });
  }

  async function onSubmitCredentials(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const result = await login.mutateAsync({ email: email.trim(), password });
      if (result.mfaRequired) {
        setMaskedPhone(result.maskedPhone ?? '');
        setDemoMfa(result.demoMfa ?? null);
        setStep('mfa');
        return;
      }
      land(result as Session);
    } catch {
      // Deliberately one message for every failure mode. Distinguishing
      // "no such account" from "wrong password" would confirm which addresses
      // are registered.
      setError(t('signInEmail.invalidCredentials'));
    }
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const session = await loginMfa.mutateAsync({ email: email.trim(), mfaCode });
      land(session);
    } catch {
      setError(t('signInEmail.invalidMfa'));
    }
  }

  const busy = login.isPending || loginMfa.isPending || disabled;

  if (step === 'mfa') {
    return (
      <form onSubmit={onSubmitMfa} className="space-y-5" noValidate>
        <div>
          <h2 className="font-display text-2xl font-bold text-ink">{t('signInEmail.mfaTitle')}</h2>
          <p className="mt-1 text-sm text-ink-2">
            {t('signInEmail.mfaSentTo', { phone: maskedPhone })}
          </p>
        </div>

        {demoMfa && (
          <p className="rounded-lg bg-saffron-soft px-3 py-2 text-sm text-ink">
            {t('signInEmail.demoMfa')} <strong className="tracking-widest">{demoMfa}</strong>
          </p>
        )}

        <div>
          <label htmlFor="mfaCode" className="text-sm font-medium text-ink">
            {t('signInEmail.mfaLabel')} <span className="text-danger">*</span>
          </label>
          <input
            id="mfaCode"
            name="mfaCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            placeholder="654321"
            required
            className="sign-in-input mt-2"
          />
        </div>

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        <button type="submit" className="gov-btn-primary w-full !min-h-[48px]" disabled={busy}>
          {busy ? t('signInEmail.signingIn') : t('signInEmail.submit')}
        </button>

        <button
          type="button"
          className="text-sm text-brand hover:underline"
          onClick={() => { setStep('credentials'); setError(null); setMfaCode(''); }}
        >
          {t('signInEmail.back')}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmitCredentials} className="space-y-5" noValidate>
      <div>
        <h2 className="font-display text-2xl font-bold text-ink">{t('signInEmail.title')}</h2>
        <p className="mt-1 text-sm text-ink-2">{t('signInEmail.subtitle')}</p>
      </div>

      <div>
        <label htmlFor="email" className="text-sm font-medium text-ink">
          {t('signInEmail.emailLabel')} <span className="text-danger">*</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('signInEmail.emailPlaceholder')}
          required
          className="sign-in-input mt-2"
        />
      </div>

      <div>
        <label htmlFor="password" className="text-sm font-medium text-ink">
          {t('signInEmail.passwordLabel')} <span className="text-danger">*</span>
        </label>
        <div className="relative mt-2">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('signInEmail.passwordPlaceholder')}
            required
            className="sign-in-input pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate hover:text-ink"
            aria-label={showPassword ? t('signInEmail.hidePassword') : t('signInEmail.showPassword')}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <a href="/forgot-password" className="text-sm text-brand hover:underline">
          {t('signInEmail.forgotPassword')}
        </a>
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <button type="submit" className="gov-btn-primary w-full !min-h-[48px]" disabled={busy}>
        {busy ? t('signInEmail.signingIn') : t('signInEmail.submit')}
      </button>
    </form>
  );
}
