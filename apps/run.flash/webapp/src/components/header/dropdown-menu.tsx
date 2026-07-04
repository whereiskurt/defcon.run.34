'use client';

import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from '@heroui/react';
import { useState } from 'react';

import { FaQuestion, FaRadio, FaFire } from 'react-icons/fa6';
import { FaUserAlt } from 'react-icons/fa';
import { FaMoneyCheckDollar } from 'react-icons/fa6';
import { GrMapLocation } from 'react-icons/gr';
import { Zap } from 'lucide-react';
import { MenuIcon } from './icon/menu';

// Region-prefixed so cross-app deep links into run.defcon.run route correctly
// (run.defcon.run is mounted under /{region}; a region-less path misroutes).
const RUN_BASE = `https://run.defcon.run/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`;
const GPX_BASE = 'https://gpx.defcon.run';

// This app is mounted under /{region} in production (see next.config.ts
// basePath) — raw window.location navigations must include it themselves.
const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

const iconClasses = 'text-lg text-default-400 pointer-events-none flex-shrink-0';

const MenuDropDown = () => {
  const [isOpen, setIsOpen] = useState(false);

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
            textValue="flash"
            startContent={<Zap className={iconClasses} />}
            key="flash"
            showDivider
            onClick={() => { setIsOpen(false); window.location.href = `${basePath}/`; }}
          >
            <span className="text-base">Flash Device</span>
          </DropdownItem>

          <DropdownItem
            textValue="whoami"
            startContent={<FaUserAlt className={iconClasses} />}
            key="whoami"
            onClick={() => { setIsOpen(false); window.open(`${RUN_BASE}/whoami`, '_blank'); }}
          >
            <span className="text-base">Who Am I</span>
          </DropdownItem>

          <DropdownItem
            textValue="routes"
            startContent={<GrMapLocation className={iconClasses} />}
            key="routes"
            onClick={() => { setIsOpen(false); window.open(GPX_BASE, '_blank'); }}
          >
            <span className="text-base">Routes</span>
          </DropdownItem>

          <DropdownItem
            textValue="heatmap"
            startContent={<FaFire className={iconClasses} />}
            key="heatmap"
            onClick={() => { setIsOpen(false); window.open(`${GPX_BASE}?overlay=heatmap`, '_blank'); }}
          >
            <span className="text-base">HeatMap</span>
          </DropdownItem>

          <DropdownItem
            textValue="meshtastic"
            startContent={<FaRadio className={iconClasses} />}
            key="meshtastic"
            onClick={() => { setIsOpen(false); window.open(`${RUN_BASE}/meshtastic`, '_blank'); }}
          >
            <span className="text-base">Meshtastic</span>
          </DropdownItem>

          <DropdownItem
            textValue="contributors"
            startContent={<FaMoneyCheckDollar className={iconClasses} />}
            key="contributors"
            showDivider
            onClick={() => { setIsOpen(false); window.open(`${RUN_BASE}/contributors`, '_blank'); }}
          >
            <span className="text-base">Contributors</span>
          </DropdownItem>

          <DropdownItem
            textValue="faq"
            startContent={<FaQuestion className={iconClasses} />}
            key="faq"
            onClick={() => { setIsOpen(false); window.open(`${RUN_BASE}/faq`, '_blank'); }}
          >
            <span className="text-base">FAQ</span>
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
};

export default MenuDropDown;
