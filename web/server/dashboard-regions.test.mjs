// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { assembleRegions } from './bff.mjs';

describe('assembleRegions', () => {
  it('scores a child with settled orders and derives openOrders excluding green', () => {
    const children = [{ id: 'r1', name: 'Region 1' }];
    const bucketsById = new Map([
      ['r1', { green: 2, amber: 1, red: 1, neutral: 1 }],
    ]);
    const kpisById = new Map([
      ['r1', { activeJobs: 3, failedTests30d: 1, certificates30d: 2, vendorsActive: 4 }],
    ]);

    const regions = assembleRegions(children, bucketsById, kpisById);

    expect(regions).toHaveLength(1);
    expect(regions[0].id).toBe('r1');
    expect(regions[0].name).toBe('Region 1');
    expect(typeof regions[0].score).toBe('number');
    // openOrders = amber + red + neutral (everything except green)
    expect(regions[0].kpis.openOrders).toBe(3);
    expect(regions[0].kpis).toEqual({
      openOrders: 3, activeJobs: 3, failedTests30d: 1, certificates30d: 2, vendorsActive: 4,
    });
  });

  it('emits a zeroed region for a child absent from buckets/kpis', () => {
    const children = [{ id: 'empty', name: 'Empty Region' }];
    const bucketsById = new Map();
    const kpisById = new Map();

    const regions = assembleRegions(children, bucketsById, kpisById);

    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual({
      id: 'empty',
      name: 'Empty Region',
      score: null,
      kpis: {
        openOrders: 0, activeJobs: 0, failedTests30d: 0, certificates30d: 0, vendorsActive: 0,
      },
    });
  });

  it('handles a mix of a populated region and an empty region without dropping either', () => {
    const children = [
      { id: 'full', name: 'Full Region' },
      { id: 'empty', name: 'Empty Region' },
    ];
    const bucketsById = new Map([
      ['full', { green: 4, amber: 0, red: 0, neutral: 0 }],
    ]);
    const kpisById = new Map([
      ['full', { activeJobs: 2, failedTests30d: 0, certificates30d: 1, vendorsActive: 3 }],
    ]);

    const regions = assembleRegions(children, bucketsById, kpisById);

    expect(regions.map((r) => r.id)).toEqual(['full', 'empty']);

    const full = regions.find((r) => r.id === 'full');
    expect(full.score).toBe(100);
    expect(full.kpis.openOrders).toBe(0);

    const empty = regions.find((r) => r.id === 'empty');
    expect(empty.score).toBeNull();
    expect(empty.kpis).toEqual({
      openOrders: 0, activeJobs: 0, failedTests30d: 0, certificates30d: 0, vendorsActive: 0,
    });
  });
});
