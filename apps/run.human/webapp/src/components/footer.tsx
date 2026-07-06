'use client';

import { Link, Tooltip } from '@heroui/react';
import { useCopy } from './CopyProvider';

interface FooterProps {
  versionTooltip: string;
}

export function Footer({ versionTooltip }: FooterProps) {
  const { t } = useCopy();
  return (
    <footer className="w-full flex items-center justify-between py-3 flex-shrink-0 border-t border-divider px-6 bg-background/50 backdrop-blur-sm relative z-10">
      <Link
        className="text-xs text-default-400 hover:text-primary transition-colors"
        href="/faq"
      >
        {t('common.header.faq')}
      </Link>
      <Tooltip content={versionTooltip} placement="top">
        <span className="font-mono text-xs text-default-400">
          defcon<span className="teal-dot">.</span>run 34
        </span>
      </Tooltip>
      <Link
        className="text-xs text-default-400 hover:text-primary transition-colors"
        href="/contributors"
      >
        {t('common.footer.credits')}
      </Link>
    </footer>
  );
}
