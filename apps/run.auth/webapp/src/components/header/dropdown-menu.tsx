'use client';

import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
} from '@heroui/react';
import { useState } from 'react';

import { FaRadio } from 'react-icons/fa6';
import { GrMapLocation } from 'react-icons/gr';
import { MenuIcon } from './icon/menu';
import { Shield } from 'lucide-react';
import { SiStrava } from 'react-icons/si';

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
            textValue="profile"
            startContent={<Shield className={iconClasses} />}
            key="profile"
            onClick={() => { setIsOpen(false); window.location.href = `${basePath}/profile`; }}
          >
            <span className="text-base">Profile</span>
          </DropdownItem>

          <DropdownItem
            textValue="strava"
            startContent={<SiStrava className={iconClasses} />}
            key="strava"
            showDivider
            onClick={() => { setIsOpen(false); window.location.href = `${basePath}/strava`; }}
          >
            <span className="text-base">Strava Linking</span>
          </DropdownItem>

          <DropdownItem
            textValue="maps"
            startContent={<GrMapLocation className={iconClasses} />}
            key="maps"
            onClick={() => { setIsOpen(false); window.open('https://gpx.defcon.run', '_blank'); }}
          >
            <span className="text-base">Maps</span>
          </DropdownItem>

          <DropdownItem
            textValue="meshtastic"
            startContent={<FaRadio className={iconClasses} />}
            key="meshtastic"
            onClick={() => { setIsOpen(false); window.open('https://run.defcon.run/meshtastic', '_blank'); }}
          >
            <span className="text-base">Meshtastic</span>
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
};

export default MenuDropDown;
