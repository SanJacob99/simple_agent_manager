import { describe, expect, it } from 'vitest';
import { snapNodePositionToHoneycomb, snapToHexCenter } from './hex-snap';
import { HEX_HEIGHT, HEX_SIDE, HEX_WIDTH } from '../nodes/HexNode';

const SQRT3 = Math.sqrt(3);
const HEX_W = SQRT3 * HEX_SIDE;
const ROW = 1.5 * HEX_SIDE;
const EPSILON = 1e-6;

function approxEqual(a: number, b: number) {
  return Math.abs(a - b) < EPSILON;
}

describe('snapToHexCenter', () => {
  it('keeps an exact hex center unchanged', () => {
    const result = snapToHexCenter(0, 0);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('snaps a point just off center to the same hex', () => {
    const result = snapToHexCenter(1, 1);
    expect(approxEqual(result.x, 0)).toBe(true);
    expect(approxEqual(result.y, 0)).toBe(true);
  });

  it('snaps to the east neighbor on the same row', () => {
    const result = snapToHexCenter(HEX_W, 0);
    expect(approxEqual(result.x, HEX_W)).toBe(true);
    expect(approxEqual(result.y, 0)).toBe(true);
  });

  it('snaps to the staggered row one cell down', () => {
    const result = snapToHexCenter(HEX_W / 2, ROW);
    expect(approxEqual(result.x, HEX_W / 2)).toBe(true);
    expect(approxEqual(result.y, ROW)).toBe(true);
  });

  it('handles negative coordinates', () => {
    const result = snapToHexCenter(-HEX_W, 0);
    expect(approxEqual(result.x, -HEX_W)).toBe(true);
    expect(approxEqual(result.y, 0)).toBe(true);
  });

  it('rounds near-boundary points to the nearest center', () => {
    const result = snapToHexCenter(HEX_W * 0.9, 0);
    expect(approxEqual(result.x, HEX_W)).toBe(true);
    expect(approxEqual(result.y, 0)).toBe(true);
  });
});

describe('snapNodePositionToHoneycomb', () => {
  it('aligns node visual center with a hex center (not its top-left)', () => {
    const topLeft = { x: -HEX_WIDTH / 2, y: -HEX_HEIGHT / 2 };
    const result = snapNodePositionToHoneycomb(topLeft);
    expect(approxEqual(result.x, -HEX_WIDTH / 2)).toBe(true);
    expect(approxEqual(result.y, -HEX_HEIGHT / 2)).toBe(true);
  });

  it('snaps an arbitrary top-left so the centered node sits in a cell', () => {
    const topLeft = { x: 5, y: 5 };
    const snapped = snapNodePositionToHoneycomb(topLeft);
    const centerX = snapped.x + HEX_WIDTH / 2;
    const centerY = snapped.y + HEX_HEIGHT / 2;
    const hex = snapToHexCenter(centerX, centerY);
    expect(approxEqual(hex.x, centerX)).toBe(true);
    expect(approxEqual(hex.y, centerY)).toBe(true);
  });

  it('snaps negative top-left coordinates correctly', () => {
    const topLeft = { x: -1000, y: -1000 };
    const snapped = snapNodePositionToHoneycomb(topLeft);
    const centerX = snapped.x + HEX_WIDTH / 2;
    const centerY = snapped.y + HEX_HEIGHT / 2;
    const hex = snapToHexCenter(centerX, centerY);
    expect(approxEqual(hex.x, centerX)).toBe(true);
    expect(approxEqual(hex.y, centerY)).toBe(true);
  });
});
