import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { FieldJobsResponse } from '@/types/domain';
import { JobsPage } from './JobsPage';
import * as api from './api';

vi.mock('./api', async (o) => ({
  ...(await o<typeof api>()),
  fetchFieldJobs: vi.fn(),
  acceptAward: vi.fn(async () => ({ jobId: 'job-new', status: 'ASSIGNED' })),
}));

const resp: FieldJobsResponse = {
  jobs: [],
  awaiting: [{ orderId: 'ord-1', milestone: 'Cube pour', requiredBy: '2026-08-20' }],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><JobsPage /></MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(api.fetchFieldJobs).mockResolvedValue(resp));
afterEach(cleanup);

describe('JobsPage — accept award', () => {
  it('shows awarded-ready-to-start orders with an accept button', async () => {
    renderPage();
    expect(await screen.findByText('Cube pour')).toBeInTheDocument();
    expect(screen.getByText(/Awarded — ready to start/)).toBeInTheDocument();
  });

  it('calls acceptAward with the order id when accepted', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: /Accept & start job/ });
    await userEvent.click(btn);
    await waitFor(() => expect(api.acceptAward).toHaveBeenCalled());
    expect(vi.mocked(api.acceptAward).mock.calls[0][0]).toBe('ord-1');
  });
});
