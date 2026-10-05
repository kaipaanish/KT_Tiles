import { describe, expect, it } from 'vitest';
import { catalog } from '../designs/catalog';
import { moveBand, rotateCell, setAlignment, setSeries, setSurfaceSize, swapCells } from './actions';
import { createDefaultDocument, type DesignDoc } from './document';
import { parseSavedDesign, parseSavedToggles } from './persist';

const fresh = () => createDefaultDocument(catalog);
const roundTrip = (doc: DesignDoc) => parseSavedDesign(JSON.stringify(doc), catalog);
/** Saves a document after breaking it on purpose. */
const broken = (edit: (doc: Record<string, any>) => void) => {
  const doc = JSON.parse(JSON.stringify(fresh()));
  edit(doc);
  return parseSavedDesign(JSON.stringify(doc), catalog);
};

describe('saved designs', () => {
  it('round-trip, including edits, overrides and custom alignment', () => {
    let doc = fresh();
    doc = setSurfaceSize(doc, { widthMm: 2450, tiledHeightMm: 2100 });
    doc = moveBand(doc, 2, 0, catalog);
    doc = swapCells(doc, { col: 1, row: 0 }, { col: 1, row: 2 }, catalog);
    doc = setAlignment(doc, { x: { mode: 'custom', offsetMm: -42 }, y: { mode: 'custom', offsetMm: -100 } });
    expect(roundTrip(doc)).toEqual(doc);
    const floor = rotateCell({ ...setSeries(doc, 'demo-floor', catalog) }, { col: 1, row: 1 }, catalog);
    expect(roundTrip(floor)).toEqual(floor);
  });

  it('start fresh when the data is missing or damaged', () => {
    expect(parseSavedDesign(null, catalog)).toBeNull();
    expect(parseSavedDesign('', catalog)).toBeNull();
    expect(parseSavedDesign('{not json', catalog)).toBeNull();
    expect(parseSavedDesign('[]', catalog)).toBeNull();
    expect(broken((d) => (d.version = 2))).toBeNull();
    expect(broken((d) => (d.active = 'ceiling'))).toBeNull();
  });

  it('start fresh when the design no longer fits the catalog or the rules', () => {
    expect(broken((d) => (d.wall.layout.seriesId = 'retired-series'))).toBeNull();
    expect(broken((d) => (d.wall.layout.bands[2].rows = 3))).toBeNull(); // Highlighter pair needs 2, 4, ...
    expect(broken((d) => (d.floor.layout.designId = 'ivory-light-plain'))).toBeNull();
    expect(broken((d) => (d.wall.overrides = { '1,1': { rotation: 90 } }))).toBeNull(); // 300 × 450 tiles can't turn 90°
    expect(broken((d) => (d.wall.overrides = { '1,1': { tileId: 'azure-hl' } }))).toBeNull();
    expect(broken((d) => (d.wall.overrides = { 'one,two': {} }))).toBeNull();
    expect(broken((d) => (d.wall.surface.widthMm = -5))).toBeNull();
    expect(broken((d) => (d.wall.surface.tiledHeightMm = 9000))).toBeNull();
    expect(broken((d) => (d.wall.alignment.x = { mode: 'sideways' }))).toBeNull();
    expect(broken((d) => (d.settings.allowancePct = 400))).toBeNull();
  });

  it('fill in settings added after the design was saved', () => {
    const doc = broken((d) => delete d.settings.suggestPriority);
    expect(doc?.settings.suggestPriority).toBe('avoid-slivers');
  });

  it('read view toggles leniently', () => {
    expect(parseSavedToggles('{"showCuts":false,"showRepeat":true,"showMotifs":false,"showDims":true}')).toEqual({
      showCuts: false,
      showRepeat: true,
      showMotifs: false,
      showDims: true,
    });
    expect(parseSavedToggles('{"showCuts":1}')).toBeNull();
    expect(parseSavedToggles('nope')).toBeNull();
  });
});

describe('saved settings from before the ranking change', () => {
  it('read the old "centre the motif" priority as "symmetric"', () => {
    const doc = JSON.parse(JSON.stringify(createDefaultDocument(catalog)));
    doc.settings.suggestPriority = 'centre-motif';
    expect(parseSavedDesign(JSON.stringify(doc), catalog)?.settings.suggestPriority).toBe('symmetric');
  });
});
