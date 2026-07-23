import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MailCheck } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';

interface ForgotResponse {
  sent: boolean;
  /** Demo builds only — never present when NODE_ENV/EWORKS_ENV is production. */
  demoResetLink?: string;
}

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoLink, setDemoLink] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiClient.post<ForgotResponse>('/api/auth/password/forgot', {
        email: email.trim(),
      });
      setDemoLink(res.demoResetLink ?? null);
    } catch {
      // Deliberately ignored: the screen must look identical whether or not the
      // address exists, so a failure cannot be used to probe for accounts.
    } finally {
      // Always the confirmation screen, never "no such account".
      setSubmitted(true);
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <MailCheck className="mx-auto h-10 w-10 text-success" aria-hidden />
        <h1 className="mt-3 font-display text-xl font-bold text-ink">{t('forgot.sentTitle')}</h1>
        <p className="mt-2 text-sm text-slate">{t('forgot.sentBody')}</p>

        {demoLink && (
          <p className="mt-4 rounded-lg bg-saffron-soft px-3 py-2 text-sm text-ink">
            {t('forgot.demoNote')}{' '}
            <Link to={demoLink} className="font-semibold text-brand underline">
              {t('forgot.demoOpen')}
            </Link>
          </p>
        )}

        <Link to="/sign-in" className="gov-btn-secondary mt-6 inline-block text-sm">
          {t('forgot.backToSignIn')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="font-display text-xl font-bold text-ink">{t('forgot.title')}</h1>
      <p className="mt-1 text-sm text-slate">{t('forgot.subtitle')}</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <label className="block text-sm">
          <span className="font-medium text-ink">{t('forgot.emailLabel')}</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="gov-input mt-1 w-full"
          />
        </label>

        <button type="submit" className="gov-btn-primary w-full" disabled={busy}>
          {busy ? t('forgot.sending') : t('forgot.submit')}
        </button>
      </form>

      <Link to="/sign-in" className="mt-4 inline-block text-sm text-brand hover:underline">
        {t('forgot.backToSignIn')}
      </Link>
    </div>
  );
}
