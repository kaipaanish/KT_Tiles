import { describe, expect, it } from 'vitest';
import type { BrushStroke } from '../state/document';
import { applyStrokes } from './brush';
import { emptyMask, type Mask } from './maskToQuad';

// A working-size mask of 100 × 80 for a 200 × 160 photo: photo pixels are halved.
const photo = { width: 200, height: 160 };
const full = (): Mask => ({ width: 100, height: 80, data: new Uint8Array(8000).fill(1) });
const at = (mask: Mask, x: number, y: number) => mask.data[y * mask.width + x];
let nextId = 1;
const stroke = (mode: BrushStroke['mode'], radius: number, ...points: [number, number][]): BrushStroke => ({ id: nextId++, mode, radius, points: points.map(([x, y]) => ({ x, y })) });

describe('brush strokes', () => {
  it('add a dot to the region, scaled to the working size', () => {
    const mask = applyStrokes(emptyMask(100, 80), [stroke('add', 10, [100, 100])], photo);
    // Radius 10 photo px = 5 working px, centred on (50, 50).
    expect(at(mask, 50, 50)).toBe(1);
    expect(at(mask, 53, 50)).toBe(1);
    expect(at(mask, 56, 50)).toBe(0);
  });

  it('take a line out of the region, along the whole path', () => {
    const mask = applyStrokes(full(), [stroke('remove', 4, [0, 100], [120, 100], [120, 20])], photo);
    for (const x of [0, 30, 59]) expect(at(mask, x, 50)).toBe(0);
    for (const y of [12, 30, 49]) expect(at(mask, 60, y)).toBe(0);
    expect(at(mask, 30, 60)).toBe(1);
    expect(at(mask, 80, 50)).toBe(1);
  });

  it('apply in order, so the last stroke wins', () => {
    const removeThenAdd = applyStrokes(full(), [stroke('remove', 8, [100, 80]), stroke('add', 4, [100, 80])], photo);
    expect(at(removeThenAdd, 50, 40)).toBe(1);
    expect(at(removeThenAdd, 53, 40)).toBe(0);
    const addThenRemove = applyStrokes(emptyMask(100, 80), [stroke('add', 8, [100, 80]), stroke('remove', 8, [100, 80])], photo);
    expect([...addThenRemove.data].every((v) => v === 0)).toBe(true);
  });

  it('leave the region itself untouched', () => {
    const region = full();
    applyStrokes(region, [stroke('remove', 20, [100, 80])], photo);
    expect([...region.data].every((v) => v === 1)).toBe(true);
  });
});
