import { buildCatalog, CatalogError } from '../engine/catalog';
import { painters } from './painters';
import seriesData from './series.json';

/** The tile catalog, validated when the app loads: bad data fails loudly with every problem listed. */
export const catalog = buildCatalog(seriesData);

const unknownPainters = catalog
  .seriesList()
  .flatMap((series) => catalog.tilesOf(series.id))
  .filter((tile) => !(tile.placeholder.painter in painters))
  .map((tile) => `tile "${tile.id}".placeholder.painter: "${tile.placeholder.painter}" isn't one of: ${Object.keys(painters).join(', ')}`);
if (unknownPainters.length > 0) throw new CatalogError(unknownPainters);
