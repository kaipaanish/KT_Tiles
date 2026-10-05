import { EPS } from './math';
import type { Rotation, Tile } from './types';

type Size = Pick<Tile, 'widthMm' | 'heightMm'>;

const QUARTER_TURNS: readonly Rotation[] = [0, 90, 180, 270];
const HALF_TURNS: readonly Rotation[] = [0, 180];

/**
 * A printed tile can turn but never flip. Square tiles turn in quarter turns; a
 * rectangle only turns half way, or it would no longer fit the grid.
 */
export function allowedRotations(tile: Size): readonly Rotation[] {
  return Math.abs(tile.widthMm - tile.heightMm) < EPS ? QUARTER_TURNS : HALF_TURNS;
}

export function isRotationAllowed(tile: Size, rotation: number): rotation is Rotation {
  return (allowedRotations(tile) as readonly number[]).includes(rotation);
}

/** The next allowed rotation, clockwise. An invalid current rotation goes back to 0. */
export function nextRotation(tile: Size, current: Rotation): Rotation {
  const options = allowedRotations(tile);
  return options[(options.indexOf(current) + 1) % options.length] ?? 0;
}
