import { FC, ReactNode } from 'react';
import clsx from 'clsx';

interface GlitchLabelProps {
  children: ReactNode;
  className?: string;
}

const GlitchLabel: FC<GlitchLabelProps> = ({ children, className }) => {
  return (
    <span 
      className={clsx(
        'relative inline-block',
        'after:content-[attr(data-content)] after:absolute after:top-0 after:left-0 after:text-blue-400 after:animate-glitch-1',
        'before:content-[attr(data-content)] before:absolute before:top-0 before:left-0 before:text-red-400 before:animate-glitch-2',
        className
      )}
      data-content={typeof children === 'string' ? children : undefined}
    >
      {children}
    </span>
  );
};

export default GlitchLabel;