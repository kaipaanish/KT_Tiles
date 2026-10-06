/**
 * Which of a scene model's classes count as wall, floor and ceiling. Pure, no DOM.
 *
 * Classes are found by name in the model's own label list, so another model trained on the
 * same labels (ADE20K) works without changing ids.
 */
import type { ClassProbabilities } from './segmenter';

export interface ClassGroups {
  wall: number[];
  floor: number[];
  ceiling: number[];
}

/**
 * Label names for each group. A rug lies on the floor and is usually lifted for tiling, so it
 * counts as floor; everything else (fixtures, furniture, mirrors, doors) stays in front of the tiles.
 */
export const GROUP_NAMES: Readonly<Record<keyof ClassGroups, readonly string[]>> = {
  wall: ['wall'],
  floor: ['floor', 'rug'],
  ceiling: ['ceiling'],
};

/** "rug;carpet;carpeting" → ["rug", "carpet", "carpeting"]. */
function names(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[;,]/)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Finds each group's class ids in a model's id → label map. Throws if the model has no wall or floor class. */
export function classGroups(id2label: Readonly<Record<string, string>>): ClassGroups {
  const groups: ClassGroups = { wall: [], floor: [], ceiling: [] };
  for (const [id, label] of Object.entries(id2label)) {
    const labelNames = names(label);
    for (const group of Object.keys(groups) as (keyof ClassGroups)[]) {
      if (GROUP_NAMES[group].some((name) => labelNames.includes(name))) groups[group].push(Number(id));
    }
  }
  for (const ids of [groups.wall, groups.floor, groups.ceiling]) ids.sort((a, b) => a - b);
  if (groups.wall.length === 0 || groups.floor.length === 0) throw new Error('The segmentation model has no wall or floor class');
  return groups;
}

/**
 * Turns a model's scores (logits, laid out class by class: [classes][height][width]) into
 * wall, floor and ceiling probabilities: a softmax over all classes at each pixel, summed per group.
 */
export function groupProbabilities(logits: Float32Array, classes: number, width: number, height: number, groups: ClassGroups): ClassProbabilities {
  const n = width * height;
  if (logits.length !== classes * n) throw new Error(`Expected ${classes * n} scores, got ${logits.length}`);
  const out: ClassProbabilities = { width, height, wall: new Float32Array(n), floor: new Float32Array(n), ceiling: new Float32Array(n) };
  const exp = new Float64Array(classes);
  for (let i = 0; i < n; i++) {
    let max = -Infinity;
    for (let k = 0; k < classes; k++) max = Math.max(max, logits[k * n + i]!);
    let sum = 0;
    for (let k = 0; k < classes; k++) {
      const e = Math.exp(logits[k * n + i]! - max);
      exp[k] = e;
      sum += e;
    }
    for (const group of ['wall', 'floor', 'ceiling'] as const) {
      let p = 0;
      for (const k of groups[group]) p += exp[k]!;
      out[group][i] = p / sum;
    }
  }
  return out;
}
