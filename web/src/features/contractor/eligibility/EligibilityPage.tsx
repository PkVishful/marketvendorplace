import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeedSkeleton } from '@/components/Skeleton';
import { formatDate, formatInr } from '@/lib/time';
import type { ContractorEngineerRow, ContractorExperienceRow, ContractorMachineryRow } from '@/types/domain';
import {
  useAddEngineer,
  useAddExperience,
  useAddMachinery,
  useDeleteEligibilityRow,
  useEligibility,
} from './useEligibility';

export function EligibilityPage() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useEligibility();

  return (
    <div className="py-2">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-bold text-ink">{t('eligibility.title')}</h1>
        <p className="mt-1 text-sm text-slate">{t('eligibility.subtitle')}</p>
      </header>

      {isPending && <FeedSkeleton />}
      {isError && <div className="gov-card text-sm font-semibold text-danger">{t('states.errorBody')}</div>}

      {data && (
        <div className="space-y-6">
          <ExperienceSection rows={data.experience} />
          <MachinerySection rows={data.machinery} />
          <EngineerSection rows={data.engineers} />
        </div>
      )}
    </div>
  );
}

function SectionShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gov-card max-w-3xl">
      <h2 className="font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

function DeleteButton({
  label,
  pending,
  onClick,
}: {
  label: string;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="text-xs font-semibold text-danger disabled:opacity-50"
      onClick={onClick}
      disabled={pending}
    >
      {label}
    </button>
  );
}

function ExperienceSection({ rows }: { rows: ContractorExperienceRow[] }) {
  const { t } = useTranslation();
  const add = useAddExperience();
  const del = useDeleteEligibilityRow();
  const [workName, setWorkName] = useState('');
  const [clientName, setClientName] = useState('');
  const [valueRupees, setValueRupees] = useState('');
  const [completedOn, setCompletedOn] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const value = Number(valueRupees);
    if (!workName.trim() || !Number.isFinite(value) || value <= 0) {
      setError(t('eligibility.saveFailed'));
      return;
    }
    try {
      await add.mutateAsync({
        workName: workName.trim(),
        clientName: clientName.trim() || undefined,
        valuePaise: Math.round(value * 100),
        completedOn: completedOn || null,
      });
      setWorkName('');
      setClientName('');
      setValueRupees('');
      setCompletedOn('');
    } catch (e2) {
      setError((e2 as Error).message || t('eligibility.saveFailed'));
    }
  }

  function onDelete(id: string) {
    setError(null);
    del.mutate(
      { kind: 'experience', id },
      { onError: (e) => setError((e as Error).message || t('eligibility.deleteFailed')) },
    );
  }

  return (
    <SectionShell title={t('eligibility.experience.title')}>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate">{t('eligibility.experience.empty')}</p>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-slate">
              <th className="py-2 pr-3 font-semibold">{t('eligibility.experience.workName')}</th>
              <th className="py-2 pr-3 font-semibold">{t('eligibility.experience.clientName')}</th>
              <th className="py-2 pr-3 font-semibold">{t('eligibility.experience.value')}</th>
              <th className="py-2 pr-3 font-semibold">{t('eligibility.experience.completedOn')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className="py-2 pr-3 font-medium text-ink">{r.workName}</td>
                <td className="py-2 pr-3 text-slate">{r.clientName || '—'}</td>
                <td className="py-2 pr-3 text-ink">{formatInr(r.valuePaise)}</td>
                <td className="py-2 pr-3 text-slate">{r.completedOn ? formatDate(r.completedOn) : '—'}</td>
                <td className="py-2 text-right">
                  <DeleteButton
                    label={t('eligibility.experience.delete')}
                    pending={del.isPending}
                    onClick={() => onDelete(r.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <form onSubmit={onAdd} className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="gov-label">{t('eligibility.experience.workName')}</span>
          <input className="gov-input" value={workName} onChange={(e) => setWorkName(e.target.value)} />
        </label>
        <label className="block">
          <span className="gov-label">{t('eligibility.experience.clientName')}</span>
          <input className="gov-input" value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </label>
        <label className="block">
          <span className="gov-label">{t('eligibility.experience.value')}</span>
          <input
            className="gov-input"
            type="number"
            min={0}
            inputMode="numeric"
            value={valueRupees}
            onChange={(e) => setValueRupees(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="gov-label">{t('eligibility.experience.completedOn')}</span>
          <input
            className="gov-input"
            type="date"
            value={completedOn}
            onChange={(e) => setCompletedOn(e.target.value)}
          />
        </label>
        {error && <p className="text-xs font-semibold text-danger sm:col-span-2">{error}</p>}
        <div className="sm:col-span-2">
          <button type="submit" className="gov-btn-primary" disabled={add.isPending}>
            {add.isPending ? t('eligibility.experience.adding') : t('eligibility.experience.add')}
          </button>
        </div>
      </form>
    </SectionShell>
  );
}

function MachinerySection({ rows }: { rows: ContractorMachineryRow[] }) {
  const { t } = useTranslation();
  const add = useAddMachinery();
  const del = useDeleteEligibilityRow();
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [capacity, setCapacity] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(quantity);
    if (!name.trim() || !Number.isFinite(qty) || qty <= 0) {
      setError(t('eligibility.saveFailed'));
      return;
    }
    try {
      await add.mutateAsync({ name: name.trim(), quantity: Math.round(qty), capacity: capacity.trim() || undefined });
      setName('');
      setQuantity('');
      setCapacity('');
    } catch (e2) {
      setError((e2 as Error).message || t('eligibility.saveFailed'));
    }
  }

  function onDelete(id: string) {
    setError(null);
    del.mutate(
      { kind: 'machinery', id },
      { onError: (e) => setError((e as Error).message || t('eligibility.deleteFailed')) },
    );
  }

  return (
    <SectionShell title={t('eligibility.machinery.title')}>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate">{t('eligibility.machinery.empty')}</p>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-slate">
              <th className="py-2 pr-3 font-semibold">{t('eligibility.machinery.name')}</th>
              <th className="py-2 pr-3 font-semibold">{t('eligibility.machinery.quantity')}</th>
              <th className="py-2 pr-3 font-semibold">{t('eligibility.machinery.capacity')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className="py-2 pr-3 font-medium text-ink">{r.name}</td>
                <td className="py-2 pr-3 text-ink">{r.quantity}</td>
                <td className="py-2 pr-3 text-slate">{r.capacity || '—'}</td>
                <td className="py-2 text-right">
                  <DeleteButton
                    label={t('eligibility.machinery.delete')}
                    pending={del.isPending}
                    onClick={() => onDelete(r.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <form onSubmit={onAdd} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="gov-label">{t('eligibility.machinery.name')}</span>
          <input className="gov-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="gov-label">{t('eligibility.machinery.quantity')}</span>
          <input
            className="gov-input"
            type="number"
            min={0}
            inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="gov-label">{t('eligibility.machinery.capacity')}</span>
          <input className="gov-input" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </label>
        {error && <p className="text-xs font-semibold text-danger sm:col-span-3">{error}</p>}
        <div className="sm:col-span-3">
          <button type="submit" className="gov-btn-primary" disabled={add.isPending}>
            {add.isPending ? t('eligibility.machinery.adding') : t('eligibility.machinery.add')}
          </button>
        </div>
      </form>
    </SectionShell>
  );
}

function EngineerSection({ rows }: { rows: ContractorEngineerRow[] }) {
  const { t } = useTranslation();
  const add = useAddEngineer();
  const del = useDeleteEligibilityRow();
  const [name, setName] = useState('');
  const [qualification, setQualification] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t('eligibility.saveFailed'));
      return;
    }
    try {
      await add.mutateAsync({
        name: name.trim(),
        qualification: qualification.trim() || undefined,
        role: role.trim() || undefined,
      });
      setName('');
      setQualification('');
      setRole('');
    } catch (e2) {
      setError((e2 as Error).message || t('eligibility.saveFailed'));
    }
  }

  function onDelete(id: string) {
    setError(null);
    del.mutate(
      { kind: 'engineers', id },
      { onError: (e) => setError((e as Error).message || t('eligibility.deleteFailed')) },
    );
  }

  return (
    <SectionShell title={t('eligibility.engineers.title')}>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate">{t('eligibility.engineers.empty')}</p>
      ) : (
        <TableShell>
          <thead>
            <tr className="border-b border-line text-xs uppercase tracking-wide text-slate">
              <th className="py-2 pr-3 font-semibold">{t('eligibility.engineers.name')}</th>
              <th className="py-2 pr-3 font-semibold">{t('eligibility.engineers.qualification')}</th>
              <th className="py-2 pr-3 font-semibold">{t('eligibility.engineers.role')}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <td className="py-2 pr-3 font-medium text-ink">{r.name}</td>
                <td className="py-2 pr-3 text-slate">{r.qualification || '—'}</td>
                <td className="py-2 pr-3 text-slate">{r.role || '—'}</td>
                <td className="py-2 text-right">
                  <DeleteButton
                    label={t('eligibility.engineers.delete')}
                    pending={del.isPending}
                    onClick={() => onDelete(r.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      )}

      <form onSubmit={onAdd} className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="gov-label">{t('eligibility.engineers.name')}</span>
          <input className="gov-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="gov-label">{t('eligibility.engineers.qualification')}</span>
          <input className="gov-input" value={qualification} onChange={(e) => setQualification(e.target.value)} />
        </label>
        <label className="block">
          <span className="gov-label">{t('eligibility.engineers.role')}</span>
          <input className="gov-input" value={role} onChange={(e) => setRole(e.target.value)} />
        </label>
        {error && <p className="text-xs font-semibold text-danger sm:col-span-3">{error}</p>}
        <div className="sm:col-span-3">
          <button type="submit" className="gov-btn-primary" disabled={add.isPending}>
            {add.isPending ? t('eligibility.engineers.adding') : t('eligibility.engineers.add')}
          </button>
        </div>
      </form>
    </SectionShell>
  );
}
