import type { XYPosition } from '@xyflow/react';
import { HEX_HEIGHT, HEX_SIDE, HEX_WIDTH } from '../nodes/HexNode';

const SQRT3 = Math.sqrt(3);

export interface Axial {
  q: number;
  r: number;
}

const HEX_DIRECTIONS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function axialRound(qf: number, rf: number): Axial {
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;

  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);

  const xDiff = Math.abs(rx - xf);
  const yDiff = Math.abs(ry - yf);
  const zDiff = Math.abs(rz - zf);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

export function pixelToAxial(x: number, y: number, side = HEX_SIDE): Axial {
  const qf = ((SQRT3 / 3) * x - (1 / 3) * y) / side;
  const rf = ((2 / 3) * y) / side;
  return axialRound(qf, rf);
}

export function axialToPixel({ q, r }: Axial, side = HEX_SIDE): XYPosition {
  return {
    x: side * (SQRT3 * q + (SQRT3 / 2) * r),
    y: side * (1.5 * r),
  };
}

export function axialKey(cell: Axial): string {
  return `${cell.q},${cell.r}`;
}

export function snapToHexCenter(
  x: number,
  y: number,
  side = HEX_SIDE,
): XYPosition {
  return axialToPixel(pixelToAxial(x, y, side), side);
}

export function snapNodePositionToHoneycomb(position: XYPosition): XYPosition {
  const center = snapToHexCenter(
    position.x + HEX_WIDTH / 2,
    position.y + HEX_HEIGHT / 2,
  );
  return {
    x: center.x - HEX_WIDTH / 2,
    y: center.y - HEX_HEIGHT / 2,
  };
}

function* hexRing(center: Axial, radius: number): Generator<Axial> {
  if (radius === 0) {
    yield center;
    return;
  }
  let current: Axial = {
    q: center.q + HEX_DIRECTIONS[4].q * radius,
    r: center.r + HEX_DIRECTIONS[4].r * radius,
  };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      yield current;
      current = {
        q: current.q + HEX_DIRECTIONS[side].q,
        r: current.r + HEX_DIRECTIONS[side].r,
      };
    }
  }
}

export function findNearestFreeCell(
  target: Axial,
  occupied: ReadonlySet<string>,
  maxRadius = 32,
): Axial {
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (const cell of hexRing(target, radius)) {
      if (!occupied.has(axialKey(cell))) return cell;
    }
  }
  return target;
}

export function nodeTopLeftToAxial(position: XYPosition): Axial {
  return pixelToAxial(
    position.x + HEX_WIDTH / 2,
    position.y + HEX_HEIGHT / 2,
  );
}

export function axialToNodeTopLeft(cell: Axial): XYPosition {
  const center = axialToPixel(cell);
  return {
    x: center.x - HEX_WIDTH / 2,
    y: center.y - HEX_HEIGHT / 2,
  };
}

export function snapNodePositionToFreeCell(
  position: XYPosition,
  occupied: ReadonlySet<string>,
): { position: XYPosition; cell: Axial } {
  const target = nodeTopLeftToAxial(position);
  const cell = findNearestFreeCell(target, occupied);
  return { position: axialToNodeTopLeft(cell), cell };
}

export function buildOccupiedCellSet(
  nodes: ReadonlyArray<{ id: string; position: XYPosition }>,
  excludeId?: string,
): Set<string> {
  const set = new Set<string>();
  for (const node of nodes) {
    if (node.id === excludeId) continue;
    set.add(axialKey(nodeTopLeftToAxial(node.position)));
  }
  return set;
}
