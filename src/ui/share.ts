import { countTiles, formatMm, type Catalog, type LayoutResult } from '../engine';
import { canvasToPng, renderPhotoShareImage, renderShareImage, type ShareSummary } from '../render/exportPng';
import type { Appearance } from '../render/renderer';
import type { TextureCache } from '../render/textureCache';
import { activeKind, activePlan, type DesignDoc, type SurfacePlan } from '../state/document';

export interface ShareContent extends ShareSummary {
  fileName: string;
  /** Short text sent with the picture. */
  text: string;
}

/** One surface's summary: series and size, bands or design, tiles and boxes per tile, and totals. */
export function planSummary(
  plan: SurfacePlan,
  result: LayoutResult,
  catalog: Catalog,
  allowancePct: number,
): { series: string; size: string; heading: string; lines: string[]; tiles: number; boxes: number } {
  const series = catalog.series(plan.layout.seriesId);
  const wall = plan.layout.surface === 'wall';
  const { widthMm, heightMm, tiledHeightMm } = plan.surface;
  const tiled = wall && tiledHeightMm !== undefined && tiledHeightMm < heightMm ? `, tiled to ${formatMm(tiledHeightMm)} mm` : '';
  const size = `${formatMm(widthMm)} × ${formatMm(heightMm)} mm${tiled}`;
  const heading = `${series.name} · ${wall ? 'Wall' : 'Floor'} ${size}`;
  const lines: string[] = [];
  if (wall) {
    const bands = result.bands
      .filter((b) => !b.hidden)
      .map((b) => `${catalog.design(b.designId).name} ${formatMm(b.fromMm)}–${formatMm(b.toMm)}`)
      .join(' · ');
    lines.push(`Bands from the floor (mm): ${bands}`);
  } else {
    if (plan.layout.surface === 'floor') lines.push(`Design: ${catalog.design(plan.layout.designId).name}`);
  }
  const count = countTiles(result.pieces, allowancePct, catalog);
  lines.push(count.tiles.map((t) => `${t.name}: ${t.tilesNeeded} tiles (${t.boxes} box${t.boxes === 1 ? '' : 'es'} of ${t.tilesPerBox})`).join(' · '));
  const totals = count.totals;
  lines.push(
    `Total ${totals.tilesNeeded} tiles, ${totals.boxes} boxes, including ${formatMm(allowancePct)}% allowance · tiled area ${totals.areaM2.toFixed(2)} m² (${totals.areaSqFt.toFixed(1)} sq ft)`,
  );
  return { series: series.name, size, heading, lines, tiles: totals.tilesNeeded, boxes: totals.boxes };
}

const dated = (today: Date) => today.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** What the picture says: series, size, bands (walls) and how many tiles and boxes to buy. */
export function shareContent(doc: DesignDoc, result: LayoutResult, catalog: Catalog, today = new Date()): ShareContent {
  const plan = activePlan(doc);
  const summary = planSummary(plan, result, catalog, doc.settings.allowancePct);
  const { widthMm, heightMm } = plan.surface;
  const title = summary.heading;
  const lines = summary.lines;
  const date = dated(today);
  const slug = slugOf(catalog.series(plan.layout.seriesId).name);
  return {
    title,
    lines,
    footer: `KT Tile Designer · ${date} · cut pieces counted as whole tiles`,
    fileName: `kt-${activeKind(doc)}-${slug}-${formatMm(widthMm)}x${formatMm(heightMm)}.png`,
    text: `${title}. ${summary.tiles} tiles, ${summary.boxes} boxes.`,
  };
}

/** The photo's picture: every tiled surface, each with its series, size and tiles to buy. */
export function photoShareContent(
  surfaces: readonly { name: string; plan: SurfacePlan; result: LayoutResult }[],
  catalog: Catalog,
  allowancePct: number,
  today = new Date(),
): ShareContent {
  const summaries = surfaces.map((s) => ({ name: s.name, ...planSummary(s.plan, s.result, catalog, allowancePct) }));
  const title = `Tiles on the photo · ${surfaces.map((s) => `${s.name}: ${catalog.series(s.plan.layout.seriesId).name}`).join(' · ')}`;
  const lines = summaries.flatMap((s) => [`${s.name}: ${s.series} · ${s.size}`, ...s.lines]);
  const tiles = summaries.reduce((n, s) => n + s.tiles, 0);
  const boxes = summaries.reduce((n, s) => n + s.boxes, 0);
  const date = dated(today);
  return {
    title,
    lines,
    footer: `KT Tile Designer · ${date} · a preview on your photo: check the sizes on site · cut pieces counted as whole tiles`,
    fileName: `kt-photo-${slugOf(summaries.map((s) => s.name).join('-'))}-${today.toISOString().slice(0, 10)}.png`,
    text: `Tiles on the photo: ${tiles} tiles, ${boxes} boxes in all.`,
  };
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Shares the picture with the Web Share API where it can send files (WhatsApp and friends on
 * phones), and downloads it everywhere else.
 */
export async function sharePicture(
  doc: DesignDoc,
  result: LayoutResult,
  catalog: Catalog,
  textures: TextureCache,
  look: Appearance,
): Promise<ShareOutcome> {
  const content = shareContent(doc, result, catalog);
  return shareOrDownload(await canvasToPng(renderShareImage(result, textures, look, content)), content);
}

/** The photo with its tiles and the summary strip, shared or downloaded like the designer's picture. */
export async function sharePhoto(picture: HTMLCanvasElement, content: ShareContent): Promise<ShareOutcome> {
  return shareOrDownload(await canvasToPng(renderPhotoShareImage(picture, content)), content);
}

async function shareOrDownload(blob: Blob, content: ShareContent): Promise<ShareOutcome> {
  const file = new File([blob], content.fileName, { type: 'image/png' });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: content.title, text: content.text });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Anything else (no share target, permission): fall back to a download.
    }
  }
  download(blob, content.fileName);
  return 'downloaded';
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
