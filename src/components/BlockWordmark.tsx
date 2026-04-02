'use client';

import { useId, useMemo } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

type BlockWordmarkProps = {
  text: string;
  className?: string;
  cellColor?: string;
  duration?: number;
};

type Cell = {
  id: string;
  x: number;
  y: number;
};

const LETTERS = [
  {
    x: 0,
    cells: [
      [0, 0], [8, 0], [16, 0], [24, 0], [32, 0],
      [16, 16], [16, 32], [16, 48], [16, 64],
      [0, 80], [16, 80],
      [8, 96], [16, 96],
    ],
  },
  {
    x: 56,
    cells: [
      [0, 0], [32, 0], [0, 16], [32, 16], [0, 32], [32, 32], [0, 48], [32, 48],
      [0, 64], [32, 64], [0, 80], [32, 80], [8, 96], [16, 96], [24, 96],
    ],
  },
  {
    x: 112,
    cells: [
      [0, 0], [8, 0], [16, 0], [24, 0],
      [0, 16], [32, 16], [0, 32], [32, 32], [0, 48], [32, 48], [0, 64], [32, 64], [0, 80], [32, 80],
      [0, 96], [8, 96], [16, 96], [24, 96],
    ],
  },
  {
    x: 168,
    cells: [
      [8, 0], [16, 0], [24, 0], [32, 0],
      [0, 16], [0, 32],
      [0, 48], [16, 48], [24, 48], [32, 48],
      [0, 64], [32, 64], [0, 80], [32, 80],
      [8, 96], [16, 96], [24, 96], [32, 96],
    ],
  },
  {
    x: 224,
    cells: [
      [0, 0], [8, 0], [16, 0], [24, 0], [32, 0],
      [16, 16], [16, 32], [16, 48], [16, 64], [16, 80],
      [0, 96], [8, 96], [16, 96], [24, 96], [32, 96],
    ],
  },
  {
    x: 280,
    cells: [
      [0, 0], [32, 0],
      [0, 16], [8, 16], [32, 16],
      [0, 32], [16, 32], [32, 32],
      [0, 48], [24, 48], [32, 48],
      [0, 64], [32, 64], [0, 80], [32, 80], [0, 96], [32, 96],
    ],
  },
  {
    x: 336,
    cells: [
      [8, 0], [16, 0], [24, 0], [32, 0],
      [0, 16], [0, 32],
      [0, 48], [16, 48], [24, 48], [32, 48],
      [0, 64], [32, 64], [0, 80], [32, 80],
      [8, 96], [16, 96], [24, 96], [32, 96],
    ],
  },
] as const;

export default function BlockWordmark({
  text,
  className,
  cellColor = '#000000',
  duration = 0.42,
}: BlockWordmarkProps) {
  const cellId = useId().replace(/:/g, '');

  const cells = useMemo<Cell[]>(() => {
    return LETTERS.flatMap((letter, letterIndex) =>
      letter.cells.map(([x, y], cellIndex) => ({
        id: `${letterIndex}-${cellIndex}`,
        x: letter.x + x,
        y,
      }))
    );
  }, []);

  const maxX = Math.max(...cells.map(cell => cell.x), 0);

  return (
    <svg
      width="408"
      height="136"
      viewBox="0 0 408 136"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('mx-auto block h-auto w-full', className)}
      role="img"
      aria-label={text}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <path
          id={cellId}
          fill={cellColor}
          d="M-4.5,-5C-4.5,-5.552 -4.052,-6 -3.5,-6H4.5V6H-3.5C-4.052,6 -4.5,5.552 -4.5,5V-5Z"
        />
      </defs>

      <g id="JUDGING" transform="translate(20,20)">
        {cells.map(cell => (
          <motion.g
            key={cell.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{
              duration,
              delay: (cell.x / Math.max(maxX, 1)) * 0.8,
              ease: 'easeOut',
            }}
          >
            <use href={`#${cellId}`} x={cell.x} y={cell.y} />
          </motion.g>
        ))}
      </g>
    </svg>
  );
}
