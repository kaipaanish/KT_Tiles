/**
 * Turns pointer events on the canvas into taps, double taps, long presses, drags, pinch zoom,
 * two-finger pans and wheel zoom. Works the same for touch, pen and mouse.
 */

export interface PointerPoint {
  /** CSS pixels from the element's top-left corner. */
  x: number;
  y: number;
  pointerType: string;
}

/** A drag owned by the current mode (moving the pattern, carrying a tile...). */
export interface Drag {
  move(p: PointerPoint): void;
  end(p: PointerPoint): void;
  cancel(): void;
}

export interface GestureTarget {
  /** A one-finger press started moving. Return a Drag to handle it, or null to pan the view. */
  dragStart(start: PointerPoint, now: PointerPoint): Drag | null;
  /** The pointer was held still. Return a Drag to take over, or null to carry on as normal. */
  longPress(p: PointerPoint): Drag | null;
  tap(p: PointerPoint): void;
  doubleTap(p: PointerPoint): void;
  zoom(factor: number, x: number, y: number): void;
  pan(dx: number, dy: number): void;
}

const LONG_PRESS_MS = 450;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

interface Press {
  id: number;
  start: PointerPoint;
  last: PointerPoint;
  moved: boolean;
  /** Middle or right mouse button: always pans, never taps. */
  panOnly: boolean;
  drag: Drag | null;
  panning: boolean;
  timer: number | undefined;
}

interface Pinch {
  ids: [number, number];
  distance: number;
  mid: { x: number; y: number };
}

export function attachGestures(el: HTMLElement, target: GestureTarget): () => void {
  const pointers = new Map<number, PointerPoint>();
  let press: Press | null = null;
  let pinch: Pinch | null = null;
  /** After a pinch, the finger left on the glass does nothing until it lifts. */
  const ignored = new Set<number>();
  let lastTap: { time: number; x: number; y: number } | null = null;

  const point = (e: PointerEvent): PointerPoint => {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pointerType: e.pointerType };
  };
  const slop = (p: PointerPoint) => (p.pointerType === 'mouse' ? 4 : 8);

  const endPress = (finish: 'end' | 'cancel', p?: PointerPoint) => {
    if (!press) return;
    window.clearTimeout(press.timer);
    if (press.drag) {
      if (finish === 'end' && p) press.drag.end(p);
      else press.drag.cancel();
    }
    press = null;
  };

  const startPinch = () => {
    const [a, b] = [...pointers.entries()];
    if (!a || !b) return;
    pinch = { ids: [a[0], b[0]], distance: Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y), mid: { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 } };
  };

  const onDown = (e: PointerEvent) => {
    if (pointers.size >= 2) return;
    const p = point(e);
    pointers.set(e.pointerId, p);
    el.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      // A second finger turns whatever was happening into a pinch. A drag that has really moved keeps its result.
      if (press) endPress(press.moved && press.drag ? 'end' : 'cancel', press.last);
      startPinch();
      return;
    }
    const panOnly = e.pointerType === 'mouse' && e.button !== 0;
    press = { id: e.pointerId, start: p, last: p, moved: false, panOnly, drag: null, panning: panOnly, timer: undefined };
    if (!panOnly) {
      press.timer = window.setTimeout(() => {
        if (!press || press.moved || press.drag) return;
        const drag = target.longPress(press.last);
        if (drag) press.drag = drag;
      }, LONG_PRESS_MS);
    }
  };

  const onMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = point(e);
    pointers.set(e.pointerId, p);
    if (pinch) {
      const a = pointers.get(pinch.ids[0]);
      const b = pointers.get(pinch.ids[1]);
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      target.pan(mid.x - pinch.mid.x, mid.y - pinch.mid.y);
      if (pinch.distance > 0 && distance > 0) target.zoom(distance / pinch.distance, mid.x, mid.y);
      pinch = { ...pinch, distance, mid };
      return;
    }
    if (!press || press.id !== e.pointerId || ignored.has(e.pointerId)) return;
    const previous = press.last;
    press.last = p;
    if (!press.moved && Math.hypot(p.x - press.start.x, p.y - press.start.y) > slop(p)) {
      press.moved = true;
      window.clearTimeout(press.timer);
      if (!press.drag && !press.panOnly) {
        press.drag = target.dragStart(press.start, p);
        press.panning = !press.drag;
      }
    }
    if (press.drag) press.drag.move(p);
    else if (press.panning && press.moved) target.pan(p.x - previous.x, p.y - previous.y);
  };

  const onUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = point(e);
    pointers.delete(e.pointerId);
    if (ignored.delete(e.pointerId)) return;
    if (pinch) {
      if (pinch.ids.includes(e.pointerId)) {
        pinch = null;
        for (const id of pointers.keys()) ignored.add(id);
      }
      return;
    }
    if (!press || press.id !== e.pointerId) return;
    const current = press;
    if (current.drag) {
      endPress('end', p);
      return;
    }
    endPress('cancel');
    if (current.moved || current.panOnly) return;
    const now = performance.now();
    if (lastTap && now - lastTap.time < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < DOUBLE_TAP_PX) {
      lastTap = null;
      target.doubleTap(p);
    } else {
      lastTap = { time: now, x: p.x, y: p.y };
      target.tap(p);
    }
  };

  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    ignored.delete(e.pointerId);
    if (pinch?.ids.includes(e.pointerId)) pinch = null;
    if (press?.id === e.pointerId) endPress('cancel');
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // Trackpad pinch arrives as ctrl+wheel with small deltas.
    const factor = Math.exp(-e.deltaY * lines * (e.ctrlKey ? 0.01 : 0.0015));
    target.zoom(factor, e.clientX - rect.left, e.clientY - rect.top);
  };

  const onContextMenu = (e: Event) => e.preventDefault();
  // Pointer events still arrive, but the browser's own touch gestures don't run on the canvas.
  // Otherwise Chrome treats a long press (used to lift a tile) as its own gesture and swallows
  // the click of the next tap anywhere on the page, e.g. on Undo.
  const onTouchStart = (e: TouchEvent) => e.preventDefault();

  el.addEventListener('touchstart', onTouchStart, { passive: false });
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', onContextMenu);
  return () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('contextmenu', onContextMenu);
  };
}
