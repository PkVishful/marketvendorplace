import { describe, it, expect } from 'vitest';
import { pageWindow, pageNumbers } from './pagination';

describe('pageWindow', () => {
  it('describes the first page of many', () => {
    expect(pageWindow({ total: 208, page: 1, pageSize: 25 })).toEqual({
      totalPages: 9, page: 1, from: 1, to: 25, hasPrev: false, hasNext: true,
    });
  });

  it('clamps the last page to the real total', () => {
    const w = pageWindow({ total: 208, page: 9, pageSize: 25 });
    expect(w.from).toBe(201);
    expect(w.to).toBe(208);
    expect(w.hasNext).toBe(false);
  });

  it('handles an empty result without going negative', () => {
    expect(pageWindow({ total: 0, page: 1, pageSize: 25 })).toEqual({
      totalPages: 0, page: 1, from: 0, to: 0, hasPrev: false, hasNext: false,
    });
  });

  it('clamps a page number past the end back to the last page', () => {
    // Deleting the last row on page 9 must not strand the user on an empty page.
    expect(pageWindow({ total: 30, page: 99, pageSize: 25 }).page).toBe(2);
  });

  it('clamps a page number below one', () => {
    expect(pageWindow({ total: 30, page: 0, pageSize: 25 }).page).toBe(1);
    expect(pageWindow({ total: 30, page: -5, pageSize: 25 }).page).toBe(1);
  });

  it('treats an exact multiple as a whole last page, not an empty extra one', () => {
    const w = pageWindow({ total: 50, page: 2, pageSize: 25 });
    expect(w.totalPages).toBe(2);
    expect(w.to).toBe(50);
    expect(w.hasNext).toBe(false);
  });
});

describe('pageNumbers', () => {
  it('lists every page when there are few', () => {
    expect(pageNumbers(4, 1)).toEqual([1, 2, 3, 4]);
  });

  it('collapses the middle with gaps on a long run', () => {
    expect(pageNumbers(20, 10)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
  });

  it('does not emit a gap that hides exactly one page', () => {
    // A "…" standing in for a single number is worse than the number.
    expect(pageNumbers(7, 4)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the first and last page reachable near the start', () => {
    const pages = pageNumbers(20, 2);
    expect(pages[0]).toBe(1);
    expect(pages[pages.length - 1]).toBe(20);
    expect(pages).toContain(2);
  });

  it('returns an empty list when there is nothing to page', () => {
    expect(pageNumbers(0, 1)).toEqual([]);
  });

  it('returns a single page without gaps', () => {
    expect(pageNumbers(1, 1)).toEqual([1]);
  });
});
