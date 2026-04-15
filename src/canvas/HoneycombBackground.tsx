import { useStore } from '@xyflow/react';
import { HEX_CORNER_RADIUS, roundedHexPathPointyTop } from '../nodes/HexNode';

type Props = {
  side?: number;
  color?: string;
  bgColor?: string;
  gutter?: number;
};

const transformSelector = (s: { transform: [number, number, number] }) => s.transform;

export default function HoneycombBackground({
  side = 14,
  color,
  bgColor,
  gutter = 2,
}: Props) {
  const [tx, ty, zoom] = useStore(transformSelector);

  const ss = side * zoom;
  const w = Math.sqrt(3) * ss;
  const h = 3 * ss;
  const halfW = w / 2;
  const inset = (gutter * zoom) / 2;
  const hexSide = Math.max(0, ss - inset);
  const radius = Math.max(0, HEX_CORNER_RADIUS * zoom - inset);

  const hexCenters: Array<[number, number]> = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
    [halfW, h / 2],
  ];

  const patternId = 'honeycomb-pattern';

  return (
    <svg
      className="react-flow__background"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <pattern
        id={patternId}
        x={tx % w}
        y={ty % h}
        width={w}
        height={h}
        patternUnits="userSpaceOnUse"
      >
        <rect width={w} height={h} fill={color} />
        {hexCenters.map(([cx, cy], i) => (
          <path
            key={i}
            d={roundedHexPathPointyTop(cx, cy, hexSide, radius)}
            fill={bgColor}
          />
        ))}
      </pattern>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
