import { describe, expect, it } from 'vitest';
import { inputSize, pixelValues } from './segformer';

describe('SegFormer input', () => {
  it("keeps the photo's shape at about 640 px, in multiples of 32", () => {
    expect(inputSize(1024, 768)).toEqual({ width: 640, height: 480 });
    expect(inputSize(768, 1024)).toEqual({ width: 480, height: 640 });
    expect(inputSize(2048, 1152)).toEqual({ width: 640, height: 352 });
    expect(inputSize(4000, 100)).toEqual({ width: 640, height: 32 });
  });

  it('normalises each channel with the ImageNet mean and deviation, plane by plane', () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    const values = pixelValues({ width: 2, height: 1, data });
    // Planes: red (white, black), green (...), blue (...).
    expect(values[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(values[1]).toBeCloseTo(-0.485 / 0.229, 5);
    expect(values[2]).toBeCloseTo((1 - 0.456) / 0.224, 5);
    expect(values[5]).toBeCloseTo(-0.406 / 0.225, 5);
  });
});
