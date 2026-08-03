'use client';

import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { FaQuestion, FaRadio } from 'react-icons/fa6';
import { GrMapLocation } from 'react-icons/gr';
import { MenuIcon } from './icon/menu';
import { FaUserAlt, FaTrophy } from 'react-icons/fa';
import { FiDollarSign, FiShield } from 'react-icons/fi';
import { useCopy } from '../CopyProvider';
import { gpxMapUrl } from '@/lib/gpx-map';

const iconClasses = 'text-lg text-default-400 pointer-events-none flex-shrink-0';

const MenuDropDown = (params: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { t } = useCopy();
  const onDonate: (() => void) | undefined = params?.onDonate;
  const isAdmin: boolean = !!params?.isAdmin;

  const handleNavigation = (href: string) => {
    setIsOpen(false);
    router.push(href);
  };

  return (
    <Dropdown
      showArrow
      radius="sm"
      backdrop="blur"
      isOpen={isOpen}
      onOpenChange={(open) => setIsOpen(open)}
      classNames={{
        content: 'bg-content1 border border-divider',
      }}
    >
      <DropdownTrigger>
        <div className="cursor-pointer">
          <MenuIcon />
        </div>
      </DropdownTrigger>

      <DropdownMenu
        aria-label="Navigation menu"
        className="p-2"
        itemClasses={{
          base: [
            'rounded-lg',
            'text-default-600',
            'transition-all',
            'data-[hover=true]:text-foreground',
            'data-[hover=true]:bg-content2',
            'data-[pressed=true]:opacity-70',
          ],
        }}
      >
        <DropdownSection aria-label="Navigation">
          <DropdownItem
            textValue="whoami"
            startContent={<FaUserAlt className={iconClasses} />}
            key="whoami"
            showDivider
            onClick={() => handleNavigation('/whoami')}
          >
            <span className="text-base">{t('common.header.whoami')}</span>
          </DropdownItem>

          <DropdownItem
            textValue="maps"
            startContent={<GrMapLocation className={iconClasses} />}
            key="maps"
            onClick={() => { setIsOpen(false); window.open(gpxMapUrl(), '_blank'); }}
          >
            <span className="text-base">{t('common.header.maps')}</span>
          </DropdownItem>

          <DropdownItem
            textValue="meshtastic"
            startContent={<FaRadio className={iconClasses} />}
            key="meshtastic"
            showDivider
            onClick={() => handleNavigation('/meshtastic')}
          >
            <span className="text-base">{t('common.header.meshtastic')}</span>
          </DropdownItem>

          {/* Launched 2026-08-03. Mobile and desktop nav are SEPARATE hardcoded
              lists (header.tsx has its own `navItems`), so this entry has to be
              added in both places or it only appears on one. */}
          <DropdownItem
            textValue="leaderboard"
            startContent={<FaTrophy className={iconClasses} />}
            key="leaderboard"
            showDivider
            onClick={() => handleNavigation('/leaderboard')}
          >
            <span className="text-base">{t('common.header.leaderboard')}</span>
          </DropdownItem>

          {/* "Bib" was dropped from the nav on 2026-08-03 (Kurt) — it still
              lives in the avatar menu as "My Bib" and on the landing page.
              Donate stays. */}
          <DropdownItem
            textValue="donate"
            startContent={<FiDollarSign className={iconClasses} />}
            key="donate"
            showDivider
            onClick={() => { setIsOpen(false); onDonate?.(); }}
          >
            <span className="text-base">{t('common.header.donate')}</span>
          </DropdownItem>

          {isAdmin ? (
            <DropdownItem
              textValue="admin"
              startContent={<FiShield className={iconClasses} />}
              key="admin"
              showDivider
              onClick={() => handleNavigation('/admin')}
            >
              <span className="text-base">{t('common.header.admin')}</span>
            </DropdownItem>
          ) : null}

          <DropdownItem
            textValue="faq"
            startContent={<FaQuestion className={iconClasses} />}
            key="faq"
            onClick={() => handleNavigation('/faq')}
          >
            <span className="text-base">{t('common.header.faq')}</span>
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
};

export default MenuDropDown;
