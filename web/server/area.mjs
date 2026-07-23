// Pure logic for the Area drill-down. No SQL, no Express — everything here is
// a function of rows the route already fetched, which is what makes the
// hierarchy rules cheap to test.

/**
 * Interpret a single-child descent chain.
 *
 * The org tree is 8 strict levels (STATE…PROJECT, no level may be skipped),
 * but a seeded district is typically a single-child chain down to its sections:
 * one screen per level would bury a site seven taps deep. So a node with
 * exactly one child forwards to that child, and the caller renders the node we
 * land on. The skipped nodes are returned rather than discarded — breadcrumbs
 * still show the true, uncollapsed path.
 *
 * The SQL does the descending (it is the thing that can count children); this
 * function only reads the chain it produced. An empty chain means the requested
 * node was missing *or* out of scope — the route deliberately cannot tell those
 * apart, so the endpoint can't be used to probe for node existence.
 */
export function pickEffectiveNode(chainRows) {
  if (!chainRows || chainRows.length === 0) return { node: null, skipped: [] };
  const chain = [...chainRows].sort((a, b) => a.hops - b.hops);
  return { node: chain[chain.length - 1], skipped: chain.slice(0, -1) };
}

/**
 * Root-first crumb trail with a scope flag per crumb.
 *
 * A crumb above the caller's own anchor is context, not a destination: it
 * renders as plain text so nobody is invited to drill up out of their subtree.
 */
export function buildBreadcrumbs(ancestorRows, callerAnchorPath) {
  return [...ancestorRows]
    .sort((a, b) => a.path.split('.').length - b.path.split('.').length)
    .map((row) => ({
      id: row.id,
      name: row.name,
      level: row.level,
      inScope:
        row.path === callerAnchorPath || row.path.startsWith(`${callerAnchorPath}.`),
    }));
}
