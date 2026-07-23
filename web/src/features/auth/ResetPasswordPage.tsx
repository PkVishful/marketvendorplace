import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { apiClient, ApiError } from '@/lib/apiClient';

/** Mirrors PASSWORD_MIN_LENGTH on the server, which is the real gate. */
const MIN_LENGTH = 10;

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-display text-xl font-bold text-ink">{t('reset.missingTitle')}</h1>
        <p className="mt-2 text-sm text-slate">{t('reset.missingBody')}</p>
        <Link to="/forgot-password" className="gov-btn-primary mt-6 inline-block text-sm">
          {t('reset.requestNew')}
        </Link>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Checked here purely for a fast, clear message — the server enforces both
    // rules independently.
    if (password.length < MIN_LENGTH) {
      setError(t('reset.tooShort', { min: MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('reset.mismatch'));
      return;
    }

    setBusy(true);
    try {
      await apiClient.post('/api/auth/password/reset', { token, password });
      // Straight to sign-in: the reset does not log you in, so a stolen link
      // cannot also hand over a session.
      navigate('/sign-in', { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? t('reset.invalidToken')
          : t('reset.failed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-16">
      <h1 className="font-display text-xl font-bold text-ink">{t('reset.title')}</h1>
      <p className="mt-1 text-sm text-slate">{t('reset.subtitle', { min: MIN_LENGTH })}</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <label className="block text-sm">
          <span className="font-medium text-ink">{t('reset.newPassword')}</span>
          <span className="relative mt-1 block">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="gov-input w-full pr-11"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? t('signInEmail.hidePassword') : t('signInEmail.showPassword')}
              aria-pressed={show}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate hover:text-ink"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </label>

        <label className="block text-sm">
          <span className="font-medium text-ink">{t('reset.confirmPassword')}</span>
          <input
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="gov-input mt-1 w-full"
          />
        </label>

        {error && <p className="text-sm text-danger" role="alert">{error}</p>}

        <button type="submit" className="gov-btn-primary w-full" disabled={busy}>
          {busy ? t('reset.saving') : t('reset.submit')}
        </button>
      </form>
    </div>
  );
}
