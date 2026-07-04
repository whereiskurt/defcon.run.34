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
import { FaUserAlt } from 'react-icons/fa';
import { PiPersonSimpleRun } from 'react-icons/pi';

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
            textValue="whoami"
            startContent={<FaUserAlt className={iconClasses} />}
            key="whoami"
            showDivider
            onClick={() => handleNavigation('/whoami')}
          >
            <span className="text-base">Who Am I</span>
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
            showDivider
            onClick={() => handleNavigation('/meshtastic')}
          >
            <span className="text-base">Meshtastic</span>
          </DropdownItem>

          <DropdownItem
            textValue="bib"
            startContent={<PiPersonSimpleRun className={iconClasses} />}
            key="bib"
            showDivider
            onClick={() => { setIsOpen(false); window.open('https://bib.defcon.run', '_blank'); }}
          >
            <span className="text-base">Bib</span>
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
