import { describe, expect, it } from 'vitest';
import { cornersMm, floorFromCorners, intersectPlane, moveCorner, nearestCorner, onFrame, poseRay, steadyAim, surfaceMm, wallFromBase, wallFromCorners, wallUpTo } from './marking';
import { surfaceFrame, surfaceToRoom, transformPoint, type Vec3 } from './surfaceFrame';

const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
const viewer: Vec3 = [0, 1.5, 0];
/** A hit on a wall 2 m ahead (facing the viewer) at a point: WebXR's pose, y along the normal. */
const wallHit = (x: number, y: number) => Float32Array.from([1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, x, y, -2, 1]);

describe('rays', () => {
  it("runs along a pose's −z axis and meets planes ahead of it only", () => {
    // The viewer looking straight ahead (−z), from 1.5 m up.
    const ray = poseRay(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 0, 1]));
    close(ray.direction, [0, 0, -1]);
    close(intersectPlane(ray, [0, 0, -2], [0, 0, 1])!, [0, 1.5, -2]);
    expect(intersectPlane(ray, [0, 0, 2], [0, 0, 1])).toBeNull();
    expect(intersectPlane(ray, [0, 0, 0], [0, 1, 0])).toBeNull();
  });
});

describe('marking a wall by two corners', () => {
  const first = surfaceFrame(wallHit(-1, 0.1), viewer);

  it('measures the rectangle between them and puts its origin at the bottom-left', () => {
    const wall = wallFromCorners(first, [1.4, 2.8, -2])!;
    expect(wall.widthMm).toBe(2400);
    expect(wall.heightMm).toBe(2700);
    close(wall.frame.origin, [-1, 0.1, -2]);
    // Surface mm map back onto the room where the corners were.
    const model = surfaceToRoom(wall.frame, { x: 0, y: 0 });
    close(transformPoint(model, [2400, 2700, 0]), [1.4, 2.8, -2]);
  });

  it('takes the corners in either order and either diagonal', () => {
    const topLeft = surfaceFrame(wallHit(-1, 2.8), viewer);
    const wall = wallFromCorners(topLeft, [1.4, 0.1, -2])!;
    expect([wall.widthMm, wall.heightMm]).toEqual([2400, 2700]);
    close(wall.frame.origin, [-1, 0.1, -2]);
  });

  it('ignores a slip of the finger', () => {
    expect(wallFromCorners(first, [-0.97, 0.15, -2])).toBeNull();
  });
});

describe('marking a floor by three points', () => {
  it('runs right along the first edge and up towards the third point', () => {
    // Along a wall's base 2 m ahead, then 1.5 m back towards the viewer.
    const floor = floorFromCorners([-1, 0, -2], [1, 0, -2], [0.3, 0, -0.5], [0, 1, 0])!;
    expect([floor.widthMm, floor.heightMm]).toEqual([2000, 1500]);
    close(floor.frame.up, [0, 0, 1]);
    close(floor.frame.right, [-1, 0, 0]);
    // The origin is the bottom-left corner in that frame: the first edge's right-hand end, seen from the viewer.
    close(floor.frame.origin, [1, 0, -2]);
    expect(floor.frame.kind).toBe('floor');
  });
});

describe('marking a plain wall by its base', () => {
  it('stands a wall up along the floor line, facing the viewer, then measures its height', () => {
    const base = wallFromBase([1, 0, -2], [-1.2, 0, -2], viewer)!;
    expect(base.widthMm).toBe(2200);
    close(base.frame.normal, [0, 0, 1]);
    close(base.frame.right, [1, 0, 0]);
    close(base.frame.origin, [-1.2, 0, -2]);
    const wall = wallUpTo(base, [0, 2.6, -2])!;
    expect([wall.widthMm, wall.heightMm]).toEqual([2200, 2600]);
    expect(wallUpTo(base, [0, 0.05, -2])).toBeNull();
  });
});

describe('dragging on a surface', () => {
  it('finds where a touch ray meets the surface, in its millimetres', () => {
    const wall = wallFromCorners(surfaceFrame(wallHit(-1, 0.1), viewer), [1.4, 2.8, -2])!;
    const ray = { origin: viewer, direction: [0, 0, -1] as Vec3 };
    const at = surfaceMm(ray, wall.frame)!;
    // Poses come as 32-bit floats: a micrometre is close enough.
    expect(at.x).toBeCloseTo(1000, 3);
    expect(at.y).toBeCloseTo(1400, 3);
    const origin = onFrame(wall.frame, [-1, 0.1, -2]);
    expect(origin.x).toBeCloseTo(0, 6);
    expect(origin.y).toBeCloseTo(0, 6);
  });
});

describe('steadier taps', () => {
  it('takes the aim from just before the tap, not the jolt as the finger lands', () => {
    // Steady at x = 0.5 until 60 ms before the tap, then the jolt.
    const samples = [0, 33, 66, 100, 133, 166, 200, 233, 266, 300, 333, 366, 400].map((t) => ({ t, p: (t > 340 ? [0.58, 1.5, -2] : [0.5, 1.5, -2]) as Vec3 }));
    close(steadyAim(samples, 400)!, [0.5, 1.5, -2]);
    // Held still with a little tremble: the average.
    const trembling = [100, 133, 166, 200, 233, 266, 300].map((t, i) => ({ t, p: [0.5 + (i % 2 ? 0.004 : -0.004), 1.5, -2] as Vec3 }));
    close(steadyAim(trembling, 400)!, [0.5 - 0.004 / 7, 1.5, -2]);
    // No samples before the tap: no steady aim (the caller takes the latest).
    expect(steadyAim(samples.slice(-2), 400)).toBeNull();
  });

  it('takes the last aim before the jolt when the phone was still moving', () => {
    // Swinging 5 cm a frame towards x = 0.8 until just before the tap.
    const moving = [100, 133, 166, 200, 233, 266, 300].map((t, i) => ({ t, p: [0.5 + i * 0.05, 1.5, -2] as Vec3 }));
    close(steadyAim(moving, 400)!, [0.8, 1.5, -2]);
  });
});

describe('adjusting a marked surface by its corners', () => {
  const wall = wallFromCorners(surfaceFrame(wallHit(-1, 0.1), viewer), [1.4, 2.8, -2])!;

  it('finds the corner near a touch', () => {
    expect(nearestCorner(wall, { x: 2380, y: 2690 }, 150)).toBe(2);
    expect(nearestCorner(wall, { x: 30, y: -20 }, 150)).toBe(0);
    expect(nearestCorner(wall, { x: 1200, y: 1350 }, 150)).toBeNull();
  });

  it('moves one corner and keeps the opposite one', () => {
    // The top-right corner 100 mm in and 200 mm down.
    const smaller = moveCorner(wall, 2, { x: 2300, y: 2500 })!;
    expect([smaller.widthMm, smaller.heightMm]).toEqual([2300, 2500]);
    close(smaller.frame.origin, wall.frame.origin);
    // The bottom-left corner 50 mm left and 100 mm up: the origin moves with it.
    const moved = moveCorner(wall, 0, { x: -50, y: 100 })!;
    expect([moved.widthMm, moved.heightMm]).toEqual([2450, 2600]);
    close(moved.frame.origin, [-1.05, 0.2, -2]);
    expect(cornersMm(moved)[2]).toEqual({ x: 2450, y: 2600 });
    expect(moveCorner(wall, 2, { x: 50, y: 2700 })).toBeNull();
  });
});
