/**
 * Why clicking a district on the state map does nothing.
 *
 * Three independent things must all hold for a region on a raster map to be
 * clickable, and at state level none of them do. This pins each one separately
 * so a future fix can't half-land: restoring the click overlay without adding
 * hotspot geometry (or vice versa) still leaves the map dead, and these tests
 * say which layer is missing.
 *
 * The district (Coimbatore) map is the working example — same component, same
 * raster branch, but with hotspots defined and selection enabled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { DistrictPerformanceMap } from './DistrictMap';
import { TAMIL_NADU_MAP } from './districtMaps/tamilNadu';
import { COIMBATORE_MAP } from './districtMaps/coimbatore';
import * as govHooks from '@/features/gov/useGov';

vi.mock('@/features/gov/useGov', async (o) => ({
  ...(await o<typeof govHooks>()),
  useGovDashboardMap: vi.fn(() => ({
    data: { level: 'state', key: 'tamilnadu', regions: [] },
    isPending: false, isError: false, refetch: vi.fn(),
  })),
}));

function renderMap(props: { districtName?: string; orgPath?: string }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <DistrictPerformanceMap {...props} />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe('map region click targets — data layer', () => {
  it('the district map defines a hotspot for every region', () => {
    const withHotspot = COIMBATORE_MAP.talukas.filter((t) => t.hotspot).length;
    expect(withHotspot).toBe(COIMBATORE_MAP.talukas.length);
    expect(withHotspot).toBeGreaterThan(0);
  });

  it('the state map defines no hotspot for any district — nothing to click', () => {
    // This is the first of three reasons the state map is inert.
    expect(TAMIL_NADU_MAP.talukas.filter((t) => t.hotspot)).toHaveLength(0);
    expect(TAMIL_NADU_MAP.talukas.length).toBe(38);
  });
});

describe('map region click targets — render layer', () => {
  it('renders a clickable overlay rect per taluka on the district map', () => {
    const { container } = renderMap({ districtName: 'Coimbatore', orgPath: 'TN.COIMBATORE' });
    const rects = container.querySelectorAll('figure svg rect');
    expect(rects.length).toBe(COIMBATORE_MAP.talukas.length);
  });

  it('renders no overlay at all on the state map', () => {
    const { container } = renderMap({ districtName: 'Tamil Nadu', orgPath: 'TN' });
    expect(container.querySelector('figure img')).toBeTruthy();
    // Second reason: the overlay <svg> is gated behind `selectable`, which is
    // false for the state map, so there is no hit layer over the artwork.
    expect(container.querySelectorAll('figure svg')).toHaveLength(0);
    expect(container.querySelectorAll('figure svg rect')).toHaveLength(0);
  });
});

describe('map region click targets — interaction layer', () => {
  it('clicking an overlay rect on the district map selects that taluka', async () => {
    const user = userEvent.setup();
    const { container } = renderMap({ districtName: 'Coimbatore', orgPath: 'TN.COIMBATORE' });

    expect(container.querySelector('.taluk-detail-panel')).toBeNull();

    const rect = container.querySelector('figure svg rect');
    expect(rect).toBeTruthy();
    await user.click(rect as Element);

    // Selection is what the state map cannot reach: no rect, no click, no panel.
    expect(container.querySelector('.taluk-detail-panel')).toBeTruthy();
  });

  it('clicking the state map image selects nothing, because there is no hit layer', async () => {
    const user = userEvent.setup();
    const { container } = renderMap({ districtName: 'Tamil Nadu', orgPath: 'TN' });

    const img = container.querySelector('figure img');
    expect(img).toBeTruthy();
    await user.click(img as Element);

    expect(container.querySelector('.taluk-detail-panel')).toBeNull();
  });
});
