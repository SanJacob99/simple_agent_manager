import { useStore } from '@xyflow/react';
import { HEX_CORNER_RADIUS, roundedHexPathPointyTop } from '../nodes/HexNode';

type Props = {
  side?: number;
  color?: string;
  strokeWidth?: number;
};

const transformSelector = (s: { transform: [number, number, number] }) => s.transform;

export default function HoneycombBackground({
  side = 14,
  color,
  strokeWidth = 1,
}: Props) {
  const [tx, ty, zoom] = useStore(transformSelector);

  const ss = side * zoom;
  const w = Math.sqrt(3) * ss;
  const h = 3 * ss;
  const halfW = w / 2;
  const radius = HEX_CORNER_RADIUS * zoom;

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
        {hexCenters.map(([cx, cy], i) => (
          <path
            key={i}
            d={roundedHexPathPointyTop(cx, cy, ss, radius)}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
          />
        ))}
      </pattern>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
