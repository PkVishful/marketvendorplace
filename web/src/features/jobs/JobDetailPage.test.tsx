import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { JobDetailPage } from './JobDetailPage';
import * as api from './api';
import * as capture from '@/lib/photoCapture';

vi.mock('./api', async (o) => ({
  ...(await o<typeof api>()),
  fetchFieldJob: vi.fn(),
  checkInToJob: vi.fn(async () => ({ id: 'ci', distanceM: 0 })),
}));
vi.mock('@/lib/photoCapture', async (o) => ({
  ...(await o<typeof capture>()),
  downscaleToJpegDataUrl: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));

const job = {
  id: 'job-1', status: 'ASSIGNED', orderId: 'o1', milestone: 'Cube pour',
  requiredBy: '2026-08-20', lat: 11, lng: 76, deviceId: null, vendorName: 'Lab',
  items: [], samples: [], custody: [], checkIn: null, result: null, certificate: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/vendor/jobs/job-1']}>
          <Routes><Route path="/vendor/jobs/:id" element={<JobDetailPage />} /></Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(api.fetchFieldJob).mockResolvedValue(job as never));
afterEach(cleanup);

describe('JobDetailPage — check-in photo', () => {
  it('disables check-in until a photo is attached', async () => {
    renderPage();
    const demo = await screen.findByRole('button', { name: /demo/i });
    expect(demo).toBeDisabled();
  });

  it('sends the photo with the check-in', async () => {
    renderPage();
    await screen.findByText(/Take .* site photo/i);
    const file = new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, file);
    const demo = await screen.findByRole('button', { name: /demo/i });
    await waitFor(() => expect(demo).toBeEnabled());
    await userEvent.click(demo);
    await waitFor(() => expect(api.checkInToJob).toHaveBeenCalled());
    const body = vi.mocked(api.checkInToJob).mock.calls[0][1];
    expect(body.photo).toBe('data:image/jpeg;base64,AAAA');
  });
});
