import type { Catalog } from './catalog';
import type { Band, Layout } from './types';

/** Problems with a wall's bands, as readable sentences. Empty when the bands are valid. */
export function validateBands(bands: readonly Band[], seriesId: string, catalog: Catalog): string[] {
  const problems: string[] = [];
  if (bands.length === 0) problems.push('A wall needs at least one band.');
  bands.forEach((band, i) => {
    const label = `Band ${i + 1}`;
    if (!catalog.hasDesign(band.designId)) {
      problems.push(`${label} uses an unknown design "${band.designId}".`);
      return;
    }
    const design = catalog.design(band.designId);
    if (design.seriesId !== seriesId) problems.push(`${label} uses "${design.name}" from another series.`);
    if (band.rows === 'fill') {
      if (i !== bands.length - 1) problems.push(`${label} (${design.name}): only the top band can fill the remaining height.`);
    } else if (!Number.isInteger(band.rows) || band.rows <= 0) {
      problems.push(`${label} (${design.name}): rows must be a whole number above 0.`);
    } else if (band.rows % design.rows !== 0) {
      problems.push(`${label} (${design.name}): ${band.rows} rows isn't a multiple of the design's ${design.rows} rows.`);
    }
  });
  return problems;
}

/** Problems with a layout, as readable sentences. Empty when the layout is valid. */
export function validateLayout(layout: Layout, catalog: Catalog): string[] {
  if (!catalog.hasSeries(layout.seriesId)) return [`Unknown series "${layout.seriesId}".`];
  const series = catalog.series(layout.seriesId);
  const problems: string[] = [];
  if (series.surface !== layout.surface) problems.push(`${series.name} is a ${series.surface} series, not a ${layout.surface} series.`);
  if (layout.surface === 'wall') {
    problems.push(...validateBands(layout.bands, layout.seriesId, catalog));
  } else if (!catalog.hasDesign(layout.designId)) {
    problems.push(`Unknown design "${layout.designId}".`);
  } else if (catalog.design(layout.designId).seriesId !== layout.seriesId) {
    problems.push(`Design "${catalog.design(layout.designId).name}" belongs to another series.`);
  }
  return problems;
}

export class LayoutError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(problems.join(' '));
    this.name = 'LayoutError';
    this.problems = problems;
  }
}

export function assertValidLayout(layout: Layout, catalog: Catalog): void {
  const problems = validateLayout(layout, catalog);
  if (problems.length > 0) throw new LayoutError(problems);
}
