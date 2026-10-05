import { describe, expect, it } from 'vitest';
import { suggestAlignments } from './suggest';
import { AZURE, catalog, FLOOR, IVORY, plainWall, presetWall, run, wall } from './testkit';
import type { Layout } from './types';

const suggest = (width: number, layout: Layout, priority?: 'avoid-slivers' | 'symmetric') =>
  suggestAlignments(wall(width, 2700), layout, catalog, priority ? { priority } : {});

describe('suggestAlignments on walls', () => {
  it('ranks centre-tile first for plain tiles on the 2450 wall', () => {
    const [first, ...rest] = suggest(2450, plainWall(IVORY, 'ivory-light-plain'));
    expect(first).toMatchObject({
      label: 'Centre tile',
      alignment: { x: { mode: 'centre-tile' } },
      smallestCutMm: 175,
      hasSliver: false,
      symmetric: true,
      motifCentred: null,
      explanation: 'No slivers; 175 mm cuts at both ends',
    });
    expect(rest.map((s) => [s.label, s.explanation])).toEqual([
      ['Centre joint', '25 mm slivers at both ends'],
      ['Left', '50 mm sliver at right edge'],
      ['Right', '50 mm sliver at left edge'],
    ]);
  });

  it('merges alignments that give the same layout', () => {
    const [first, second] = suggest(2400, plainWall(IVORY, 'ivory-light-plain'));
    expect(first).toMatchObject({ label: 'Centre joint', sameAs: ['Left', 'Right'], smallestCutMm: null });
    expect(first?.explanation).toBe('No cuts; full tiles at both ends');
    expect(second).toMatchObject({ label: 'Centre tile', smallestCutMm: 150 });
  });

  it('Ivory Highlighter pair: centring the motif is also the no-sliver option', () => {
    const [first] = suggest(2450, presetWall(IVORY, 'highlighter-band'));
    expect(first).toMatchObject({ label: 'Centre motif', sameAs: ['Centre tile'], motifCentred: true, hasSliver: false });
    expect(first?.explanation).toBe('7 whole highlighter pairs + 2 cut at the edges, 175 mm cuts at both ends, symmetric');
  });

  it('Azure Medallion on 2450: presents slivers versus a centred motif', () => {
    const suggestions = suggest(2450, presetWall(AZURE, 'highlighter-band'));
    const tile = suggestions.find((s) => s.label === 'Centre tile');
    const motif = suggestions.find((s) => s.label === 'Centre motif');
    expect(tile).toMatchObject({
      hasSliver: false,
      motifCentred: false,
      motifOffsetMm: 150,
      explanation: '3 whole medallions + 2 cut at the edges, 175 mm cuts at both ends, not symmetric',
    });
    expect(motif).toMatchObject({
      hasSliver: true,
      motifCentred: true,
      smallestCutMm: 25,
      explanation: '3 whole medallions + 2 cut at the edges, 25 mm slivers at both ends, symmetric',
    });
    // Default priority avoids slivers.
    expect(suggestions.map((s) => s.label).slice(0, 2)).toEqual(['Centre tile', 'Centre motif']);
  });

  it('"Symmetric pattern" priority puts symmetric options first', () => {
    const suggestions = suggest(2450, presetWall(AZURE, 'highlighter-band'), 'symmetric');
    expect(suggestions.map((s) => s.label).slice(0, 3)).toEqual(['Centre motif', 'Between motifs', 'Centre tile']);
  });

  it('keeps the current vertical alignment on walls', () => {
    const suggestions = suggestAlignments(wall(2450, 2700), plainWall(IVORY, 'ivory-light-plain'), catalog, {
      current: { x: { mode: 'left' }, y: { mode: 'custom', offsetMm: -100 } },
    });
    expect(suggestions.every((s) => s.alignment.y.mode === 'custom')).toBe(true);
  });

  it('respects a different minimum cut', () => {
    // At 10% the minimum is 30 mm, so a 50 mm cut is no longer a sliver but 25 mm still is.
    const suggestions = suggestAlignments(wall(2450, 2700), plainWall(IVORY, 'ivory-light-plain'), catalog, { minCutFraction: 0.1 });
    expect(suggestions.find((s) => s.label === 'Left')).toMatchObject({ hasSliver: false, explanation: 'No slivers; 50 mm cut at right edge' });
    expect(suggestions.find((s) => s.label === 'Centre joint')?.hasSliver).toBe(true);
    expect(suggestions[0]?.label).toBe('Centre tile');
  });
});

describe('suggestAlignments on floors', () => {
  it('compares both axes for a checkerboard', () => {
    const layout: Layout = { surface: 'floor', seriesId: FLOOR, designId: 'floor-checker' };
    const suggestions = suggestAlignments({ widthMm: 1800, heightMm: 2450 }, layout, catalog);
    const [first] = suggestions;
    expect(first?.hasSliver).toBe(false);
    expect(first?.symmetric).toBe(true);
    expect(first?.label).toBe('Centre joint across, centre tile along');
    expect(first?.explanation).toBe('No slivers; 175 mm cuts at top and bottom');
    expect(suggestions.some((s) => s.label === 'Centre tile both ways')).toBe(true);
    expect(suggestions.every((s) => s.motifCentred === null)).toBe(true);
  });
});

describe('symmetric patterns and cut motifs on a 2400 mm wall', () => {
  it('Azure Medallion: the top suggestion puts motif centres at 300 / 900 / 1500 / 2100, with no cut tiles or motifs', () => {
    const layout = presetWall(AZURE, 'highlighter-band');
    const [top] = suggest(2400, layout);
    expect(top).toMatchObject({
      label: 'Between motifs',
      sameAs: ['Centre joint', 'Left', 'Right'],
      cutTiles: 0,
      cutMotifs: 0,
      wholeMotifs: 4,
      symmetric: true,
      explanation: '4 whole medallions, no cuts, symmetric',
    });
    if (!top) throw new Error('no suggestion');
    expect(run(wall(2400, 2700), layout, top.alignment).motifCentres.map((p) => p.x)).toEqual([300, 900, 1500, 2100]);
  });

  it('Azure Medallion: a motif on the centreline leaves 2 cut motifs at the edges', () => {
    const motif = suggest(2400, presetWall(AZURE, 'highlighter-band')).find((s) => s.label === 'Centre motif');
    expect(motif).toMatchObject({
      cutMotifs: 2,
      wholeMotifs: 3,
      cutTiles: 0,
      symmetric: true,
      explanation: '3 whole medallions + 2 cut at the edges, no tile cuts, symmetric',
    });
  });

  it('Ivory Bloom Highlighter band: the top suggestion needs no cut tiles', () => {
    const [top] = suggest(2400, presetWall(IVORY, 'highlighter-band'));
    expect(top).toMatchObject({ cutTiles: 0, cutMotifs: 0, symmetric: true, explanation: '8 whole highlighter pairs, no cuts, symmetric' });
  });

  it('a motif off the centreline is not symmetric, even with equal cuts at both ends', () => {
    const tile = suggest(2400, presetWall(AZURE, 'highlighter-band')).find((s) => s.label === 'Centre tile');
    expect(tile).toMatchObject({ symmetric: false, cutTiles: 18, edgeCuts: { left: 150, right: 150 } });
  });
});
