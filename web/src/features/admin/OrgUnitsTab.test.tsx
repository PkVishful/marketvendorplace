import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import type { AdminOrgUnit } from '@/types/domain';
import { OrgUnitsTab } from './OrgUnitsTab';
import * as adminApi from './api';

vi.mock('./api', async (o) => ({
  ...(await o<typeof adminApi>()),
  fetchAdminOrgUnits: vi.fn(),
}));

// A miniature tree with every level represented, mirroring the real shape:
// one state, then a chain down to a project, plus extra districts.
function fixture(): AdminOrgUnit[] {
  const rows: AdminOrgUnit[] = [
    { id: 'tn', name: 'Tamil Nadu', level: 'STATE', path: 'TN' },
  ];
  for (let d = 1; d <= 20; d += 1) {
    rows.push({ id: `d${d}`, name: `District ${d}`, level: 'DISTRICT', path: `TN.D${d}` });
  }
  rows.push({ id: 'div1', name: 'Division 1', level: 'DIVISION', path: 'TN.D1.DIV1' });
  rows.push({ id: 'prj1', name: 'Project 1', level: 'PROJECT', path: 'TN.D1.DIV1.PRJ1' });
  return rows;
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <OrgUnitsTab />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe('OrgUnitsTab', () => {
  it('counts every unit the endpoint returned, not just the first page', async () => {
    const rows = fixture(); // 23 units
    vi.mocked(adminApi.fetchAdminOrgUnits).mockResolvedValue(rows);

    renderTab();

    // The count line must reflect the whole dataset — a mismatch here is how a
    // paging bug hides most of the tree.
    expect(await screen.findByText(`Showing ${rows.length} of ${rows.length}`)).toBeInTheDocument();
  });

  it('shows only one page of rows at a time', async () => {
    vi.mocked(adminApi.fetchAdminOrgUnits).mockResolvedValue(fixture());
    const { container } = renderTab();

    await screen.findByText('Tamil Nadu');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(15);
  });

  it('lists a level option for every level present', async () => {
    vi.mocked(adminApi.fetchAdminOrgUnits).mockResolvedValue(fixture());
    renderTab();

    const select = await screen.findByLabelText('Filter by level');
    // All levels + STATE + DISTRICT + DIVISION + PROJECT
    expect((select as HTMLSelectElement).options).toHaveLength(5);
  });
});
