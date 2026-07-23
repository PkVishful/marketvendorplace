import { describe, it, expect } from 'vitest';
import { filterChildren } from './filterChildren';
import type { AreaChild } from './api';

const child = (name: string): AreaChild => ({
  id: name.toLowerCase(),
  name,
  score: null,
  kpis: {
    openOrders: 0, activeJobs: 0, failedTests30d: 0, certificates30d: 0, vendorsActive: 0,
  },
});

const districts = [
  child('Coimbatore'), child('Chennai'), child('Tiruchirappalli'),
  child('The Nilgiris'), child('Viluppuram'), child('Thoothukudi'),
];

describe('filterChildren', () => {
  it('returns everything for an empty query', () => {
    expect(filterChildren(districts, '')).toHaveLength(6);
    expect(filterChildren(districts, '   ')).toHaveLength(6);
  });

  it('matches on a partial name, case-insensitively', () => {
    expect(filterChildren(districts, 'coim').map((c) => c.name)).toEqual(['Coimbatore']);
    expect(filterChildren(districts, 'CHEN').map((c) => c.name)).toEqual(['Chennai']);
  });

  it('matches a substring anywhere in the name, not just the start', () => {
    expect(filterChildren(districts, 'nilgiris').map((c) => c.name)).toEqual(['The Nilgiris']);
  });

  it('ignores punctuation and spacing so "the nilgiris" and "nilgiris" both hit', () => {
    expect(filterChildren(districts, 'the-nilgiris').map((c) => c.name)).toEqual(['The Nilgiris']);
  });

  it('finds a district by an alternate romanisation', () => {
    // org_units and everyday usage disagree on these spellings; a search that
    // only matched the stored form would look broken to whoever typed the other.
    expect(filterChildren(districts, 'villupuram').map((c) => c.name)).toEqual(['Viluppuram']);
    expect(filterChildren(districts, 'trichy').map((c) => c.name)).toEqual(['Tiruchirappalli']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterChildren(districts, 'zzz')).toEqual([]);
  });
});

describe('filterChildren — district names that look like articles', () => {
  const tricky = [child('Theni'), child('The Nilgiris'), child('Thoothukudi')];

  it('finds Theni without collapsing it to a two-letter query', () => {
    // Stripping a leading "the" from the query would leave "ni" and match
    // Nilgiris too. Theni is a real district; it must stay intact.
    expect(filterChildren(tricky, 'theni').map((c) => c.name)).toContain('Theni');
  });

  it('does not match Thoothukudi when searching Theni', () => {
    expect(filterChildren(tricky, 'theni').map((c) => c.name)).not.toContain('Thoothukudi');
  });
});
