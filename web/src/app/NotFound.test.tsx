import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import type { Session } from '@/types/domain';
import { App } from '@/App';

// The full app (AppShell → portal layouts) reads window.matchMedia via useTheme,
// which jsdom does not implement. Stub it before anything renders.
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

// Drive the app by mocking the session hooks the shells read, so no /api/me
// fetch happens in jsdom.
let session: Session;
vi.mock('@/auth/useSession', () => ({
  useSession: () => ({ data: session, isPending: false }),
  useSignOut: () => ({ mutate: () => {} }),
}));
vi.mock('@/features/notifications/useNotifications', () => ({
  useNotifications: () => ({ data: [] }),
  unreadCount: () => 0,
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

const vendorSession: Session = {
  authenticated: true,
  portal: 'vendor',
  userId: 'v1',
  fullName: 'Test Vendor',
  permissions: [],
  roles: [],
};

describe('unknown routes', () => {
  beforeEach(() => {
    void i18n.changeLanguage('en');
  });
  afterEach(cleanup);

  it('shows a not-found page for an unknown path inside a portal', async () => {
    session = vendorSession;
    renderAt('/vendor/tenders');
    expect(await screen.findByText(/Page not found/i)).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown top-level path', async () => {
    session = { authenticated: false };
    renderAt('/totally-unknown');
    expect(await screen.findByText(/Page not found/i)).toBeInTheDocument();
  });
});
