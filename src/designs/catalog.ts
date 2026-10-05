import { buildCatalog } from '../engine/catalog';
import seriesData from './series.json';

/** The tile catalog, validated when the app loads: bad data fails loudly with every problem listed. */
export const catalog = buildCatalog(seriesData);
