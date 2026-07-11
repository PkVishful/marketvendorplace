import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import type { NotificationDTO } from '@/types/domain';
import { NotificationsPage } from './NotificationsPage';

// Backing store the mocked API reads/writes, so an optimistic mark-read and the
// follow-up refetch agree.
let store: NotificationDTO[] = [];

vi.mock('./api', () => ({
  fetchNotifications: () => Promise.resolve(store.map((n) => ({ ...n }))),
  markNotificationRead: (id: string) => {
    store = store.map((n) =>
      n.id === id && n.readAt === null ? { ...n, readAt: new Date().toISOString() } : n,
    );
    return Promise.resolve({ updated: 1 });
  },
}));

function seed(): NotificationDTO[] {
  return [
    {
      id: 'n1', createdAt: new Date().toISOString(), readAt: null,
      eventType: 'ORDER_FLOATED', orderId: 'order-dead', vendorId: null,
      orderAlive: false, orderMilestone: null, orderStatus: null, // dead link
    },
    {
      id: 'n2', createdAt: new Date().toISOString(), readAt: null,
      eventType: 'VENDOR_APPROVED', orderId: null, vendorId: 'v1',
      orderAlive: false, orderMilestone: null, orderStatus: null,
    },
    {
      id: 'n3', createdAt: new Date().toISOString(), readAt: new Date().toISOString(),
      eventType: 'AWARD_WON', orderId: 'order-live', vendorId: null,
      orderAlive: true, orderMilestone: 'Footing pour', orderStatus: 'AWARDED',
    },
  ];
}

function renderPage(): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <NotificationsPage />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('vendor notification feed', () => {
  beforeEach(() => {
    store = seed();
  });

  it('renders every notification the vendor holds', async () => {
    renderPage();
    const rows = await screen.findAllByTestId('notification-row');
    expect(rows).toHaveLength(3);
  });

  it('shows the unread count (2 of 3 unread)', async () => {
    renderPage();
    expect(await screen.findByLabelText('2 unread')).toBeInTheDocument();
  });

  it('renders a dead link as unavailable, without crashing', async () => {
    renderPage();
    expect(
      await screen.findByText('This tender is no longer available to your lab.'),
    ).toBeInTheDocument();
  });

  it('marks a notification read and decrements the unread badge', async () => {
    const user = userEvent.setup();
    renderPage();
    const rows = await screen.findAllByTestId('notification-row');
    const firstUnread = rows.find((r) => r.getAttribute('data-unread') === 'true');
    expect(firstUnread).toBeDefined();

    await user.click(firstUnread as HTMLElement);

    await waitFor(() => expect(screen.getByLabelText('1 unread')).toBeInTheDocument());
  });
});
