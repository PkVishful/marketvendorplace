// Paging maths, kept separate from any screen so the list components only have
// to render what it returns.

export interface PageWindowInput {
  total: number;
  page: number;
  pageSize: number;
}

export interface PageWindow {
  totalPages: number;
  /** The requested page, clamped into range. */
  page: number;
  /** 1-based index of the first row shown; 0 when there are no rows. */
  from: number;
  to: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export function pageWindow({ total, page, pageSize }: PageWindowInput): PageWindow {
  const totalPages = Math.ceil(total / pageSize);
  // Clamped rather than trusted: deleting the last row of the last page would
  // otherwise strand the caller on a page that no longer exists.
  const clamped = Math.min(Math.max(1, Math.floor(page)), Math.max(1, totalPages));

  if (total === 0) {
    return { totalPages: 0, page: 1, from: 0, to: 0, hasPrev: false, hasNext: false };
  }

  const from = (clamped - 1) * pageSize + 1;
  const to = Math.min(clamped * pageSize, total);
  return {
    totalPages,
    page: clamped,
    from,
    to,
    hasPrev: clamped > 1,
    hasNext: clamped < totalPages,
  };
}

export type PageToken = number | 'gap';

/**
 * Page buttons to render: first, last, and a window around the current page,
 * with 'gap' standing in for the runs between.
 *
 * A gap is only emitted when it hides more than one page — a "…" in place of a
 * single number costs a click and saves nothing.
 */
export function pageNumbers(totalPages: number, current: number, radius = 1): PageToken[] {
  if (totalPages <= 0) return [];

  const wanted = new Set<number>([1, totalPages]);
  for (let p = current - radius; p <= current + radius; p += 1) {
    if (p >= 1 && p <= totalPages) wanted.add(p);
  }

  const sorted = [...wanted].sort((a, b) => a - b);
  const out: PageToken[] = [];
  let previous = 0;
  for (const page of sorted) {
    const skipped = page - previous - 1;
    if (previous !== 0 && skipped > 0) {
      if (skipped === 1) out.push(previous + 1);
      else out.push('gap');
    }
    out.push(page);
    previous = page;
  }
  return out;
}
