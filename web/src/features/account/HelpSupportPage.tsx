import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, Phone, ExternalLink } from 'lucide-react';

const FAQ_KEYS = ['signIn', 'rfq', 'vendor', 'certificate', 'security'] as const;

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((p) => !p)}
        className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left hover:bg-surface-2/60"
      >
        <span className="font-semibold text-ink">{question}</span>
        <span className="mt-0.5 shrink-0 text-brand">{open ? '−' : '+'}</span>
      </button>
      {open && <p className="px-5 pb-4 text-sm leading-relaxed text-slate">{answer}</p>}
    </div>
  );
}

export function HelpSupportPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const portal = pathname.startsWith('/vendor')
    ? 'vendor'
    : pathname.startsWith('/contractor')
      ? 'contractor'
      : 'gov';

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="font-display text-xl font-bold text-ink">{t('help.title')}</h2>
        <p className="mt-1 text-sm text-slate">{t('help.subtitle')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <a
          href="mailto:support@eworks.tn.gov.in"
          className="gov-card flex items-start gap-4 p-5 transition hover:border-brand/30 hover:shadow-card"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand">
            <Mail className="h-5 w-5" strokeWidth={2} />
          </span>
          <span>
            <span className="block font-semibold text-ink">{t('help.emailTitle')}</span>
            <span className="mt-1 block text-sm text-brand">support@eworks.tn.gov.in</span>
            <span className="mt-1 block text-xs text-slate">{t('help.emailDesc')}</span>
          </span>
        </a>

        <div className="gov-card flex items-start gap-4 p-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-tint text-brand">
            <Phone className="h-5 w-5" strokeWidth={2} />
          </span>
          <span>
            <span className="block font-semibold text-ink">{t('help.phoneTitle')}</span>
            <span className="mt-1 block text-sm tabular-nums text-ink">1800-XXX-XXXX</span>
            <span className="mt-1 block text-xs text-slate">{t('help.phoneDesc')}</span>
          </span>
        </div>
      </div>

      <div className="gov-card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-semibold text-ink">{t('help.quickLinksTitle')}</h3>
        </div>
        <ul className="divide-y divide-line">
          <li>
            <Link
              to="/verify"
              className="flex items-center justify-between gap-3 px-5 py-4 text-sm font-medium text-brand hover:bg-surface-2/60"
            >
              {t('verify.title')}
              <ExternalLink className="h-4 w-4 shrink-0 opacity-60" strokeWidth={2} />
            </Link>
          </li>
          {portal === 'gov' && (
            <li>
              <Link
                to="/gov/audit"
                className="flex items-center justify-between gap-3 px-5 py-4 text-sm font-medium text-brand hover:bg-surface-2/60"
              >
                {t('audit.nav')}
                <ExternalLink className="h-4 w-4 shrink-0 opacity-60" strokeWidth={2} />
              </Link>
            </li>
          )}
          {portal === 'vendor' && (
            <li>
              <Link
                to="/vendor/onboarding"
                className="flex items-center justify-between gap-3 px-5 py-4 text-sm font-medium text-brand hover:bg-surface-2/60"
              >
                {t('kyc.nav')}
                <ExternalLink className="h-4 w-4 shrink-0 opacity-60" strokeWidth={2} />
              </Link>
            </li>
          )}
        </ul>
      </div>

      <div className="gov-card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-semibold text-ink">{t('help.faqTitle')}</h3>
          <p className="mt-1 text-sm text-slate">{t('help.faqSubtitle')}</p>
        </div>
        {FAQ_KEYS.map((key) => (
          <FaqItem
            key={key}
            question={t(`help.faq.${key}.q`)}
            answer={t(`help.faq.${key}.a`)}
          />
        ))}
      </div>

      <p className="text-center text-xs text-ink-3">{t('shell.gigw')}</p>
    </section>
  );
}
