import { describe, expect, it } from 'vitest';
import { classGroups, groupProbabilities } from './classes';

// A slice of the ADE20K label list as the model's config.json has it (note the trailing space).
const ADE = { '0': 'wall', '3': 'floor', '5': 'ceiling', '7': 'bed ', '27': 'mirror', '28': 'rug', '65': 'toilet' };

describe('classGroups', () => {
  it('finds wall, floor (with rugs) and ceiling by name', () => {
    expect(classGroups(ADE)).toEqual({ wall: [0], floor: [3, 28], ceiling: [5] });
  });

  it('reads labels that list several names', () => {
    expect(classGroups({ '0': 'Wall;walls', '1': 'floor, flooring', '2': 'rug;carpet;carpeting' })).toEqual({ wall: [0], floor: [1, 2], ceiling: [] });
  });

  it('rejects a model without wall or floor classes', () => {
    expect(() => classGroups({ '0': 'sky', '1': 'floor' })).toThrow(/no wall or floor/);
  });
});

describe('groupProbabilities', () => {
  const groups = { wall: [0], floor: [1, 3], ceiling: [2] };

  it('applies a softmax over every class and sums each group', () => {
    // Two pixels, five classes, laid out class by class.
    const logits = new Float32Array([
      Math.log(4), 0, // wall
      Math.log(2), 0, // floor
      0, Math.log(6), // ceiling
      Math.log(1), 0, // floor (rug)
      Math.log(1), Math.log(2), // other
    ]);
    const p = groupProbabilities(logits, 5, 2, 1, groups);
    // Pixel 0: exp = 4, 2, 1, 1, 1 (sum 9). Pixel 1: 1, 1, 6, 1, 2 (sum 11).
    expect(p.wall[0]).toBeCloseTo(4 / 9, 6);
    expect(p.floor[0]).toBeCloseTo(3 / 9, 6);
    expect(p.ceiling[0]).toBeCloseTo(1 / 9, 6);
    expect(p.wall[1]).toBeCloseTo(1 / 11, 6);
    expect(p.floor[1]).toBeCloseTo(2 / 11, 6);
    expect(p.ceiling[1]).toBeCloseTo(6 / 11, 6);
  });

  it('stays finite for very large scores', () => {
    const logits = new Float32Array([1000, 0, 0, 0, 999]);
    const p = groupProbabilities(logits, 5, 1, 1, groups);
    expect(p.wall[0]).toBeCloseTo(Math.E / (Math.E + 1), 5);
    expect(Number.isFinite(p.floor[0])).toBe(true);
  });

  it('checks the size of the scores', () => {
    expect(() => groupProbabilities(new Float32Array(9), 5, 2, 1, groups)).toThrow(/Expected 10/);
  });
});
