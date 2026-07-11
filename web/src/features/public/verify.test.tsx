import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import type { PublicCertificateDTO } from '@/types/domain';
import { VerifyCertificatePage } from './VerifyCertificatePage';

const mockCert: PublicCertificateDTO = {
  found: true,
  id: 'cccc3333-0000-0000-0000-000000000001',
  sha256Hex: 'abababab'.repeat(8),
  signatureVerified: true,
  signerName: 'eMudhra test (dev)',
  verifiedAt: '2026-07-10T12:00:00.000Z',
  issuedAt: '2026-07-09T12:00:00.000Z',
  milestone: 'Field demo — column pour',
  projectName: 'Coimbatore Flyover',
  projectCode: 'CBEPRJ1',
  labName: 'Coimbatore Concrete Labs',
  orgName: 'Coimbatore Section 1',
};

vi.mock('./api', () => ({
  fetchPublicCertificate: (id: string) => {
    if (id === mockCert.id) return Promise.resolve(mockCert);
    return Promise.resolve({ found: false });
  },
}));

function wrap(ui: ReactNode, initial = '/verify/cccc3333-0000-0000-0000-000000000001') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[initial]}>
          <Routes>
            <Route path="/verify" element={ui} />
            <Route path="/verify/:certId" element={ui} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('VerifyCertificatePage', () => {
  beforeEach(() => {
    void i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
  });

  it('shows verified certificate details for a valid id', async () => {
    wrap(<VerifyCertificatePage />);
    expect(await screen.findByText(/Signature verified/i)).toBeInTheDocument();
    expect(screen.getByText('Coimbatore Concrete Labs')).toBeInTheDocument();
    expect(screen.getByText(mockCert.sha256Hex!)).toBeInTheDocument();
  });

  it('shows not found for unknown id', async () => {
    wrap(<VerifyCertificatePage />, '/verify/00000000-0000-0000-0000-000000000099');
    expect(await screen.findByText(/Certificate not found/i)).toBeInTheDocument();
  });

  it('navigates on lookup submit', async () => {
    const user = userEvent.setup();
    wrap(<VerifyCertificatePage />, '/verify');
    const input = screen.getByPlaceholderText(/UUID from QR/i);
    await user.type(input, mockCert.id!);
    await user.click(screen.getByRole('button', { name: /Verify certificate/i }));
    await waitFor(() => {
      expect(screen.getByText(/Signature verified/i)).toBeInTheDocument();
    });
  });
});
