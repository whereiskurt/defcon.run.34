import clsx from 'clsx';
import { FC, ReactNode } from 'react';

interface RainbowTextProps {
  text: string;
  className?: string;
}

const RainbowText: FC<RainbowTextProps> = ({ text, className }) => {
  const colors = [
    'text-red-500',
    'text-orange-500',
    'text-yellow-500',
    'text-green-500',
    'text-blue-500',
    'text-indigo-500',
    'text-purple-500',
  ];

  return (
    <span className={className}>
      {Array.from(text).map((letter, index) => (
        <span
          key={index}
          className={clsx(colors[index % colors.length])}
        >
          {letter}
        </span>
      ))}
    </span>
  );
};

export default RainbowText;