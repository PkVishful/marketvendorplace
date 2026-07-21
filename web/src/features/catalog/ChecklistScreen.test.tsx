import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CatalogChecklist, ChecklistTest, VendorRateRow } from '@/types/domain';
import { ChecklistScreen } from './ChecklistScreen';
import * as api from './api';
import * as pricingApi from '@/features/pricing/api';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, fetchCatalogChecklist: vi.fn() };
});
vi.mock('@/features/pricing/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pricing/api')>();
  return { ...actual, fetchVendorPricing: vi.fn() };
});

const mk = (o: Partial<ChecklistTest>): ChecklistTest => ({
  code: 'X', name: 'X', domain: 'concrete', isCode: 'IS 456', requiresNabl: false,
  tatDays: 3, frequency: { key: 'catalog.freq.ONCE', params: {} },
  repeatsAcrossStages: false, ...o,
});

const fixture: CatalogChecklist = {
  stages: [
    { code: 'SITE_INVESTIGATION', sequence: 10, name: 'Site Investigation',
      tests: [mk({ code: 'SOIL_BEARING', name: 'Soil bearing', domain: 'soil' })] },
    { code: 'ROADWORK', sequence: 70, name: 'Roadwork',
      tests: [mk({ code: 'BITUMEN_PEN', name: 'Bitumen penetration', domain: 'road/bitumen', requiresNabl: true })] },
  ],
  crossStage: [mk({ code: 'WATER_QUALITY', name: 'Water quality', domain: 'water' })],
};

function renderScreen(variant: 'gov' | 'vendor' = 'gov') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><ChecklistScreen variant={variant} /></MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.fetchCatalogChecklist).mockResolvedValue(fixture);
  vi.mocked(pricingApi.fetchVendorPricing).mockRejectedValue(new Error('no pricing'));
});
afterEach(cleanup);

describe('ChecklistScreen (gov)', () => {
  it('lists every stage with its tests, including cross-stage', async () => {
    renderScreen();
    expect(await screen.findByText('Soil bearing')).toBeInTheDocument();
    expect(screen.getByText('Bitumen penetration')).toBeInTheDocument();
    expect(screen.getByText('Water quality')).toBeInTheDocument();
  });

  it('search narrows across levels', async () => {
    renderScreen();
    await screen.findByText('Soil bearing');
    await userEvent.type(screen.getByRole('searchbox'), 'bitumen');
    await waitFor(() => expect(screen.queryByText('Soil bearing')).not.toBeInTheDocument());
    expect(screen.getByText('Bitumen penetration')).toBeInTheDocument();
  });

  it('domain filter (soil) shows only soil tests', async () => {
    renderScreen();
    await screen.findByText('Soil bearing');
    await userEvent.click(screen.getByRole('button', { name: 'Soil' }));
    await waitFor(() => expect(screen.queryByText('Bitumen penetration')).not.toBeInTheDocument());
    expect(screen.getByText('Soil bearing')).toBeInTheDocument();
  });

  it('NABL toggle keeps only NABL tests', async () => {
    renderScreen();
    await screen.findByText('Soil bearing');
    await userEvent.click(screen.getByRole('checkbox', { name: /NABL only/i }));
    await waitFor(() => expect(screen.queryByText('Soil bearing')).not.toBeInTheDocument());
    expect(screen.getByText('Bitumen penetration')).toBeInTheDocument();
  });
});

describe('ChecklistScreen (vendor)', () => {
  it('degrades cleanly when the pricing API is absent', async () => {
    renderScreen('vendor');
    expect(await screen.findByText('Soil bearing')).toBeInTheDocument();
    expect(screen.queryByText(/Not priced/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/You offer this/i)).not.toBeInTheDocument();
  });

  it('shows offer + price chips when pricing is present', async () => {
    const rates: VendorRateRow[] = [{
      testId: 't1', testCode: 'SOIL_BEARING', testName: 'Soil bearing', requiresNabl: false,
      isQualifiedToday: true, currentPricePaise: 250000, effectiveFrom: '2026-07-01',
      effectiveTo: null, isPricedToday: true,
    }];
    vi.mocked(pricingApi.fetchVendorPricing).mockResolvedValue(rates);
    renderScreen('vendor');
    expect(await screen.findByText(/You offer this/i)).toBeInTheDocument();
    expect(screen.getByText(/Priced/)).toBeInTheDocument();
    // The two tests with no rate row fall back to the "Not offered" deep link.
    expect(screen.getAllByText(/Not offered/i).length).toBeGreaterThanOrEqual(1);
  });
});
