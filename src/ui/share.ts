import { countTiles, formatMm, type Catalog, type LayoutResult } from '../engine';
import { canvasToPng, renderShareImage, type ShareSummary } from '../render/exportPng';
import type { Appearance } from '../render/renderer';
import type { TextureCache } from '../render/textureCache';
import { activeKind, activePlan, type DesignDoc } from '../state/document';

export interface ShareContent extends ShareSummary {
  fileName: string;
  /** Short text sent with the picture. */
  text: string;
}

/** What the picture says: series, size, bands (walls) and how many tiles and boxes to buy. */
export function shareContent(doc: DesignDoc, result: LayoutResult, catalog: Catalog, today = new Date()): ShareContent {
  const plan = activePlan(doc);
  const series = catalog.series(plan.layout.seriesId);
  const wall = activeKind(doc) === 'wall';
  const { widthMm, heightMm, tiledHeightMm } = plan.surface;
  const tiled = wall && tiledHeightMm !== undefined && tiledHeightMm < heightMm ? `, tiled to ${formatMm(tiledHeightMm)} mm` : '';
  const size = `${formatMm(widthMm)} × ${formatMm(heightMm)} mm${tiled}`;
  const title = `${series.name} · ${wall ? 'Wall' : 'Floor'} ${size}`;

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
  const count = countTiles(result.pieces, doc.settings.allowancePct, catalog);
  lines.push(count.tiles.map((t) => `${t.name}: ${t.tilesNeeded} tiles (${t.boxes} box${t.boxes === 1 ? '' : 'es'} of ${t.tilesPerBox})`).join(' · '));
  const totals = count.totals;
  lines.push(
    `Total ${totals.tilesNeeded} tiles, ${totals.boxes} boxes, including ${formatMm(doc.settings.allowancePct)}% allowance · tiled area ${totals.areaM2.toFixed(2)} m² (${totals.areaSqFt.toFixed(1)} sq ft)`,
  );

  const date = today.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const slug = series.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    title,
    lines,
    footer: `KT Tile Designer · ${date} · cut pieces counted as whole tiles`,
    fileName: `kt-${activeKind(doc)}-${slug}-${formatMm(widthMm)}x${formatMm(heightMm)}.png`,
    text: `${title}. ${totals.tilesNeeded} tiles, ${totals.boxes} boxes.`,
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
  const blob = await canvasToPng(renderShareImage(result, textures, look, content));
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
