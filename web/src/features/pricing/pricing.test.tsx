import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { ApiError } from '@/lib/apiClient';
import type { VendorRateRow } from '@/types/domain';
import { RatesPage } from './RatesPage';
import { RateEditor } from './RateEditor';
import { rupeesToPaiseExact } from './api';
import * as api from './api';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    fetchVendorPricing: vi.fn(),
    setPrice: vi.fn(),
    fetchPriceHistory: vi.fn(async () => []),
    stopOffering: vi.fn(),
  };
});

const priced: VendorRateRow = {
  testId: 't-cube',
  testCode: 'CONCRETE_CUBE_STRENGTH',
  testName: 'Cube compressive strength',
  requiresNabl: true,
  isQualifiedToday: true,
  currentPricePaise: 250000,
  effectiveFrom: '2026-07-01',
  effectiveTo: null,
  isPricedToday: true,
};

const unpriced: VendorRateRow = {
  testId: 't-earth',
  testCode: 'ELEC_EARTH_RESISTANCE',
  testName: 'Earth resistance / earth pit',
  requiresNabl: false,
  isQualifiedToday: true,
  currentPricePaise: null,
  effectiveFrom: null,
  effectiveTo: null,
  isPricedToday: false,
};

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{children}</MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  void i18n.changeLanguage('en');
  vi.mocked(api.fetchVendorPricing).mockResolvedValue([priced, unpriced]);
  vi.mocked(api.setPrice).mockReset();
});

afterEach(() => cleanup());

describe('RatesPage', () => {
  it('renders the amber not-priced chip and sorts unpriced rows to the top', async () => {
    wrap(<RatesPage />);
    const chip = await screen.findByText('Not priced — you cannot bid');
    expect(chip).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    // Unpriced (earth resistance) must come before the priced cube test.
    expect(items[0]).toHaveTextContent('Earth resistance');
    expect(items[1]).toHaveTextContent('Cube compressive strength');
    expect(items[1]).toHaveTextContent('₹2,500.00');
  });

  it('empty catalog links to onboarding', async () => {
    vi.mocked(api.fetchVendorPricing).mockResolvedValue([]);
    wrap(<RatesPage />);
    const cta = await screen.findByRole('link', { name: 'Go to onboarding' });
    expect(cta).toHaveAttribute('href', '/vendor/onboarding');
  });
});

describe('RateEditor', () => {
  it('converts rupees to integer paise with no float drift', async () => {
    // 4111.11 * 100 === 411111.00000000006 in floats — the parser must not care.
    expect(rupeesToPaiseExact('4111.11')).toBe(411111);
    expect(rupeesToPaiseExact('1,250.50')).toBe(125050);
    expect(rupeesToPaiseExact('0.01')).toBe(1);
    expect(rupeesToPaiseExact('1250.505')).toBeNull(); // fractional paise
    expect(rupeesToPaiseExact('0')).toBeNull();
    expect(rupeesToPaiseExact('-5')).toBeNull();
    expect(rupeesToPaiseExact('abc')).toBeNull();

    vi.mocked(api.setPrice).mockResolvedValue({
      id: 'p1', pricePaise: 125050, effectiveFrom: '2026-08-01', effectiveTo: null,
    });
    const user = userEvent.setup();
    wrap(<RateEditor row={priced} onClose={() => {}} />);

    const input = screen.getByLabelText('Price (₹)');
    await user.clear(input);
    await user.type(input, '1250.50');
    await user.click(screen.getByRole('button', { name: 'Save price' }));

    await waitFor(() => expect(api.setPrice).toHaveBeenCalledWith('t-cube', { pricePaise: 125050 }));
  });

  it('rejects fractional paise locally without calling the API', async () => {
    const user = userEvent.setup();
    wrap(<RateEditor row={priced} onClose={() => {}} />);
    const input = screen.getByLabelText('Price (₹)');
    await user.clear(input);
    await user.type(input, '10.005');
    await user.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid amount');
    expect(api.setPrice).not.toHaveBeenCalled();
  });

  it('shows the 409 conflict message from the server verbatim', async () => {
    const conflict =
      'a price window starting 2026-09-01 (until open-ended) already exists; change or stop that window first';
    vi.mocked(api.setPrice).mockRejectedValue(new ApiError(409, conflict));
    const user = userEvent.setup();
    wrap(<RateEditor row={priced} onClose={() => {}} />);

    const input = screen.getByLabelText('Price (₹)');
    await user.clear(input);
    await user.type(input, '1300');
    await user.click(screen.getByRole('button', { name: 'Save price' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(conflict);
  });
});
