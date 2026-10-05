import { catalog } from '../designs/catalog';
import { layoutSurface } from '../engine';
import type { Appearance } from '../render/renderer';
import { TextureCache } from '../render/textureCache';
import { activePlan, applyQuery, createDefaultDocument } from '../state/document';
import { CanvasView } from './canvasView';
import { fitView, viewCentredOn, type Insets } from './viewport';

/** Room for the dimension lines around the surface. */
const INSETS: Insets = { top: 24, right: 52, bottom: 52, left: 52 };

export function startApp(root: HTMLElement): void {
  const params = new URLSearchParams(location.search);
  const doc = applyQuery(createDefaultDocument(catalog), params, catalog);
  const plan = activePlan(doc);

  const stage = document.createElement('div');
  stage.className = 'stage';
  root.append(stage);
  const textures = new TextureCache(catalog, () => canvasView.requestDraw());
  const canvasView = new CanvasView(stage, textures, () => INSETS);
  textures.prepare(catalog.tilesOf(plan.layout.seriesId).map((t) => t.id));

  const result = layoutSurface(plan.surface, plan.layout, plan.alignment, plan.overrides, catalog, {
    minCutFraction: doc.settings.minCutFraction,
  });
  const flag = (key: string, fallback: boolean) => (params.has(key) ? params.get(key) !== '0' : fallback);
  const look: Appearance = {
    groutMm: doc.settings.groutMm,
    groutColor: doc.settings.groutColor,
    showCuts: flag('cuts', true),
    showRepeat: flag('repeat', false),
    showMotifs: flag('motifs', false),
    showDims: flag('dims', true),
  };
  canvasView.onDraw = () => {
    document.body.dataset.ready = 'true';
  };
  canvasView.setScene({ result, look, overlay: { dragging: flag('drag', false) } });

  // ?zoom=4&cx=1200&cy=1800 opens zoomed in on a point (mm), e.g. to inspect a motif joint.
  const zoom = Number(params.get('zoom'));
  if (zoom > 0) {
    const { width, height } = canvasView.size;
    const fitted = fitView(result.widthMm, result.heightMm, width, height, INSETS);
    const cx = params.has('cx') ? Number(params.get('cx')) : result.widthMm / 2;
    const cy = params.has('cy') ? Number(params.get('cy')) : result.heightMm / 2;
    canvasView.setView(viewCentredOn(fitted.scale * zoom, cx, cy, width, height, INSETS));
  }
}
