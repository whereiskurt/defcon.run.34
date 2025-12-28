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
import { DashboardIcon } from './icon/dashboard';
import { MenuIcon } from './icon/menu';
import { FaDashcube, FaDesktop, FaTrophy } from 'react-icons/fa';

const iconClasses =
  'text-xl text-default-500 pointer-events-none flex-shrink-0';

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
    >
      <DropdownTrigger>
        <div>
          <MenuIcon />
        </div>
      </DropdownTrigger>

      <DropdownMenu
        aria-label="Custom item styles"
        className="p-3"
        itemClasses={{
          base: [
            'rounded-md',
            'text-default-800',
            'text-2xl',
            'transition-opacity',
            'data-[hover=true]:text-foreground',
            'data-[hover=true]:bg-default-100',
            'dark:data-[hover=true]:bg-default-50',
            'data-[selectable=true]:focus:bg-default-50',
            'data-[pressed=true]:opacity-70',
            'data-[focus-visible=true]:ring-default-500',
          ],
        }}
      >
        <DropdownSection aria-label="Menu Items">
          <DropdownItem
            className="pb-2"
            textValue="dashboard"
            startContent={<FaDesktop className={iconClasses} />}
            key="dashboard"
            showDivider
            onClick={() => handleNavigation('/dashboard')}
          >
            <span className="text-2xl">Dashboard</span>
          </DropdownItem>

          <DropdownItem
            className="pb-2"
            textValue="leaderboard"
            startContent={<FaTrophy className={iconClasses} />}
            key="leaderboard"
            onClick={() => handleNavigation('/leaderboard')}
          >
            <span className="text-2xl">Leaderboard</span>
          </DropdownItem>

          <DropdownItem
            className="pb-2"
            textValue="routes"
            startContent={<GrMapLocation size={24} className={iconClasses} />}
            key="routes"
            onClick={() => handleNavigation('/routes')}
          >
            <span className="text-2xl">Routes</span>
          </DropdownItem>

          <DropdownItem
            className="pb-2"
            textValue="routes-map"
            startContent={<GrMapLocation size={24} className={iconClasses} />}
            key="routes-map"
            onClick={() => handleNavigation('/routes-map')}
          >
            <span className="text-2xl">Routes Map</span>
          </DropdownItem>

          <DropdownItem
            className="pb-2"
            textValue="heatmap"
            startContent={<FaFire size={24} className={iconClasses} />}
            key="heatmap"
            onClick={() => handleNavigation('/heatmap')}
          >
            <span className="text-2xl">HeatMap</span>
          </DropdownItem>

          <DropdownItem
            className="pb-2"
            textValue="meshtastic"
            startContent={<FaRadio size={24} className={iconClasses} />}
            key="meshtastic"
            onClick={() => handleNavigation('/meshtastic')}
          >
            <span className="text-2xl">Meshtastic</span>
          </DropdownItem>

          <DropdownItem
            className="pb-2"
            textValue="contributors"
            startContent={<FaMoneyCheckDollar size={24} className={iconClasses} />}
            key="contributors"
            showDivider
            onClick={() => handleNavigation('/contributors')}
          >
            <span className="text-2xl">Contributors</span>
          </DropdownItem>

          <DropdownItem
            className="pb-2"
            textValue="faq"
            startContent={<FaQuestion size={24} className={iconClasses} />}
            key="faq"
            onClick={() => handleNavigation('/faq')}
          >
            <span className="text-2xl">FAQ</span>
          </DropdownItem>


        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
};

export default MenuDropDown;
