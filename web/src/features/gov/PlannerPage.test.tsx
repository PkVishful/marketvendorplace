import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { PlannerPage } from './PlannerPage';
import * as useGov from './useGov';

vi.mock('./useGov');

const genMock = vi.fn(async () => ({ inserted: 3 }));

beforeEach(() => {
  vi.mocked(useGov.useGovProjects).mockReturnValue({
    data: [{ id: 'p1', name: 'Test Project', code: 'TP1' }], isPending: false,
  } as never);
  vi.mocked(useGov.useConstructionStages).mockReturnValue({
    data: [{ id: 's1', code: 'SUPERSTRUCTURE', name: 'Superstructure', sequence: 50 }],
  } as never);
  vi.mocked(useGov.useProjectRequirements).mockReturnValue({
    data: [], isPending: false,
  } as never);
  vi.mocked(useGov.useStageUnits).mockReturnValue({
    data: ['weld', 'member', 'failed_location'], isPending: false,
  } as never);
  vi.mocked(useGov.useGenerateRequirements).mockReturnValue({
    mutateAsync: genMock, isPending: false,
  } as never);
  vi.mocked(useGov.useCreateGovOrder).mockReturnValue({
    mutateAsync: vi.fn(), isPending: false,
  } as never);
});
afterEach(() => { cleanup(); genMock.mockClear(); });

function renderPlanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><PlannerPage /></MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('PlannerPage — quantity inputs from catalog', () => {
  it('renders one quantity input per unit the stage actually needs', async () => {
    renderPlanner();
    await waitFor(() => expect(screen.getAllByRole('spinbutton')).toHaveLength(3));
  });

  it('sends every stage unit in the generate call (incl. weld/member/failed_location)', async () => {
    renderPlanner();
    const inputs = await screen.findAllByRole('spinbutton');
    await userEvent.type(inputs[0], '4');
    await userEvent.type(inputs[1], '2');
    await userEvent.type(inputs[2], '1');
    await userEvent.click(screen.getByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(genMock).toHaveBeenCalledTimes(1));
    const arg = genMock.mock.calls[0][0] as { stageCode: string; quantities: Record<string, number> };
    expect(Object.keys(arg.quantities).sort()).toEqual(['failed_location', 'member', 'weld']);
    expect(arg.quantities).toMatchObject({ weld: 4, member: 2, failed_location: 1 });
  });
});
