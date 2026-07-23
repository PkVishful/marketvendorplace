// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { pickEffectiveNode, buildBreadcrumbs } from './area.mjs';

const n = (id, level, hops) => ({ id, level, name: id, path: id, hops });

describe('pickEffectiveNode', () => {
  it('returns the node itself when it has more than one child', () => {
    const { node, skipped } = pickEffectiveNode([n('sd1', 'SUBDIVISION', 0)]);
    expect(node.id).toBe('sd1');
    expect(skipped).toEqual([]);
  });

  it('forwards through a single-child chain to the first branching node', () => {
    const chain = [
      n('coimbatore', 'DISTRICT', 0),
      n('div1', 'DIVISION', 1),
      n('circle1', 'CIRCLE', 2),
      n('sd1', 'SUBDIVISION', 3),
    ];
    const { node, skipped } = pickEffectiveNode(chain);
    expect(node.id).toBe('sd1');
    expect(skipped.map((s) => s.id)).toEqual(['coimbatore', 'div1', 'circle1']);
  });

  it('forwards all the way to a project when the chain bottoms out', () => {
    const chain = [n('sec1', 'SECTION', 0), n('fu1', 'FIELD_UNIT', 1), n('prj1', 'PROJECT', 2)];
    expect(pickEffectiveNode(chain).node.id).toBe('prj1');
  });

  it('never forwards past a PROJECT', () => {
    const { node } = pickEffectiveNode([n('prj1', 'PROJECT', 0)]);
    expect(node.level).toBe('PROJECT');
  });

  it('returns the single node unchanged for a childless leaf', () => {
    const { node, skipped } = pickEffectiveNode([n('fu9', 'FIELD_UNIT', 0)]);
    expect(node.id).toBe('fu9');
    expect(skipped).toEqual([]);
  });

  it('tolerates rows arriving out of hop order', () => {
    const chain = [n('sd1', 'SUBDIVISION', 3), n('coimbatore', 'DISTRICT', 0), n('div1', 'DIVISION', 1), n('circle1', 'CIRCLE', 2)];
    const { node, skipped } = pickEffectiveNode(chain);
    expect(node.id).toBe('sd1');
    expect(skipped.map((s) => s.id)).toEqual(['coimbatore', 'div1', 'circle1']);
  });

  it('returns null for an empty chain, which is how the route detects out-of-scope', () => {
    expect(pickEffectiveNode([])).toEqual({ node: null, skipped: [] });
  });
});

describe('buildBreadcrumbs', () => {
  const rows = [
    { id: 'tn', name: 'Tamil Nadu', level: 'STATE', path: 'TN' },
    { id: 'mdu', name: 'Madurai', level: 'DISTRICT', path: 'TN.MADURAI' },
    { id: 'melur', name: 'Melur', level: 'DIVISION', path: 'TN.MADURAI.MELUR' },
  ];

  it('flags crumbs at or below the caller anchor as in scope', () => {
    const crumbs = buildBreadcrumbs(rows, 'TN.MADURAI');
    expect(crumbs.map((c) => [c.name, c.inScope])).toEqual([
      ['Tamil Nadu', false], ['Madurai', true], ['Melur', true],
    ]);
  });

  it('marks every crumb in scope for a state-anchored caller', () => {
    expect(buildBreadcrumbs(rows, 'TN').every((c) => c.inScope)).toBe(true);
  });

  it('keeps root-first ordering regardless of input order', () => {
    const crumbs = buildBreadcrumbs([...rows].reverse(), 'TN');
    expect(crumbs.map((c) => c.name)).toEqual(['Tamil Nadu', 'Madurai', 'Melur']);
  });

  it('does not treat a sibling with a shared name prefix as in scope', () => {
    // TN.MADURAI must not match TN.MADURAI_NORTH — a prefix test without the
    // dot separator would leak a neighbouring district into scope.
    const sibling = [{ id: 'mdun', name: 'Madurai North', level: 'DISTRICT', path: 'TN.MADURAI_NORTH' }];
    expect(buildBreadcrumbs(sibling, 'TN.MADURAI')[0].inScope).toBe(false);
  });
});
