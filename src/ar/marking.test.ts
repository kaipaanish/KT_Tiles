import { describe, expect, it } from 'vitest';
import { floorFromCorners, intersectPlane, onFrame, poseRay, surfaceMm, wallFromBase, wallFromCorners, wallUpTo } from './marking';
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
