import { describe, expect, it } from 'vitest';
import { invertPose, kindOf, multiply, surfaceFrame, surfaceToRoom, transformPoint, type Vec3 } from './surfaceFrame';

/** A pose (column-major) with the given axes and position, as a WebXR hit test gives: y along the normal. */
const pose = (x: Vec3, y: Vec3, z: Vec3, at: Vec3) => Float32Array.from([...x, 0, ...y, 0, ...z, 0, ...at, 1]);
const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 6));
const viewer: Vec3 = [0, 1.5, 0];

describe('a surface found in AR', () => {
  it('tells walls, floors, ceilings and slopes apart by their normal', () => {
    expect(kindOf([0, 0, 1])).toBe('wall');
    expect(kindOf([0, 1, 0])).toBe('floor');
    expect(kindOf([0, -1, 0])).toBe('ceiling');
    const tilt = (deg: number): Vec3 => [0, Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)];
    expect(kindOf(tilt(15))).toBe('wall');
    expect(kindOf(tilt(45))).toBe('slope');
    expect(kindOf(tilt(70))).toBe('floor');
  });

  it("on a wall, puts the designer's up along the room's up and right to the viewer's right", () => {
    // A wall 2 m ahead, facing the viewer; the hit's other axes turned arbitrarily about the normal.
    const c = Math.cos(0.7);
    const s = Math.sin(0.7);
    const frame = surfaceFrame(pose([c, s, 0], [0, 0, 1], [-s, c, 0], [0.3, 1.2, -2]), viewer);
    expect(frame.kind).toBe('wall');
    close(frame.up, [0, 1, 0]);
    close(frame.right, [1, 0, 0]);
    close(frame.normal, [0, 0, 1]);
    close(frame.origin, [0.3, 1.2, -2]);
  });

  it('keeps walls plumb and floors level, whatever tilt the estimate has', () => {
    // A wall estimate leaning 8° back, and a floor estimate tilted 6°.
    const lean = (8 * Math.PI) / 180;
    const wall = surfaceFrame(pose([1, 0, 0], [0, Math.sin(lean), Math.cos(lean)], [0, -Math.cos(lean), Math.sin(lean)], [0, 1.2, -2]), viewer);
    expect(wall.kind).toBe('wall');
    close(wall.normal, [0, 0, 1]);
    close(wall.up, [0, 1, 0]);
    const tilt = (6 * Math.PI) / 180;
    const floor = surfaceFrame(pose([1, 0, 0], [Math.sin(tilt), Math.cos(tilt), 0], [0, 0, 1], [0, 0, -2]), viewer);
    close(floor.normal, [0, 1, 0]);
  });

  it('turns a normal pointing into the wall to face the viewer', () => {
    const frame = surfaceFrame(pose([1, 0, 0], [0, 0, -1], [0, 1, 0], [0, 1.2, -2]), viewer);
    close(frame.normal, [0, 0, 1]);
    close(frame.right, [1, 0, 0]);
  });

  it("on a floor, runs the designer's up away from the viewer", () => {
    const frame = surfaceFrame(pose([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -2]), viewer);
    expect(frame.kind).toBe('floor');
    close(frame.up, [0, 0, -1]);
    close(frame.right, [1, 0, 0]);
    // Off to the side: up still points away from the viewer, along the floor.
    const side = surfaceFrame(pose([1, 0, 0], [0, 1, 0], [0, 0, 1], [2, 0, 0]), viewer);
    close(side.up, [1, 0, 0]);
    close(side.right, [0, 0, 1]);
  });

  it('maps surface millimetres into the room in metres', () => {
    const frame = surfaceFrame(pose([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, 1.2, -2]), viewer);
    // A 1 m square centred on the hit.
    const model = surfaceToRoom(frame, { x: 500, y: 500 });
    close(transformPoint(model, [500, 500, 0]), [0, 1.2, -2]);
    close(transformPoint(model, [0, 0, 0]), [-0.5, 0.7, -2]);
    close(transformPoint(model, [1000, 1000, 0]), [0.5, 1.7, -2]);
  });

  it('keeps a placement with its anchor: the pose inverted, then again as the anchor moves', () => {
    const hit = pose([1, 0, 0], [0, 0, 1], [0, -1, 0], [0, 1.2, -2]);
    const model = surfaceToRoom(surfaceFrame(hit, viewer), { x: 500, y: 500 });
    const local = multiply(invertPose(hit), model);
    // Unmoved, the anchor gives the same placement.
    Array.from(multiply(hit, local)).forEach((v, i) => expect(v).toBeCloseTo(model[i]!, 6));
    // Tracking nudges the anchor 2 cm to the right: the tiles go with it.
    const moved = pose([1, 0, 0], [0, 0, 1], [0, -1, 0], [0.02, 1.2, -2]);
    close(transformPoint(multiply(moved, local), [500, 500, 0]), [0.02, 1.2, -2]);
  });
});
