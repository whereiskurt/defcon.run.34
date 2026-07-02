'use client';

import { Link, Tooltip } from '@heroui/react';
import { getApiBasePath } from '@/lib/api';

interface FooterProps {
  versionTooltip: string;
}

export function Footer({ versionTooltip }: FooterProps) {
  return (
    <footer className="w-full flex items-center justify-between py-3 flex-shrink-0 border-t border-divider px-6 bg-background/50 backdrop-blur-sm relative z-10">
      <Link
        className="text-xs text-default-400 hover:text-primary transition-colors"
        href={`${getApiBasePath()}/faq`}
      >
        FAQ
      </Link>
      <Tooltip content={versionTooltip} placement="top">
        <span className="font-mono text-xs text-default-400">
          defcon<span className="teal-dot">.</span>run 34
        </span>
      </Tooltip>
      <Link
        className="text-xs text-default-400 hover:text-primary transition-colors"
        href={`${getApiBasePath()}/contributors`}
      >
        Credits
      </Link>
    </footer>
  );
}
