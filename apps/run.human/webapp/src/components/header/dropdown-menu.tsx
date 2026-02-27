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

import { FaMoneyCheckDollar, FaQuestion, FaRadio, FaFire } from 'react-icons/fa6';
import { GrMapLocation } from 'react-icons/gr';
import { MenuIcon } from './icon/menu';
import { FaDesktop, FaTrophy } from 'react-icons/fa';

const iconClasses = 'text-lg text-default-400 pointer-events-none flex-shrink-0';

const MenuDropDown = (params: any) => {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

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
            textValue="dashboard"
            startContent={<FaDesktop className={iconClasses} />}
            key="dashboard"
            showDivider
            onClick={() => handleNavigation('/dashboard')}
          >
            <span className="text-base">Dashboard</span>
          </DropdownItem>

          <DropdownItem
            textValue="leaderboard"
            startContent={<FaTrophy className={iconClasses} />}
            key="leaderboard"
            onClick={() => handleNavigation('/leaderboard')}
          >
            <span className="text-base">Leaderboard</span>
          </DropdownItem>

          <DropdownItem
            textValue="routes"
            startContent={<GrMapLocation className={iconClasses} />}
            key="routes"
            onClick={() => handleNavigation('/routes')}
          >
            <span className="text-base">Routes</span>
          </DropdownItem>

          <DropdownItem
            textValue="routes-map"
            startContent={<GrMapLocation className={iconClasses} />}
            key="routes-map"
            onClick={() => handleNavigation('/routes-map')}
          >
            <span className="text-base">Routes Map</span>
          </DropdownItem>

          <DropdownItem
            textValue="heatmap"
            startContent={<FaFire className={iconClasses} />}
            key="heatmap"
            onClick={() => handleNavigation('/heatmap')}
          >
            <span className="text-base">HeatMap</span>
          </DropdownItem>

          <DropdownItem
            textValue="meshtastic"
            startContent={<FaRadio className={iconClasses} />}
            key="meshtastic"
            onClick={() => handleNavigation('/meshtastic')}
          >
            <span className="text-base">Meshtastic</span>
          </DropdownItem>

          <DropdownItem
            textValue="contributors"
            startContent={<FaMoneyCheckDollar className={iconClasses} />}
            key="contributors"
            showDivider
            onClick={() => handleNavigation('/contributors')}
          >
            <span className="text-base">Contributors</span>
          </DropdownItem>

          <DropdownItem
            textValue="faq"
            startContent={<FaQuestion className={iconClasses} />}
            key="faq"
            onClick={() => handleNavigation('/faq')}
          >
            <span className="text-base">FAQ</span>
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
};

export default MenuDropDown;
