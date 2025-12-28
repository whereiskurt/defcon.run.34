'use client';

import { Link, Tooltip } from '@heroui/react';

interface FooterProps {
  versionTooltip: string;
}

export function Footer({ versionTooltip }: FooterProps) {
  return (
    <footer className="w-full flex items-center justify-between py-3 flex-shrink-0 relative z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t border-divider px-6">
      <Link
        className="text-sm text-default-500 hover:text-primary transition-colors"
        href="/faq"
      >
        FAQ
      </Link>
      <Tooltip content={versionTooltip} placement="top">
        <Link
          className="flex items-center gap-1 text-current"
          href="/contributors"
          title="No Bystanders"
        >
          <span className="text-default-600"></span>
          <p className="text-primary">
            Casual Ultra + NeverDNF + You
          </p>
        </Link>
      </Tooltip>
      <div></div>
    </footer>
  );
}
