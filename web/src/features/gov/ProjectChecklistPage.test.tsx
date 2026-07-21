import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import type { ProjectChecklist } from '@/types/domain';
import { ProjectChecklistPage } from './ProjectChecklistPage';
import * as catalogApi from '@/features/catalog/api';
import * as govApi from './api';

vi.mock('@/features/catalog/api', async (o) => ({
  ...(await o<typeof catalogApi>()), fetchProjectChecklist: vi.fn(),
}));
vi.mock('./api', async (o) => ({
  ...(await o<typeof govApi>()), fetchGovProjects: vi.fn(async () => []),
}));

const fixture: ProjectChecklist = {
  stages: [
    { code: 'FOUNDATION', sequence: 30, name: 'Foundation', planned: true,
      certifiedCount: 1, totalCount: 2, rows: [
        { requirementId: 'r1', testCode: 'CUBE', testName: 'Cube', plannedCount: 6,
          status: 'CERTIFIED', orderId: 'o1', jobId: 'j1' },
        { requirementId: 'r2', testCode: 'SLUMP', testName: 'Slump', plannedCount: 1,
          status: 'FAILED', orderId: 'o1', jobId: 'j1' },
      ] },
    { code: 'ROADWORK', sequence: 70, name: 'Roadwork', planned: false,
      certifiedCount: 0, totalCount: 0, rows: [] },
  ],
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/gov/projects/p1/checklist']}>
          <Routes>
            <Route path="/gov/projects/:projectId/checklist" element={<ProjectChecklistPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(catalogApi.fetchProjectChecklist).mockResolvedValue(fixture));
afterEach(cleanup);

describe('ProjectChecklistPage', () => {
  it('checks only certified rows and flags failures', async () => {
    renderPage();
    const cube = await screen.findByLabelText(/Cube/);
    expect(cube).toBeChecked();
    const slump = screen.getByLabelText(/Slump/);
    expect(slump).not.toBeChecked();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows a not-planned-yet level with a plan link', async () => {
    renderPage();
    await screen.findByText(/Foundation/);
    expect(screen.getByText(/Not planned yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Plan this level/ })).toBeInTheDocument();
  });

  it('renders per-level progress and a project summary', async () => {
    renderPage();
    expect(await screen.findByText('1 of 2 certified')).toBeInTheDocument();
    expect(screen.getByText(/across 1 levels/)).toBeInTheDocument();
  });

  it('deep-links a failed row to its retest trail', async () => {
    renderPage();
    await screen.findByText(/Foundation/);
    const trail = screen.getByRole('link', { name: /Retest trail/ });
    expect(trail).toHaveAttribute('href', '/gov/orders/o1');
  });
});
