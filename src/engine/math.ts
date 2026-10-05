/** Tolerance for comparing millimetre values. */
export const EPS = 1e-6;

/** Modulo that is never negative. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) [x, y] = [y, x % y];
  return x;
}

export function lcm(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : Math.abs(a * b) / gcd(a, b);
}

/** Removes floating-point noise, so 24.9999999 becomes 25 (and -0 becomes 0). */
export function clean(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** The value congruent to v modulo period that lies in (-period, 0]. */
export function canonicalOffset(v: number, period: number): number {
  return clean(v - period * Math.ceil(v / period - 1e-9));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Millimetres for messages: "25", "24.5". */
export function formatMm(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
