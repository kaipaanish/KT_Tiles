import type { Pt, Quad } from './homography';
import type { PhotoTransform } from './photoView';

const RADIUS = 56;
const ZOOM = 3;
/** Distance from the corner to the loupe's centre, so the finger never covers it. */
const GAP = RADIUS + 44;

/**
 * A magnifier beside a corner while it is dragged: the photo around the corner at three times the
 * current zoom, with the corner's two edges and a crosshair, so the corner can be put exactly on
 * the wall's edge even under a fingertip. Drawn in CSS pixels on the overlay canvas.
 */
export function drawLoupe(
  ctx: CanvasRenderingContext2D,
  photo: { canvas: HTMLCanvasElement; width: number; height: number },
  t: PhotoTransform,
  frame: { width: number; height: number },
  quad: Quad,
  corner: number,
  /** Room kept free at the top of the stage (the floating hint). */
  clearTop = 64,
): void {
  const at = quad[corner]!;
  const screen = { x: t.x + at.x * t.scale, y: t.y + at.y * t.scale };
  // Above the corner if there is room under the hint, else a top corner of the stage; never below
  // the finger, where the hand is. The first place clear of all four corners wins.
  const corners = quad.map((p) => ({ x: t.x + p.x * t.scale, y: t.y + p.y * t.scale }));
  const clampX = (x: number) => Math.min(frame.width - RADIUS - 8, Math.max(RADIUS + 8, x));
  const topRow = clearTop + RADIUS + 8;
  const places = [
    ...(screen.y - GAP - RADIUS >= clearTop ? [{ x: clampX(screen.x), y: screen.y - GAP }] : []),
    { x: RADIUS + 12, y: topRow },
    { x: frame.width - RADIUS - 12, y: topRow },
  ];
  const clearance = (c: Pt) => Math.min(...corners.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
  const place = places.find((c) => clearance(c) >= RADIUS + 12) ?? places.reduce((a, b) => (clearance(b) > clearance(a) ? b : a));
  const cx = place.x;
  const cy = place.y;
  const scale = t.scale * ZOOM;
  const inLoupe = (p: Pt) => ({ x: cx + (p.x - at.x) * scale, y: cy + (p.y - at.y) * scale });

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#2f2e2b';
  ctx.fill();
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(photo.canvas, cx - at.x * scale, cy - at.y * scale, photo.width * scale, photo.height * scale);
  // The two edges that meet at this corner.
  const before = inLoupe(quad[(corner + 3) % 4]!);
  const after = inLoupe(quad[(corner + 1) % 4]!);
  ctx.beginPath();
  ctx.moveTo(before.x, before.y);
  ctx.lineTo(cx, cy);
  ctx.lineTo(after.x, after.y);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx, cy + 10);
  ctx.strokeStyle = '#ff8a00';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, RADIUS, 0, Math.PI * 2);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}
