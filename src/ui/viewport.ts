import type { View } from '../render/renderer';

/** Space kept clear around the surface: dimension labels, the top bar, the bottom sheet. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Fits the whole surface into the free area of a width × height canvas. */
export function fitView(surfaceW: number, surfaceH: number, width: number, height: number, insets: Insets): View {
  const freeW = Math.max(40, width - insets.left - insets.right);
  const freeH = Math.max(40, height - insets.top - insets.bottom);
  const scale = Math.min(freeW / surfaceW, freeH / surfaceH);
  return {
    scale,
    originX: insets.left + (freeW - surfaceW * scale) / 2,
    originY: insets.top + (freeH + surfaceH * scale) / 2,
  };
}

/** Zooms by `factor` keeping the surface point under (sx, sy) where it is. */
export function zoomAround(view: View, factor: number, sx: number, sy: number, minScale: number, maxScale: number): View {
  const scale = Math.min(maxScale, Math.max(minScale, view.scale * factor));
  const k = scale / view.scale;
  return { scale, originX: sx - (sx - view.originX) * k, originY: sy - (sy - view.originY) * k };
}

export function panView(view: View, dx: number, dy: number): View {
  return { ...view, originX: view.originX + dx, originY: view.originY + dy };
}

/** A view at `scale` with the surface point (x, y) in mm at the centre of the free area. */
export function viewCentredOn(scale: number, x: number, y: number, width: number, height: number, insets: Insets): View {
  const cx = insets.left + (width - insets.left - insets.right) / 2;
  const cy = insets.top + (height - insets.top - insets.bottom) / 2;
  return { scale, originX: cx - x * scale, originY: cy + y * scale };
}
